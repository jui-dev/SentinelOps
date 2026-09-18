import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from './../src/app.module.js';
import { TokenService } from './../src/auth/token.service.js';
import { PrismaService } from './../src/database/prisma.service.js';
import type { Role } from './../src/generated/prisma/enums.js';

/**
 * Incident routes wired through the real AppModule, with Prisma mocked.
 *
 * Proves the wiring: every route is admitted and authorized, every role —
 * MEMBER included — may declare and change incidents, bodies are validated
 * strictly, there is no delete route, and a non-member receives admission's
 * 404. Behaviour against real rows, tenant isolation, concurrency, and the
 * database invariants are proven in incidents.integration-spec.ts and
 * schema.integration-spec.ts.
 */
const USER_ID = '0199a1b2-c3d4-7000-8000-000000000001';
const ORG_ID = '0199a1b2-c3d4-7000-8000-00000000000a';
const OTHER_ORG_ID = '0199a1b2-c3d4-7000-8000-00000000000b';
const MEMBERSHIP_ID = '0199a1b2-c3d4-7000-8000-0000000000aa';
const TEAM_ID = '0199a1b2-c3d4-7000-8000-0000000000c1';
const SERVICE_ID = '0199a1b2-c3d4-7000-8000-0000000000d1';
const INCIDENT_ID = '0199a1b2-c3d4-7000-8000-0000000000e1';
const CREATED = new Date('2026-09-18T12:00:00.000Z');

const incidentRow = {
  id: INCIDENT_ID,
  number: 1,
  title: 'Card payments failing',
  summary: null,
  severity: 'SEV1',
  status: 'INVESTIGATING',
  createdAt: CREATED,
  updatedAt: CREATED,
  resolvedAt: null,
  service: {
    id: SERVICE_ID,
    name: 'Payment API',
    slug: 'payment-api',
    criticality: 'CRITICAL',
    archivedAt: null,
  },
  team: { id: TEAM_ID, name: 'Payments', slug: 'payments' },
  createdBy: { id: USER_ID, name: 'Ada Lovelace' },
};

const base = `/api/v1/organizations/${ORG_ID}/incidents`;

const declaration = {
  title: 'Card payments failing',
  serviceId: SERVICE_ID,
  severity: 'SEV1',
};

