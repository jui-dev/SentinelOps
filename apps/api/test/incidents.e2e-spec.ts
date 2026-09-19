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
 * Proves the wiring: every route is admitted and authorized; every role may
 * read incidents and post operational updates; only an ADMIN may declare,
 * change, or resolve an incident or assign its lead and responders, and a
 * MEMBER is refused each of those with 403 before anything is written;
 * bodies are validated strictly, there is no delete route, and a non-member
 * receives admission's 404. Behaviour against real rows, tenant isolation, concurrency, and the
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
  lead: null,
  responders: [],
};

const activityRow = {
  id: '0199a1b2-c3d4-7000-8000-0000000000f1',
  incidentId: INCIDENT_ID,
  type: 'UPDATE',
  message: 'Investigating elevated database latency.',
  fromValue: null,
  toValue: null,
  createdAt: CREATED,
  actor: { id: USER_ID, name: 'Ada Lovelace' },
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
    service: { findMany: vi.fn() },
    incident: {
      findMany: vi.fn(),
      groupBy: vi.fn(),
      count: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findFirstOrThrow: vi.fn(),
    },
    incidentResponder: { create: vi.fn(), deleteMany: vi.fn() },
    incidentActivity: { create: vi.fn(), createMany: vi.fn() },
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
              user: { passwordChangeRequired: false },
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

    // Interactive transactions run their work; batches, their queries.
    prisma.$transaction.mockImplementation(
      (work: ((tx: unknown) => unknown) | Promise<unknown>[]) =>
        Array.isArray(work) ? Promise.all(work) : work(prisma),
    );
    prisma.$queryRaw.mockResolvedValue([
      { owner_team_id: TEAM_ID, archived_at: null },
    ]);
    prisma.membership.findFirst.mockResolvedValue(null);
    prisma.organization.update.mockResolvedValue({ lastIncidentNumber: 1 });
    prisma.team.findFirst.mockResolvedValue({ id: TEAM_ID });
    prisma.incident.findMany.mockResolvedValue([incidentRow]);
    prisma.incident.groupBy.mockResolvedValue([]);
    prisma.incident.count.mockResolvedValue(0);
    prisma.service.findMany.mockResolvedValue([]);
    prisma.incident.findFirst.mockResolvedValue(incidentRow);
    prisma.incident.create.mockResolvedValue(incidentRow);
    prisma.incident.update.mockResolvedValue(incidentRow);
    prisma.incident.updateMany.mockResolvedValue({ count: 1 });
    prisma.incident.findFirstOrThrow.mockResolvedValue(incidentRow);
    prisma.incidentResponder.create.mockResolvedValue({ id: 'r-1' });
    prisma.incidentResponder.deleteMany.mockResolvedValue({ count: 1 });
    prisma.incidentActivity.create.mockResolvedValue(activityRow);
    prisma.incidentActivity.createMany.mockResolvedValue({ count: 1 });
  });

  afterEach(async () => {
    vi.resetAllMocks();
    await app.close();
  });

  describe.each<Role>(['ADMIN', 'MEMBER'])('as %s', (role) => {
    beforeEach(() => admitAs(role));

    it('should list a page in the collection envelope', async () => {
      const response = await send('get', `${base}?state=active`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        items: [expect.objectContaining({ number: 1 })],
        page: { cursor: null, hasMore: false },
      });
    });

    it('should summarise the incidents, not mistaking the path for a number', async () => {
      const response = await send(
        'get',
        `${base}/summary?from=2026-09-13&to=2026-09-19`,
      );

      expect(response.status).toBe(200);
      expect(response.body.period).toMatchObject({
        from: '2026-09-13',
        to: '2026-09-19',
        declared: 0,
      });
      expect(response.body.period.history).toEqual({
        total: expect.any(Number),
        items: expect.any(Array),
      });
      expect(prisma.incident.findFirst).not.toHaveBeenCalled();
    });

    it('should read an incident by its number', async () => {
      const response = await send('get', `${base}/1`);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ number: 1, lead: null });
    });

    it('should post an operational update and read the timeline', async () => {
      const expected = {
        id: activityRow.id,
        type: 'UPDATE',
        message: 'Investigating elevated database latency.',
        fromValue: null,
        toValue: null,
        actor: { id: USER_ID, name: 'Ada Lovelace' },
        createdAt: '2026-09-18T12:00:00.000Z',
      };

      const posted = await send('post', `${base}/1/updates`, {
        message: 'Investigating elevated database latency.',
      });

      expect(posted.status).toBe(201);
      expect(posted.body).toEqual(expected);

      prisma.incident.findFirst.mockResolvedValue({ activity: [activityRow] });
      const timeline = await send('get', `${base}/1/timeline`);

      expect(timeline.status).toBe(200);
      expect(timeline.body).toEqual([expected]);
    });
  });

  describe('as ADMIN', () => {
    beforeEach(() => admitAs('ADMIN'));

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
        lead: null,
        responders: [],
      });
    });

    it('should read and change an incident by its number', async () => {
      expect((await send('get', `${base}/1`)).status).toBe(200);
      expect(
        (await send('patch', `${base}/1`, { status: 'IDENTIFIED' })).status,
      ).toBe(200);
    });

    it('should assign a lead and add and remove a responder', async () => {
      expect(
        (await send('patch', `${base}/1`, { leadMembershipId: MEMBERSHIP_ID }))
          .status,
      ).toBe(200);
      expect(
        (
          await send('post', `${base}/1/responders`, {
            membershipId: MEMBERSHIP_ID,
          })
        ).status,
      ).toBe(201);
      expect(
        (await send('delete', `${base}/1/responders/${MEMBERSHIP_ID}`)).status,
      ).toBe(204);
    });

    it('should resolve an incident', async () => {
      expect(
        (await send('patch', `${base}/1`, { status: 'RESOLVED' })).status,
      ).toBe(200);
    });
  });

  describe('as MEMBER', () => {
    beforeEach(() => admitAs('MEMBER'));

    it.each([
      {
        name: 'declaring',
        method: 'post' as const,
        path: base,
        body: undefined,
      },
      {
        name: 'changing the title',
        method: 'patch' as const,
        path: `${base}/1`,
        body: { title: 'Renamed' },
      },
      {
        name: 'changing the summary',
        method: 'patch' as const,
        path: `${base}/1`,
        body: { summary: 'Rewritten' },
      },
      {
        name: 'changing the severity',
        method: 'patch' as const,
        path: `${base}/1`,
        body: { severity: 'SEV2' },
      },
      {
        name: 'changing the status',
        method: 'patch' as const,
        path: `${base}/1`,
        body: { status: 'IDENTIFIED' },
      },
      {
        name: 'resolving',
        method: 'patch' as const,
        path: `${base}/1`,
        body: { status: 'RESOLVED' },
      },
      {
        name: 'reassigning the team',
        method: 'patch' as const,
        path: `${base}/1`,
        body: { teamId: TEAM_ID },
      },
      {
        name: 'assigning the lead',
        method: 'patch' as const,
        path: `${base}/1`,
        body: { leadMembershipId: MEMBERSHIP_ID },
      },
      {
        name: 'adding a responder',
        method: 'post' as const,
        path: `${base}/1/responders`,
        body: { membershipId: MEMBERSHIP_ID },
      },
      {
        name: 'removing a responder',
        method: 'delete' as const,
        path: `${base}/1/responders/${MEMBERSHIP_ID}`,
        body: undefined,
      },
    ])(
      'should refuse $name with 403, writing nothing',
      async ({ method, path, body }) => {
        const response = await send(
          method,
          path,
          method === 'post' && body === undefined ? declaration : body,
        );

        expect(response.status).toBe(403);
        expect(response.body.code).toBe('PERMISSION_DENIED');
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(prisma.incident.create).not.toHaveBeenCalled();
        expect(prisma.incident.update).not.toHaveBeenCalled();
        expect(prisma.incidentResponder.create).not.toHaveBeenCalled();
        expect(prisma.incidentResponder.deleteMany).not.toHaveBeenCalled();
      },
    );
  });

  describe('validation', () => {
    // An admin, who holds every incident permission: a MEMBER is refused the
    // lifecycle routes with 403 before their bodies are read.
    beforeEach(() => admitAs('ADMIN'));

    it('should require a list state', async () => {
      const response = await send('get', base);

      expect(response.status).toBe(400);
      expect(prisma.incident.findMany).not.toHaveBeenCalled();
    });

    it.each([
      'from=2026-09-13',
      'from=2026-09-19&to=2026-09-13',
      'from=2025-01-01&to=2026-09-19',
      'from=2026-09-13T00:00:00Z&to=2026-09-19',
    ])('should refuse the summary period %s with 400', async (query) => {
      const response = await send('get', `${base}/summary?${query}`);

      expect(response.status).toBe(400);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it.each([
      'from=2026-09-13',
      'from=2026-09-19&to=2026-09-13',
      'from=2025-01-01&to=2026-09-19',
    ])('should refuse the list period %s with 400', async (query) => {
      const response = await send('get', `${base}?state=active&${query}`);

      expect(response.status).toBe(400);
      expect(prisma.incident.findMany).not.toHaveBeenCalled();
    });

    it('should narrow a list by the period it is given', async () => {
      const response = await send(
        'get',
        `${base}?state=resolved&from=2026-09-13&to=2026-09-19`,
      );

      expect(response.status).toBe(200);
      expect(prisma.incident.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            resolvedAt: {
              gte: new Date('2026-09-13T00:00:00.000Z'),
              lt: new Date('2026-09-20T00:00:00.000Z'),
            },
          }),
        }),
      );
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

    it.each([
      {},
      { membershipId: 'not-a-uuid' },
      { membershipId: MEMBERSHIP_ID, organizationId: OTHER_ORG_ID },
      { membershipId: MEMBERSHIP_ID, lead: true },
    ])('should refuse the responder body %o with 400', async (body) => {
      const response = await send('post', `${base}/1/responders`, body);

      expect(response.status).toBe(400);
      expect(prisma.incidentResponder.create).not.toHaveBeenCalled();
    });

    it('should refuse a malformed lead with 400', async () => {
      const response = await send('patch', `${base}/1`, {
        leadMembershipId: 'not-a-uuid',
      });

      expect(response.status).toBe(400);
      expect(prisma.incident.update).not.toHaveBeenCalled();
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

    it.each([
      ['a blank message', { message: '   ' }],
      ['an overlong message', { message: 'x'.repeat(2001) }],
      ['an actor', { message: 'x', actorId: USER_ID }],
    ])('should refuse an update with %s with 400', async (_, body) => {
      const response = await send('post', `${base}/1/updates`, body);

      expect(response.status).toBe(400);
      expect(prisma.incidentActivity.create).not.toHaveBeenCalled();
    });

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
      {
        method: 'get' as const,
        path: `${base}/summary?from=2026-09-13&to=2026-09-19`,
      },
      { method: 'post' as const, path: base },
      { method: 'patch' as const, path: `${base}/1` },
      { method: 'post' as const, path: `${base}/1/responders` },
      { method: 'get' as const, path: `${base}/1/timeline` },
      { method: 'post' as const, path: `${base}/1/updates` },
      {
        method: 'delete' as const,
        path: `${base}/1/responders/${MEMBERSHIP_ID}`,
      },
    ])('should receive 404 from $method $path', async ({ method, path }) => {
      admitAs('ADMIN');

      const response = await send(
        method,
        path.replace(ORG_ID, OTHER_ORG_ID),
        method === 'get' ? undefined : {},
      );

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('ORGANIZATION_NOT_FOUND');
      expect(prisma.incident.create).not.toHaveBeenCalled();
      expect(prisma.incident.update).not.toHaveBeenCalled();
      expect(prisma.incidentResponder.create).not.toHaveBeenCalled();
      expect(prisma.incidentResponder.deleteMany).not.toHaveBeenCalled();
      expect(prisma.incidentActivity.create).not.toHaveBeenCalled();
    });
  });
});
