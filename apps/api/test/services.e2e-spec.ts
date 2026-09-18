import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from './../src/app.module.js';
import { TokenService } from './../src/auth/token.service.js';
import { PrismaService } from './../src/database/prisma.service.js';
import type { Role } from './../src/generated/prisma/enums.js';

/**
 * Service routes wired through the real AppModule, with Prisma mocked.
 *
 * Proves the wiring: every route is admitted and authorized, a MEMBER may read
 * but is refused every write with 403 — before the body is validated — and a
 * non-member receives admission's 404. Behaviour against real rows, tenant
 * isolation, and the database invariants are proven in
 * services.integration-spec.ts and schema.integration-spec.ts.
 */
const USER_ID = '0199a1b2-c3d4-7000-8000-000000000001';
const ORG_ID = '0199a1b2-c3d4-7000-8000-00000000000a';
const OTHER_ORG_ID = '0199a1b2-c3d4-7000-8000-00000000000b';
const MEMBERSHIP_ID = '0199a1b2-c3d4-7000-8000-0000000000aa';
const TEAM_ID = '0199a1b2-c3d4-7000-8000-0000000000c1';
const SERVICE_ID = '0199a1b2-c3d4-7000-8000-0000000000d1';
const CREATED = new Date('2026-09-18T12:00:00.000Z');

const serviceRow = {
  id: SERVICE_ID,
  name: 'Payment API',
  slug: 'payment-api',
  description: null,
  criticality: 'CRITICAL',
  createdAt: CREATED,
  updatedAt: CREATED,
  ownerTeam: { id: TEAM_ID, name: 'Payments', slug: 'payments' },
};

const base = `/api/v1/organizations/${ORG_ID}/services`;

const WRITES: { method: 'post' | 'patch' | 'delete'; path: string }[] = [
  { method: 'post', path: base },
  { method: 'patch', path: `${base}/${SERVICE_ID}` },
  { method: 'delete', path: `${base}/${SERVICE_ID}` },
];

const READS = [base, `${base}/${SERVICE_ID}`];

describe('Services (e2e)', () => {
  let app: INestApplication;
  let tokens: TokenService;

  const prisma = {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    membership: { findFirst: vi.fn() },
    organization: { findFirst: vi.fn() },
    team: { findFirst: vi.fn() },
    service: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
  };

  /** Admission resolves the caller as `role` in ORG_ID, and nowhere else. */
  const admitAs = (role: Role) =>
    prisma.membership.findFirst.mockImplementation(
      (args: { where: Record<string, unknown> }) =>
        args.where.organizationId === ORG_ID
          ? { id: MEMBERSHIP_ID, organizationId: ORG_ID, role }
          : null,
    );

  const bearer = async () => `Bearer ${await tokens.signAccessToken(USER_ID)}`;

  const send = async (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    body?: object,
  ) => {
    const pending = request(app.getHttpServer())
      [method](path)
      .set('Authorization', await bearer());

    return body === undefined ? pending : pending.send(body);
  };

  const noWrites = () => {
    expect(prisma.service.create).not.toHaveBeenCalled();
    expect(prisma.service.update).not.toHaveBeenCalled();
    expect(prisma.service.deleteMany).not.toHaveBeenCalled();
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('/api/v1');
    await app.init();

    tokens = app.get(TokenService);

    prisma.$transaction.mockImplementation((work: (tx: unknown) => unknown) =>
      work(prisma),
    );
    prisma.membership.findFirst.mockResolvedValue(null);
    prisma.organization.findFirst.mockResolvedValue({ id: ORG_ID });
    prisma.team.findFirst.mockResolvedValue({ id: TEAM_ID });
    prisma.service.findMany.mockResolvedValue([serviceRow]);
    prisma.service.findFirst.mockResolvedValue(serviceRow);
    prisma.service.create.mockResolvedValue(serviceRow);
    prisma.service.update.mockResolvedValue(serviceRow);
    prisma.service.deleteMany.mockResolvedValue({ count: 1 });
  });

  afterEach(async () => {
    vi.resetAllMocks();
    await app.close();
  });

  describe.each<Role>(['OWNER', 'ADMIN', 'MEMBER'])('reads as %s', (role) => {
    it.each(READS)('should serve %s', async (path) => {
      admitAs(role);

      expect((await send('get', path)).status).toBe(200);
    });
  });

  describe.each<Role>(['OWNER', 'ADMIN'])('writes as %s', (role) => {
    beforeEach(() => admitAs(role));

    it('should create a service and answer with the declared shape', async () => {
      const response = await send('post', base, {
        name: 'Payment API',
        ownerTeamId: TEAM_ID,
        criticality: 'CRITICAL',
      });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        id: SERVICE_ID,
        name: 'Payment API',
        slug: 'payment-api',
        description: null,
        criticality: 'CRITICAL',
        ownerTeam: { id: TEAM_ID, name: 'Payments', slug: 'payments' },
        createdAt: '2026-09-18T12:00:00.000Z',
        updatedAt: '2026-09-18T12:00:00.000Z',
      });
    });

    it.each([
      { slug: 'chosen' },
      { organizationId: OTHER_ORG_ID },
      { id: SERVICE_ID },
    ])('should refuse the extra key in %o with 400', async (extra) => {
      const response = await send('post', base, {
        name: 'Payment API',
        ownerTeamId: TEAM_ID,
        ...extra,
      });

      expect(response.status).toBe(400);
      expect(prisma.service.create).not.toHaveBeenCalled();
    });

    it('should refuse a missing owner with 400, naming the field', async () => {
      const response = await send('post', base, { name: 'Payment API' });

      expect(response.status).toBe(400);
      expect(response.body.details).toEqual([
        { field: 'ownerTeamId', message: expect.any(String) },
      ]);
    });

    it('should refuse a malformed owner id with 400, naming the field', async () => {
      const response = await send('patch', `${base}/${SERVICE_ID}`, {
        ownerTeamId: 'nope',
      });

      expect(response.status).toBe(400);
      expect(response.body.details).toEqual([
        { field: 'ownerTeamId', message: expect.any(String) },
      ]);
    });

    it('should refuse an unknown criticality with 400', async () => {
      const response = await send('patch', `${base}/${SERVICE_ID}`, {
        criticality: 'TIER_1',
      });

      expect(response.status).toBe(400);
      expect(prisma.service.update).not.toHaveBeenCalled();
    });

    it('should answer the delete with 204', async () => {
      expect((await send('delete', `${base}/${SERVICE_ID}`)).status).toBe(204);
    });

    it('should answer a malformed service id with 404, not 400 or 500', async () => {
      const response = await send('get', `${base}/not-a-uuid`);

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('SERVICE_NOT_FOUND');
    });
  });

  describe('writes as MEMBER', () => {
    it.each(WRITES)(
      'should refuse $method $path with 403 before validating the body',
      async ({ method, path }) => {
        admitAs('MEMBER');

        const response = await send(
          method,
          path,
          method === 'delete' ? undefined : { invalid: true },
        );

        expect(response.status).toBe(403);
        expect(response.body.code).toBe('PERMISSION_DENIED');
        noWrites();
      },
    );
  });

  describe('a non-member', () => {
    it.each([
      ...READS.map((path) => ({ method: 'get' as const, path })),
      ...WRITES,
    ])('should receive 404 from $method $path', async ({ method, path }) => {
      admitAs('OWNER');

      const response = await send(
        method,
        path.replace(ORG_ID, OTHER_ORG_ID),
        method === 'get' || method === 'delete' ? undefined : {},
      );

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('ORGANIZATION_NOT_FOUND');
      noWrites();
    });
  });
});
