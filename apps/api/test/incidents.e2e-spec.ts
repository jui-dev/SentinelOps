import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from './../src/app.module.js';
import { TokenService } from './../src/auth/token.service.js';
import { PrismaService } from './../src/database/prisma.service.js';
import { NotificationsWriter } from './../src/notifications/notifications.writer.js';
import type { Role } from './../src/generated/prisma/enums.js';

/**
 * Incident routes wired through the real AppModule, with Prisma mocked.
 *
 * Proves the wiring: every route is admitted and authorized; every role may
 * read incidents and respond — start investigating, post updates, complete
 * their own response — a MEMBER posting only while investigating (403
 * START_INVESTIGATING_FIRST otherwise); only an ADMIN may declare, change,
 * reassign, or resolve an incident, never while a responder is still
 * investigating, and a MEMBER is refused each of those with 403 before
 * anything is written;
 * every role may read its own attention, whose parts follow its permissions
 * and whose teams come from its admitted membership;
 * bodies are validated strictly, there is no delete route and no lead or
 * responder route, and a non-member
 * receives admission's 404. Behaviour against real rows, tenant isolation, concurrency, and the
 * database invariants are proven in incidents.integration-spec.ts and
 * schema.integration-spec.ts; who each change notifies, in
 * incident-notifications.integration-spec.ts, so the writer is stubbed here.
 */
const USER_ID = '0199a1b2-c3d4-7000-8000-000000000001';
const ORG_ID = '0199a1b2-c3d4-7000-8000-00000000000a';
const OTHER_ORG_ID = '0199a1b2-c3d4-7000-8000-00000000000b';
const MEMBERSHIP_ID = '0199a1b2-c3d4-7000-8000-0000000000aa';
/** Well formed, and not a membership of ORG_ID. */
const OTHER_MEMBERSHIP_ID = '0199a1b2-c3d4-7000-8000-0000000000ab';
/** Well formed, a membership of ORG_ID, and not the caller's own. */
const ANOTHER_MEMBERSHIP_ID = '0199a1b2-c3d4-7000-8000-0000000000ac';
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
  status: 'DECLARED',
  responseAccess: 'OPEN',
  assignees: [],
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
  team: {
    id: TEAM_ID,
    name: 'Payments',
    slug: 'payments',
    memberships: [{ id: 'team-membership-1' }],
  },
  createdBy: { id: USER_ID, name: 'Ada Lovelace' },
  responders: [],
  // The latest timeline entry, which a list reads as its last update: none.
  activity: [],
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

/** A period of whole UTC days, as both activity routes take one. */
const PERIOD = 'from=2026-09-13&to=2026-09-19';