describe('Incidents (e2e)', () => {
  let app: INestApplication;
  let tokens: TokenService;

  const prisma = {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    membership: { findFirst: vi.fn() },
    organization: { findFirst: vi.fn(), update: vi.fn() },
    team: { findFirst: vi.fn() },
    incident: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  };

  /**
   * Admission resolves the caller as `role` in ORG_ID, and nowhere else. The
   * same lookup, by membership id, resolves the declarer.
   */
  const admitAs = (role: Role) =>
    prisma.membership.findFirst.mockImplementation(
      (args: { where: Record<string, unknown> }) =>
        args.where.organizationId === ORG_ID
          ? {
              id: MEMBERSHIP_ID,
              organizationId: ORG_ID,
              role,
              userId: USER_ID,
            }
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
    prisma.$queryRaw.mockResolvedValue([
      { owner_team_id: TEAM_ID, archived_at: null },
    ]);
    prisma.membership.findFirst.mockResolvedValue(null);
    prisma.organization.update.mockResolvedValue({ lastIncidentNumber: 1 });
    prisma.team.findFirst.mockResolvedValue({ id: TEAM_ID });
    prisma.incident.findMany.mockResolvedValue([incidentRow]);
    prisma.incident.findFirst.mockResolvedValue(incidentRow);
    prisma.incident.create.mockResolvedValue(incidentRow);
    prisma.incident.update.mockResolvedValue(incidentRow);
  });

  afterEach(async () => {
    vi.resetAllMocks();
    await app.close();
  });

  describe.each<Role>(['OWNER', 'ADMIN', 'MEMBER'])('as %s', (role) => {
    beforeEach(() => admitAs(role));

    it('should list a page in the collection envelope', async () => {
      const response = await send('get', `${base}?state=active`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        items: [expect.objectContaining({ number: 1 })],
        page: { cursor: null, hasMore: false },
      });
    });

    it('should declare an incident and answer with the declared shape', async () => {
      const response = await send('post', base, declaration);

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        id: INCIDENT_ID,
        number: 1,
        title: 'Card payments failing',
        summary: null,
        severity: 'SEV1',
        status: 'INVESTIGATING',
        service: {
          id: SERVICE_ID,
          name: 'Payment API',
          slug: 'payment-api',
          criticality: 'CRITICAL',
          archivedAt: null,
        },
        team: { id: TEAM_ID, name: 'Payments', slug: 'payments' },
        createdBy: { id: USER_ID, name: 'Ada Lovelace' },
        createdAt: '2026-09-18T12:00:00.000Z',
        updatedAt: '2026-09-18T12:00:00.000Z',
        resolvedAt: null,
      });
    });

    it('should read and change an incident by its number', async () => {
      expect((await send('get', `${base}/1`)).status).toBe(200);
      expect(
        (await send('patch', `${base}/1`, { status: 'IDENTIFIED' })).status,
      ).toBe(200);
    });
  });

  describe('validation', () => {
    beforeEach(() => admitAs('MEMBER'));

    it('should require a list state', async () => {
      const response = await send('get', base);

      expect(response.status).toBe(400);
      expect(prisma.incident.findMany).not.toHaveBeenCalled();
    });

    it('should refuse a malformed cursor with 400', async () => {
      const response = await send('get', `${base}?state=resolved&cursor=abc`);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('INVALID_CURSOR');
    });

    it.each([
      { status: 'INVESTIGATING' },
      { teamId: TEAM_ID },
      { organizationId: OTHER_ORG_ID },
      { number: 9 },
      { createdById: USER_ID },
      { resolvedAt: '2026-09-18T00:00:00.000Z' },
    ])(
      'should refuse the key in %o on a declaration with 400',
      async (extra) => {
        const response = await send('post', base, { ...declaration, ...extra });

        expect(response.status).toBe(400);
        expect(prisma.incident.create).not.toHaveBeenCalled();
      },
    );

    it('should refuse a missing severity with 400, naming the field', async () => {
      const { severity: _omitted, ...body } = declaration;
      const response = await send('post', base, body);

      expect(response.status).toBe(400);
      expect(response.body.details).toEqual([
        { field: 'severity', message: expect.any(String) },
      ]);
    });

    it('should refuse changing the service with 400', async () => {
      const response = await send('patch', `${base}/1`, {
        serviceId: SERVICE_ID,
      });

      expect(response.status).toBe(400);
      expect(prisma.incident.update).not.toHaveBeenCalled();
    });

    it.each(['0', 'abc', '99999999999', INCIDENT_ID])(
      'should answer the incident number %j with 404, not 400 or 500',
      async (number) => {
        const response = await send('get', `${base}/${number}`);

        expect(response.status).toBe(404);
        expect(response.body.code).toBe('INCIDENT_NOT_FOUND');
      },
    );

    it('should offer no way to delete an incident', async () => {
      const response = await send('delete', `${base}/1`);

      expect(response.status).toBe(404);
      expect(response.body.code).toBeUndefined();
    });
  });

  describe('a non-member', () => {
    it.each([
      { method: 'get' as const, path: `${base}?state=active` },
      { method: 'get' as const, path: `${base}/1` },
      { method: 'post' as const, path: base },
      { method: 'patch' as const, path: `${base}/1` },
    ])('should receive 404 from $method $path', async ({ method, path }) => {
      admitAs('OWNER');

      const response = await send(
        method,
        path.replace(ORG_ID, OTHER_ORG_ID),
        method === 'get' ? undefined : {},
      );

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('ORGANIZATION_NOT_FOUND');
      expect(prisma.incident.create).not.toHaveBeenCalled();
      expect(prisma.incident.update).not.toHaveBeenCalled();
    });
  });
});
