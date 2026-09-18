import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from './../src/app.module.js';
import { TokenService } from './../src/auth/token.service.js';
import { PrismaService } from './../src/database/prisma.service.js';
import type { Role } from './../src/generated/prisma/enums.js';

/**
 * Team routes wired through the real AppModule, with Prisma mocked.
 *
 * Proves the wiring: every route is admitted and authorized, a MEMBER may read
 * but is refused every write with 403 — before the body is validated — and a
 * non-member receives admission's 404. Behaviour against real rows, tenant
 * isolation, and the database invariants are proven in
 * teams.integration-spec.ts and schema.integration-spec.ts.
 */
const USER_ID = '0199a1b2-c3d4-7000-8000-000000000001';
const ORG_ID = '0199a1b2-c3d4-7000-8000-00000000000a';
const OTHER_ORG_ID = '0199a1b2-c3d4-7000-8000-00000000000b';
const MEMBERSHIP_ID = '0199a1b2-c3d4-7000-8000-0000000000aa';
const TEAM_ID = '0199a1b2-c3d4-7000-8000-0000000000c1';
const CREATED = new Date('2026-09-18T12:00:00.000Z');

const teamRow = {
  id: TEAM_ID,
  name: 'Platform',
  slug: 'platform',
  description: null,
  createdAt: CREATED,
  updatedAt: CREATED,
  _count: { memberships: 0 },
};

const memberRow = {
  membershipId: MEMBERSHIP_ID,
  createdAt: CREATED,
  membership: {
    user: { id: USER_ID, name: 'Ada', email: 'ada@example.com' },
  },
};

const base = `/api/v1/organizations/${ORG_ID}/teams`;

/** Every write route, each with a body that would fail validation. */
const WRITES: { method: 'post' | 'patch' | 'delete'; path: string }[] = [
  { method: 'post', path: base },
  { method: 'patch', path: `${base}/${TEAM_ID}` },
  { method: 'delete', path: `${base}/${TEAM_ID}` },
  { method: 'post', path: `${base}/${TEAM_ID}/members` },
  { method: 'delete', path: `${base}/${TEAM_ID}/members/${MEMBERSHIP_ID}` },
];

const READS = [base, `${base}/${TEAM_ID}`, `${base}/${TEAM_ID}/members`];

describe('Teams (e2e)', () => {
  let app: INestApplication;
  let tokens: TokenService;

  const prisma = {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    membership: { findFirst: vi.fn() },
    organization: { findFirst: vi.fn() },
    team: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    teamMembership: {
      findMany: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
  };

  /** Admission resolves the caller as `role` in ORG_ID, and nowhere else. */
  const admitAs = (role: Role) =>
    prisma.membership.findFirst.mockImplementation(
      (args: { where: Record<string, unknown> }) => {
        if (!('userId' in args.where)) {
          // The service's lookup of the membership being added.
          return { id: MEMBERSHIP_ID };
        }

        return args.where.organizationId === ORG_ID
          ? { id: MEMBERSHIP_ID, organizationId: ORG_ID, role }
          : null;
      },
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
    expect(prisma.team.create).not.toHaveBeenCalled();
    expect(prisma.team.update).not.toHaveBeenCalled();
    expect(prisma.team.deleteMany).not.toHaveBeenCalled();
    expect(prisma.teamMembership.create).not.toHaveBeenCalled();
    expect(prisma.teamMembership.deleteMany).not.toHaveBeenCalled();
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
    prisma.team.findMany.mockResolvedValue([teamRow]);
    prisma.team.findFirst.mockResolvedValue(teamRow);
    prisma.team.create.mockResolvedValue(teamRow);
    prisma.team.update.mockResolvedValue(teamRow);
    prisma.team.deleteMany.mockResolvedValue({ count: 1 });
    prisma.teamMembership.findMany.mockResolvedValue([memberRow]);
    prisma.teamMembership.create.mockResolvedValue(memberRow);
    prisma.teamMembership.deleteMany.mockResolvedValue({ count: 1 });
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

    it('should create a team from a name and description', async () => {
      const response = await send('post', base, {
        name: 'Platform',
        description: 'Owns the runtime.',
      });

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        id: TEAM_ID,
        name: 'Platform',
        slug: 'platform',
        description: null,
        memberCount: 0,
        createdAt: '2026-09-18T12:00:00.000Z',
        updatedAt: '2026-09-18T12:00:00.000Z',
      });
    });

    it('should refuse a client-chosen slug with 400', async () => {
      const response = await send('post', base, {
        name: 'Platform',
        slug: 'chosen',
      });

      expect(response.status).toBe(400);
      expect(prisma.team.create).not.toHaveBeenCalled();
    });

    it('should refuse a malformed membership id with 400, naming the field', async () => {
      const response = await send('post', `${base}/${TEAM_ID}/members`, {
        membershipId: 'nope',
      });

      expect(response.status).toBe(400);
      expect(response.body.details).toEqual([
        { field: 'membershipId', message: expect.any(String) },
      ]);
    });

    it('should answer the deletes with 204', async () => {
      expect((await send('delete', `${base}/${TEAM_ID}`)).status).toBe(204);
      expect(
        (await send('delete', `${base}/${TEAM_ID}/members/${MEMBERSHIP_ID}`))
          .status,
      ).toBe(204);
    });

    it('should answer a malformed team id with 404, not 400 or 500', async () => {
      const response = await send('get', `${base}/not-a-uuid`);

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('TEAM_NOT_FOUND');
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