/** A resolution, with the note every one requires. */
const RESOLVE = { status: 'RESOLVED', resolution: 'Rolled back.' };

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
    membership: { findFirst: vi.fn(), findMany: vi.fn() },
    organization: { findFirst: vi.fn(), update: vi.fn() },
    team: { findFirst: vi.fn() },
    teamMembership: { findMany: vi.fn() },
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
    incidentActivity: {
      create: vi.fn(),
      createMany: vi.fn(),
      createManyAndReturn: vi.fn(),
      findMany: vi.fn(),
    },
    incidentResponder: {
      count: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
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
      .overrideProvider(NotificationsWriter)
      .useValue({ incidentActivities: vi.fn().mockResolvedValue(0) })
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
    prisma.teamMembership.findMany.mockResolvedValue([]);
    prisma.incident.findFirst.mockResolvedValue(incidentRow);
    prisma.incident.create.mockResolvedValue(incidentRow);
    prisma.incident.update.mockResolvedValue(incidentRow);
    prisma.incident.updateMany.mockResolvedValue({ count: 1 });
    prisma.incident.findFirstOrThrow.mockResolvedValue(incidentRow);
    prisma.incidentActivity.create.mockResolvedValue(activityRow);
    prisma.incidentActivity.createMany.mockResolvedValue({ count: 1 });
    prisma.incidentActivity.createManyAndReturn.mockResolvedValue([]);
    prisma.incidentActivity.findMany.mockResolvedValue([]);
    // By default the caller is investigating the incident, and nobody else.
    prisma.incidentResponder.findFirst.mockResolvedValue({
      id: 'responder-1',
      status: 'INVESTIGATING',
    });
    prisma.incidentResponder.count.mockResolvedValue(0);
    prisma.incidentResponder.create.mockResolvedValue({ id: 'responder-1' });
    prisma.incidentResponder.update.mockResolvedValue({ id: 'responder-1' });
    // The summary reads the responses still under way; the attention route
    // reads them too, and sets its own rows where it needs them.
    prisma.incidentResponder.findMany.mockResolvedValue([]);
  });

  afterEach(async () => {
    vi.resetAllMocks();
    await app.close();
  });

  describe.each<Role>(['ADMIN', 'RESPONDER'])('as %s', (role) => {
    beforeEach(() => admitAs(role));

    it('should list a page in the collection envelope', async () => {
      const response = await send('get', `${base}?state=active`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        items: [expect.objectContaining({ number: 1 })],
        page: { cursor: null, hasMore: false },
      });
    });

    it("should read the caller's attention, not mistaking the path for a number", async () => {
      const response = await send('get', `${base}/attention`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        manage:
          role === 'ADMIN' ? { needsDecision: [], readyToResolve: [] } : null,
        respond:
          role === 'ADMIN'
            ? null
            : { assignedToYou: [], needsYourTeam: [], yourResponses: [] },
      });
      expect(prisma.incident.findFirst).not.toHaveBeenCalled();
      // The caller's teams are found by their admitted membership, within
      // the organization — never by anything the request names.
      expect(prisma.teamMembership.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: ORG_ID,
            team: {
              memberships: { some: { membershipId: MEMBERSHIP_ID } },
            },
          },
        }),
      );
      expect(prisma.incident.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: ORG_ID,
            status: { not: 'RESOLVED' },
          }),
        }),
      );
    });

    it('should read an incident by its number', async () => {
      const response = await send('get', `${base}/1`);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ number: 1 });
      expect(response.body.responders).toEqual([]);
      expect(response.body).not.toHaveProperty('lead');
    });

    it('should post an operational update and read the timeline', async () => {
      const expected = {
        id: activityRow.id,
        type: 'UPDATE',
        message: 'Investigating elevated database latency.',
        fromValue: null,
        toValue: null,
        actor: { id: USER_ID, name: 'Ada Lovelace', role },
        createdAt: '2026-09-18T12:00:00.000Z',
      };
      // The actor's role here now, as the timeline reads it.
      prisma.membership.findMany.mockResolvedValue([{ userId: USER_ID, role }]);

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

  /**
   * The organization's own figures: the summary, the activity calendar,
   * and occurrence. Oversight rather than reading, so they are admitted
   * here alone — a MEMBER holds `incidents:read` but not
   * `incidents:read-all`, and is refused each of them below.
   */
  describe('as an overseer', () => {
    beforeEach(() => admitAs('ADMIN'));

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
      // Who is investigating is part of the state now, and is answered
      // even when nobody is: a nought, never a missing field.
      expect(response.body.current.responders).toEqual({
        active: 0,
        teams: 0,
      });
      // Both active statuses, and every severity's typical time — present,
      // and empty, when nothing has been resolved to measure it by.
      expect(response.body.current.activeByStatus).toEqual({
        DECLARED: 0,
        INVESTIGATING: 0,
      });
      expect(response.body.current.typicalResolution).toMatchObject({
        minimumSample: 5,
        bySeverity: {
          SEV1: { resolved: 0, medianMs: null },
          SEV2: { resolved: 0, medianMs: null },
          SEV3: { resolved: 0, medianMs: null },
          SEV4: { resolved: 0, medianMs: null },
        },
      });
      expect(prisma.incident.findFirst).not.toHaveBeenCalled();
    });

    it("should read the organization's activity, not mistaking the path for a number", async () => {
      const response = await send(
        'get',
        `${base}/activity?from=2026-09-13&to=2026-09-19`,
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        from: '2026-09-13',
        to: '2026-09-19',
        total: 0,
        activeDays: 0,
        thresholds: [1, 3, 6, 11],
      });
      // Every day of the period, quiet ones included.
      expect(response.body.days).toHaveLength(7);
      expect(prisma.incident.findFirst).not.toHaveBeenCalled();
      // The organization is the admitted one, never anything the request names.
      expect(prisma.incidentActivity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: ORG_ID }),
        }),
      );
    });

    it("should read the organization's incident occurrence, not mistaking the path for a number", async () => {
      prisma.organization.findFirst.mockResolvedValue({
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      prisma.$queryRaw.mockResolvedValue([{ day: '2026-09-15', declared: 2 }]);

      const response = await send(
        'get',
        `${base}/occurrence?from=2026-09-13&to=2026-09-19`,
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        from: '2026-09-13',
        to: '2026-09-19',
        declared: 2,
        previous: {
          from: '2026-09-06',
          to: '2026-09-12',
          minimumSample: 5,
          changePercent: null,
        },
        services: { top: [], others: { services: 0, declared: 0 } },
      });
      // Every day of the period, quiet ones included.
      expect(response.body.days).toHaveLength(7);
      // The organization is the admitted one, never anything the request
      // names — in its own row, and in every incident and service read.
      expect(prisma.organization.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: ORG_ID, deletedAt: null },
        }),
      );
      for (const read of [
        prisma.incident.count,
        prisma.incident.groupBy,
        prisma.service.findMany,
      ]) {
        expect(read).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ organizationId: ORG_ID }),
          }),
        );
      }
      expect(prisma.incident.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: ORG_ID }),
        }),
      );
    });
  });

  describe('as ADMIN', () => {
    beforeEach(() => admitAs('ADMIN'));

    it('should list an incident whose responders have all completed as ready to resolve', async () => {
      prisma.incident.findMany.mockResolvedValue([
        {
          ...incidentRow,
          status: 'INVESTIGATING',
          responders: [
            {
              status: 'COMPLETED',
              startedAt: CREATED,
              completedAt: CREATED,
              membership: {
                id: '0199a1b2-c3d4-7000-8000-0000000000bb',
                user: { name: 'Priya Shah' },
              },
            },
          ],
        },
      ]);

      const response = await send('get', `${base}/attention`);

      expect(response.status).toBe(200);
      expect(response.body.manage.readyToResolve).toEqual([
        expect.objectContaining({
          number: 1,
          status: 'INVESTIGATING',
          responders: [
            {
              membershipId: '0199a1b2-c3d4-7000-8000-0000000000bb',
              name: 'Priya Shah',
              status: 'COMPLETED',
              startedAt: '2026-09-18T12:00:00.000Z',
              completedAt: '2026-09-18T12:00:00.000Z',
            },
          ],
        }),
      ]);
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
        status: 'DECLARED',
        responseAccess: 'OPEN',
        assignees: [],
        service: {
          id: SERVICE_ID,
          name: 'Payment API',
          slug: 'payment-api',
          criticality: 'CRITICAL',
          archivedAt: null,
        },
        team: { id: TEAM_ID, name: 'Payments', slug: 'payments' },
        createdBy: { id: USER_ID, name: 'Ada Lovelace' },
        knownIssue: null,
        createdAt: '2026-09-18T12:00:00.000Z',
        updatedAt: '2026-09-18T12:00:00.000Z',
        resolvedAt: null,
        responders: [],
      });
    });

    it('should post an update without being on the responsible team', async () => {
      const response = await send('post', `${base}/1/updates`, {
        message: 'Admin here: customer support is informed.',
      });

      expect(response.status).toBe(201);
      // Only lockActive's read: the Admin is never checked against the team.
      expect(prisma.incident.findFirst).toHaveBeenCalledTimes(1);
    });

    it.each([
      { method: 'post' as const, path: `${base}/1/responders` },
      {
        method: 'delete' as const,
        path: `${base}/1/responders/${MEMBERSHIP_ID}`,
      },
    ])('should offer no $method $path route', async ({ method, path }) => {
      const response = await send(method, path, {
        membershipId: MEMBERSHIP_ID,
      });

      expect(response.status).toBe(404);
      expect(response.body.code).toBeUndefined();
    });

    it('should resolve an incident under investigation', async () => {
      prisma.incident.findFirstOrThrow.mockResolvedValueOnce({
        ...incidentRow,
        status: 'INVESTIGATING',
      });

      expect((await send('patch', `${base}/1`, RESOLVE)).status).toBe(200);
    });

    it('should refuse resolving without a note with 400 naming it, before reading anything', async () => {
      const response = await send('patch', `${base}/1`, { status: 'RESOLVED' });

      expect(response.status).toBe(400);
      expect(
        response.body.details.map((d: { field: string }) => d.field),
      ).toEqual(['resolution']);
      expect(prisma.incident.findFirstOrThrow).not.toHaveBeenCalled();
      expect(prisma.incident.update).not.toHaveBeenCalled();
    });

    it('should refuse resolving while a responder is investigating with 409, writing nothing', async () => {
      prisma.incident.findFirstOrThrow.mockResolvedValueOnce({
        ...incidentRow,
        status: 'INVESTIGATING',
      });
      prisma.incidentResponder.count.mockResolvedValue(1);

      const response = await send('patch', `${base}/1`, RESOLVE);

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('RESPONDERS_STILL_INVESTIGATING');
      expect(prisma.incident.update).not.toHaveBeenCalled();
      expect(
        prisma.incidentActivity.createManyAndReturn,
      ).not.toHaveBeenCalled();
    });

    it('should refuse resolving a declared incident with 409, writing nothing', async () => {
      const response = await send('patch', `${base}/1`, RESOLVE);

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('INVALID_STATUS_TRANSITION');
      expect(prisma.incident.update).not.toHaveBeenCalled();
      expect(
        prisma.incidentActivity.createManyAndReturn,
      ).not.toHaveBeenCalled();
    });
  });

  describe('as MEMBER', () => {
    beforeEach(() => admitAs('RESPONDER'));

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
        name: 'starting the investigation',
        method: 'patch' as const,
        path: `${base}/1`,
        body: { status: 'INVESTIGATING' },
      },
      {
        name: 'resolving',
        method: 'patch' as const,
        path: `${base}/1`,
        body: RESOLVE,
      },
      {
        name: 'reassigning the team',
        method: 'patch' as const,
        path: `${base}/1`,
        body: { teamId: TEAM_ID },
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
      },
    );

    // The organization's own figures. A member holds `incidents:read`, so
    // these are not refused for want of a permission to read incidents at
    // all — they are refused because a figure counted across every incident
    // is `incidents:read-all`, which a member does not hold.
    it.each([
      { name: 'the summary', path: 'summary' },
      { name: 'the activity calendar', path: 'activity' },
      { name: 'occurrence', path: 'occurrence' },
    ])('should refuse $name with 403, reading nothing', async ({ path }) => {
      const response = await send(
        'get',
        `${base}/${path}?from=2026-09-13&to=2026-09-19`,
      );

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('PERMISSION_DENIED');
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(prisma.incidentActivity.findMany).not.toHaveBeenCalled();
    });

    // Authorization runs before the handler, so the period is never looked
    // at: a refusal, not a complaint about the request.
    it.each(['summary', 'activity', 'occurrence'])(
      'should refuse %s before validating the period',
      async (path) => {
        const response = await send('get', `${base}/${path}?from=nonsense`);

        expect(response.status).toBe(403);
        expect(response.body.code).toBe('PERMISSION_DENIED');
      },
    );

    // Reading incidents is still theirs, and so is what waits on them.
    it.each([
      { name: 'the list', path: `${base}?state=active` },
      { name: 'their attention', path: `${base}/attention` },
    ])('should still read $name', async ({ path }) => {
      const response = await send('get', path);

      expect(response.status).toBe(200);
    });

    it("should list a declared incident on the caller's team as needing it, and nothing to resolve", async () => {
      prisma.teamMembership.findMany.mockResolvedValue([
        { teamId: TEAM_ID, membershipId: MEMBERSHIP_ID },
      ]);

      const response = await send('get', `${base}/attention`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        manage: null,
        respond: {
          assignedToYou: [],
          needsYourTeam: [expect.objectContaining({ number: 1 })],
          yourResponses: [],
        },
      });
    });

    it('should refuse an update before starting to investigate with 403 START_INVESTIGATING_FIRST, writing nothing', async () => {
      prisma.incidentResponder.findFirst.mockResolvedValue(null);
      // Locked, then found not to be theirs: they did not declare it.
      prisma.incident.findFirst
        .mockResolvedValueOnce(await prisma.incident.findFirst())
        .mockResolvedValueOnce(null);

      const response = await send('post', `${base}/1/updates`, {
        message: 'Seeing timeouts from the card processor.',
      });

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('START_INVESTIGATING_FIRST');
      expect(prisma.incidentActivity.create).not.toHaveBeenCalled();
    });

    it('should start investigating, answering 200 with the incident', async () => {
      prisma.incidentResponder.findFirst.mockResolvedValue(null);

      const response = await send('post', `${base}/1/responders/me`);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ number: 1, responders: [] });
      expect(prisma.incidentResponder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ membershipId: MEMBERSHIP_ID }),
        }),
      );
    });

    it('should refuse starting outside the responsible team with 403 NOT_ON_RESPONSIBLE_TEAM, writing nothing', async () => {
      prisma.incidentResponder.findFirst.mockResolvedValue(null);
      // Found by lockActive, then the caller is not on its team.
      prisma.incident.findFirst.mockResolvedValueOnce(incidentRow);
      prisma.incident.findFirstOrThrow.mockResolvedValueOnce({
        responseAccess: 'OPEN',
        assignees: [],
        team: { memberships: [] },
      });

      const response = await send('post', `${base}/1/responders/me`);

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('NOT_ON_RESPONSIBLE_TEAM');
      expect(prisma.incidentResponder.create).not.toHaveBeenCalled();
    });

    it('should mark their own response complete, answering 200', async () => {
      const response = await send('post', `${base}/1/responders/me/complete`);

      expect(response.status).toBe(200);
      expect(prisma.incidentResponder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { status: 'COMPLETED', completedAt: expect.any(Date) },
        }),
      );
    });

    it('should take no body naming someone else: the responder is the caller', async () => {
      const response = await send('post', `${base}/1/responders/me`, {
        membershipId: '0199a1b2-c3d4-7000-8000-0000000000bb',
      });

      // The body is ignored; the response started is the caller's own.
      expect(response.status).toBe(200);
      expect(
        prisma.incidentResponder.findFirst.mock.calls[0][0].where,
      ).toMatchObject({ membershipId: MEMBERSHIP_ID });
    });
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
      '',
      'from=2026-09-13',
      'to=2026-09-19',
      'from=2026-09-19&to=2026-09-13',
      'from=2025-01-01&to=2026-09-19',
      'from=2026-09-13T00:00:00Z&to=2026-09-19',
    ])('should refuse the activity period %s with 400', async (query) => {
      const response = await send('get', `${base}/activity?${query}`);

      expect(response.status).toBe(400);
      expect(prisma.incidentActivity.findMany).not.toHaveBeenCalled();
    });

    it.each([
      '',
      'from=2026-09-13',
      'to=2026-09-19',
      'from=2026-09-19&to=2026-09-13',
      'from=2025-01-01&to=2026-09-19',
      'from=2026-09-13T00:00:00Z&to=2026-09-19',
      'from=2026-02-30&to=2026-03-02',
    ])('should refuse the occurrence period %s with 400', async (query) => {
      const response = await send('get', `${base}/occurrence?${query}`);

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
          where: {
            AND: expect.arrayContaining([
              expect.objectContaining({
                resolvedAt: {
                  gte: new Date('2026-09-13T00:00:00.000Z'),
                  lt: new Date('2026-09-20T00:00:00.000Z'),
                },
              }),
            ]),
          },
        }),
      );
    });

    it('should refuse a malformed cursor with 400', async () => {
      const response = await send('get', `${base}?state=resolved&cursor=abc`);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('INVALID_CURSOR');
    });

    it.each([
      { status: 'DECLARED' },
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

    it.each([{ leadMembershipId: MEMBERSHIP_ID }, { leadMembershipId: null }])(
      'should refuse the retired lead in %o with 400',
      async (body) => {
        const response = await send('patch', `${base}/1`, body);

        expect(response.status).toBe(400);
        expect(prisma.incident.update).not.toHaveBeenCalled();
      },
    );

    it.each(['DECLARED', 'INVESTIGATING', 'IDENTIFIED', 'MONITORING'])(
      'should refuse moving an incident to %s with 400, naming the field',
      async (status) => {
        const response = await send('patch', `${base}/1`, { status });

        expect(response.status).toBe(400);
        expect(response.body.details).toEqual([
          { field: 'status', message: expect.any(String) },
        ]);
        expect(prisma.incident.update).not.toHaveBeenCalled();
      },
    );

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
      {
        method: 'get' as const,
        path: `${base}/activity?from=2026-09-13&to=2026-09-19`,
      },
      {
        method: 'get' as const,
        path: `${base}/occurrence?from=2026-09-13&to=2026-09-19`,
      },
      { method: 'get' as const, path: `${base}/attention` },
      { method: 'post' as const, path: base },
      { method: 'patch' as const, path: `${base}/1` },
      { method: 'get' as const, path: `${base}/1/timeline` },
      { method: 'post' as const, path: `${base}/1/updates` },
      { method: 'post' as const, path: `${base}/1/responders/me` },
      { method: 'post' as const, path: `${base}/1/responders/me/complete` },
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
      expect(prisma.incidentActivity.create).not.toHaveBeenCalled();
      expect(prisma.incidentResponder.create).not.toHaveBeenCalled();
      expect(prisma.incidentResponder.update).not.toHaveBeenCalled();
    });
  });
  describe("a member's responses", () => {
    const responses = (membershipId: string) =>
      `/api/v1/organizations/${ORG_ID}/memberships/${membershipId}/responses`;

    it.each(['ADMIN', 'RESPONDER'] as const)(
      'should let a %s read their own, as a page',
      async (role) => {
        admitAs(role);
        prisma.incidentResponder.findMany.mockResolvedValue([]);

        const response = await send('get', responses(MEMBERSHIP_ID));

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
          items: [],
          page: { cursor: null, hasMore: false },
        });
      },
    );

    it("should let an ADMIN read another member's, as oversight", async () => {
      admitAs('ADMIN');
      prisma.incidentResponder.findMany.mockResolvedValue([]);

      const response = await send('get', responses(ANOTHER_MEMBERSHIP_ID));

      expect(response.status).toBe(200);
      expect(prisma.incidentResponder.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: ORG_ID,
            membershipId: ANOTHER_MEMBERSHIP_ID,
          }),
        }),
      );
    });

    it("should answer a MEMBER asking for another member's with 404, reading nothing", async () => {
      admitAs('RESPONDER');

      const response = await send('get', responses(ANOTHER_MEMBERSHIP_ID));

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('MEMBERSHIP_NOT_FOUND');
      // Refused before the membership is even looked up, so whether it
      // exists is not disclosed by the reply or by how long it took.
      expect(prisma.membership.findFirst).not.toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: ANOTHER_MEMBERSHIP_ID }),
        }),
      );
      expect(prisma.incidentResponder.findMany).not.toHaveBeenCalled();
    });

    it('should answer a malformed membership id with 404, reading no responses', async () => {
      admitAs('RESPONDER');

      const response = await send('get', responses('not-a-membership'));

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('MEMBERSHIP_NOT_FOUND');
      expect(prisma.incidentResponder.findMany).not.toHaveBeenCalled();
    });

    it('should refuse a malformed cursor with 400', async () => {
      admitAs('RESPONDER');

      const response = await send(
        'get',
        `${responses(MEMBERSHIP_ID)}?cursor=yesterday`,
      );

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('INVALID_CURSOR');
      expect(prisma.incidentResponder.findMany).not.toHaveBeenCalled();
    });
  });

  describe("a member's response activity", () => {
    const activity = (membershipId: string, query = PERIOD) =>
      `/api/v1/organizations/${ORG_ID}/memberships/${membershipId}/activity?${query}`;

    it.each(['ADMIN', 'RESPONDER'] as const)(
      'should let a %s read their own, as a calendar of days',
      async (role) => {
        admitAs(role);

        const response = await send('get', activity(MEMBERSHIP_ID));

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({
          from: '2026-09-13',
          to: '2026-09-19',
          total: 0,
          activeDays: 0,
          // A person's bands, not the organization's.
          thresholds: [1, 2, 4, 6],
        });
        expect(response.body.days).toHaveLength(7);
      },
    );

    it('should read the entries this member wrote in the admitted organization', async () => {
      admitAs('RESPONDER');

      const response = await send('get', activity(MEMBERSHIP_ID));

      expect(response.status).toBe(200);
      // The actor is the membership's own user, resolved within the
      // organization — never anything the request named.
      expect(prisma.incidentActivity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: ORG_ID,
            actorId: USER_ID,
          }),
        }),
      );
    });

    it("should let an ADMIN read another member's, as oversight", async () => {
      const admitted = admitAs('ADMIN').getMockImplementation();
      const OTHER_USER_ID = '0199a1b2-c3d4-7000-8000-000000000002';

      // Admission resolves the caller; the addressed membership resolves to
      // its own user, whose entries are the ones read.
      prisma.membership.findFirst.mockImplementation(
        (args: { where: Record<string, unknown> }) =>
          args.where.id === ANOTHER_MEMBERSHIP_ID
            ? { id: ANOTHER_MEMBERSHIP_ID, userId: OTHER_USER_ID }
            : admitted?.(args),
      );

      const response = await send('get', activity(ANOTHER_MEMBERSHIP_ID));

      expect(response.status).toBe(200);
      expect(prisma.incidentActivity.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            organizationId: ORG_ID,
            actorId: OTHER_USER_ID,
          }),
        }),
      );
    });

    it("should answer a MEMBER asking for another member's with 404, reading nothing", async () => {
      admitAs('RESPONDER');

      const response = await send('get', activity(ANOTHER_MEMBERSHIP_ID));

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('MEMBERSHIP_NOT_FOUND');
      expect(prisma.membership.findFirst).not.toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: ANOTHER_MEMBERSHIP_ID }),
        }),
      );
      expect(prisma.incidentActivity.findMany).not.toHaveBeenCalled();
    });

    it('should answer a malformed membership id with 404, reading no activity', async () => {
      admitAs('RESPONDER');

      const response = await send('get', activity('not-a-membership'));

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('MEMBERSHIP_NOT_FOUND');
      expect(prisma.incidentActivity.findMany).not.toHaveBeenCalled();
    });

    it('should answer a membership this organization lacks with 404', async () => {
      // Asked by an oversight caller: for anyone else the id is refused
      // before this lookup, which is what the test above proves.
      const admitted = admitAs('ADMIN').getMockImplementation();

      // Admission still resolves the caller; the addressed membership, which
      // this organization does not have, resolves to nothing.
      prisma.membership.findFirst.mockImplementation(
        (args: { where: Record<string, unknown> }) =>
          args.where.id === OTHER_MEMBERSHIP_ID ? null : admitted?.(args),
      );

      const response = await send('get', activity(OTHER_MEMBERSHIP_ID));

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('MEMBERSHIP_NOT_FOUND');
      expect(prisma.incidentActivity.findMany).not.toHaveBeenCalled();
    });

    it.each([
      '',
      'from=2026-09-13',
      'to=2026-09-19',
      'from=2026-09-19&to=2026-09-13',
      'from=2025-01-01&to=2026-09-19',
    ])('should refuse the period %s with 400', async (query) => {
      admitAs('RESPONDER');

      const response = await send('get', activity(MEMBERSHIP_ID, query));

      expect(response.status).toBe(400);
      expect(prisma.incidentActivity.findMany).not.toHaveBeenCalled();
    });
  });
});
