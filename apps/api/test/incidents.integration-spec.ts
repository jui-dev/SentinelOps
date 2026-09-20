import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from './../src/app.module.js';
import { TokenService } from './../src/auth/token.service.js';
import { PrismaService } from './../src/database/prisma.service.js';
import type { Prisma } from './../src/generated/prisma/client.js';
import {
  HISTORY_PREVIEW_LIMIT,
  INCIDENT_PAGE_SIZE,
  IncidentsService,
  RESPONSE_PAGE_SIZE,
} from './../src/incidents/incidents.service.js';
import { leakedKeys } from './leaks.js';
import { resolveTestDatabaseUrl } from './test-database.js';

/**
 * Incidents against a real database.
 *
 * Two tenants. Alice owns A, Bob owns B, Carol is ADMIN in A and MEMBER in B
 * — one token, two capacities — and Dave and Erin are plain MEMBERs of A. A
 * has two teams, Payments (Dave) and Platform (Erin), and a Payment API owned
 * by Payments; B has its own Payments and Payment API.
 *
 * What is proven here and nowhere else: that an admin declares and resolves;
 * that the responsible team's members start investigating, which moves a
 * declared incident, post updates while investigating, and complete their
 * own responses; that nobody resolves while a responder is investigating;
 * that who may start follows a reassignment, which the timeline records,
 * while a response already started is finished;
 * that each caller's attention follows the incidents as they stand — the
 * admin's resolvable ones, a team's unclaimed ones, a member's own responses
 * — through reassignments and team changes, within one organization;
 * that the responsible team is a snapshot of the service's owner; that
 * numbers are per organization and distinct under concurrency; that both
 * lists page completely; that foreign incidents, services, and teams are
 * indistinguishable from missing ones; that archival refuses declarations;
 * that the delete refusals are recognised through the real driver adapter;
 * and that every race between a declaration and a change to its service has
 * the outcome IncidentsService documents — never a 500, never an orphan.
 */

interface Fixture {
  orgA: string;
  orgB: string;
  alice: string;
  bob: string;
  carol: string;
  dave: string;
  erin: string;
  carolInB: string;
  daveInA: string;
  erinInA: string;
  paymentsA: string;
  platformA: string;
  paymentsB: string;
  apiA: string;
  apiB: string;
}

type Role = 'ADMIN' | 'MEMBER';

/** The error body with the per-request fields removed, for comparison. */
const comparable = (body: Record<string, unknown>) => {
  const {
    requestId: _requestId,
    timestamp: _timestamp,
    path: _path,
    ...rest
  } = body;

  return rest;
};

const SEVERITY_ORDER = ['SEV1', 'SEV2', 'SEV3', 'SEV4'];

describe('incidents (integration)', () => {
  const prisma = new PrismaService({ url: resolveTestDatabaseUrl() });
  let app: INestApplication;
  let tokens: TokenService;
  let fx: Fixture;

  const call = async (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    userId: string,
    body?: object,
  ): Promise<request.Response> => {
    const pending = request(app.getHttpServer())
      [method](`/api/v1/organizations/${path}`)
      .set('Authorization', `Bearer ${await tokens.signAccessToken(userId)}`);
    const response = await (body === undefined ? pending : pending.send(body));

    expect(leakedKeys(response.body)).toEqual([]);

    return response;
  };

  const expectCode = (
    response: request.Response,
    status: number,
    code: string,
  ) => {
    expect(response.status).toBe(status);
    expect(response.body.code).toBe(code);
  };

  const declare = (
    organizationId: string,
    userId: string,
    serviceId: string,
    extra: object = {},
  ) =>
    call('post', `${organizationId}/incidents`, userId, {
      title: 'Card payments failing',
      serviceId,
      severity: 'SEV1',
      ...extra,
    });

  /** The caller starts investigating incident `number`. */
  const startAs = (organizationId: string, userId: string, number: number) =>
    call('post', `${organizationId}/incidents/${number}/responders/me`, userId);

  /** The caller marks their own response to incident `number` complete. */
  const completeAs = (organizationId: string, userId: string, number: number) =>
    call(
      'post',
      `${organizationId}/incidents/${number}/responders/me/complete`,
      userId,
    );

  /**
   * Takes a declared Payment API incident in A through the response to
   * RESOLVED — Dave, on Payments, starts investigating and completes his
   * response, then `userId` resolves it — and answers with the resolution.
   */
  const resolve = async (
    organizationId: string,
    userId: string,
    number: number,
  ) => {
    expect((await startAs(organizationId, fx.dave, number)).status).toBe(200);
    expect((await completeAs(organizationId, fx.dave, number)).status).toBe(
      200,
    );

    return call('patch', `${organizationId}/incidents/${number}`, userId, {
      status: 'RESOLVED',
      resolution: 'Rolled back.',
    });
  };

  /** A new MEMBER of A, placed on `teamId`. Answers their user id. */
  const aMemberOn = async (teamId: string, name: string) => {
    const user = await prisma.user.create({
      data: { email: `${name.toLowerCase()}@acme.example`, name },
      select: { id: true },
    });
    const membership = await prisma.membership.create({
      data: { organizationId: fx.orgA, userId: user.id, role: 'MEMBER' },
      select: { id: true },
    });

    await prisma.teamMembership.create({
      data: { organizationId: fx.orgA, teamId, membershipId: membership.id },
    });

    return user.id;
  };

  const aTeam = async (organizationId: string, name: string) =>
    (
      await prisma.team.create({
        data: {
          organizationId,
          name,
          slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        },
        select: { id: true },
      })
    ).id;

  const aService = async (
    organizationId: string,
    ownerTeamId: string,
    name: string,
  ) =>
    (
      await prisma.service.create({
        data: {
          organizationId,
          ownerTeamId,
          name,
          slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        },
        select: { id: true },
      })
    ).id;

  const seed = async (): Promise<Fixture> => {
    const organization = async (name: string, slug: string) =>
      (
        await prisma.organization.create({
          data: { name, slug },
          select: { id: true },
        })
      ).id;
    const user = async (email: string, name: string) =>
      (
        await prisma.user.create({
          data: { email, name },
          select: { id: true },
        })
      ).id;
    const grant = async (organizationId: string, userId: string, role: Role) =>
      (
        await prisma.membership.create({
          data: { organizationId, userId, role },
          select: { id: true },
        })
      ).id;

    const orgA = await organization('Acme Operations', 'acme-operations');
    const orgB = await organization('Bravo Reliability', 'bravo-reliability');
    const alice = await user('alice@acme.example', 'Alice Anders');
    const bob = await user('bob@bravo.example', 'Bob Brandt');
    const carol = await user('carol@both.example', 'Carol Chen');
    const dave = await user('dave@acme.example', 'Dave Duarte');
    const erin = await user('erin@acme.example', 'Erin Estrada');

    await grant(orgA, alice, 'ADMIN');
    await grant(orgB, bob, 'ADMIN');
    await grant(orgA, carol, 'ADMIN');
    const carolInB = await grant(orgB, carol, 'MEMBER');
    const daveInA = await grant(orgA, dave, 'MEMBER');
    const erinInA = await grant(orgA, erin, 'MEMBER');

    const paymentsA = await aTeam(orgA, 'Payments');
    const platformA = await aTeam(orgA, 'Platform');
    const paymentsB = await aTeam(orgB, 'Payments');

    // Dave responds for Payments, which owns the Payment API; Erin is on
    // Platform. Alice and Carol, the admins, are on no team.
    await prisma.teamMembership.createMany({
      data: [
        { organizationId: orgA, teamId: paymentsA, membershipId: daveInA },
        { organizationId: orgA, teamId: platformA, membershipId: erinInA },
      ],
    });

    return {
      orgA,
      orgB,
      alice,
      bob,
      carol,
      dave,
      erin,
      carolInB,
      daveInA,
      erinInA,
      paymentsA,
      platformA,
      paymentsB,
      apiA: await aService(orgA, paymentsA, 'Payment API'),
      apiB: await aService(orgB, paymentsB, 'Payment API'),
    };
  };

  /**
   * Runs `work` in a transaction and holds it open — with its locks — until
   * `release` is called. See invitations.integration-spec.ts.
   */
  const hold = async (
    work: (tx: Prisma.TransactionClient) => Promise<unknown>,
  ) => {
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const started = new Promise<void>((resolve) => (ready = resolve));

    const done = prisma.$transaction(
      async (tx) => {
        await work(tx);
        ready();
        await gate;
      },
      { timeout: 20_000 },
    );

    await started;

    return { release, done };
  };

  /** Resolves once some other session in this database is waiting on a lock. */
  const someoneIsWaitingOnALock = async () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const [{ waiting }] = await prisma.$queryRaw<{ waiting: number }[]>`
        SELECT count(*)::int AS waiting
        FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`;

      if (waiting > 0) return;

      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    throw new Error('No session started waiting on a lock');
  };

  /** Starts a request without awaiting it, and without an unhandled rejection. */
  const inFlight = (pending: Promise<request.Response>) => {
    pending.catch(() => undefined);

    return pending;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('/api/v1');
    await app.init();

    tokens = app.get(TokenService);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE incidents, services, team_memberships, teams, invitations, refresh_tokens, memberships, users, organizations RESTART IDENTITY CASCADE',
    );

    fx = await seed();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('lifecycle', () => {
    it('should let an admin declare an incident, start its investigation, and resolve it, one step at a time', async () => {
      const declared = await declare(fx.orgA, fx.alice, fx.apiA, {
        summary: 'Card declines since 14:02',
      });

      expect(declared.status).toBe(201);
      expect(declared.body).toEqual(
        expect.objectContaining({
          number: 1,
          status: 'DECLARED',
          severity: 'SEV1',
          summary: 'Card declines since 14:02',
          resolvedAt: null,
          service: expect.objectContaining({
            id: fx.apiA,
            criticality: 'NORMAL',
          }),
          team: expect.objectContaining({ id: fx.paymentsA, name: 'Payments' }),
          createdBy: { id: fx.alice, name: 'Alice Anders' },
        }),
      );

      const path = `${fx.orgA}/incidents/1`;

      // A declared incident is investigated before it is resolved, and a
      // refused move applies nothing else the request names.
      expectCode(
        await call('patch', path, fx.alice, {
          status: 'RESOLVED',
          resolution: 'Rolled back.',
          severity: 'SEV3',
        }),
        409,
        'INVALID_STATUS_TRANSITION',
      );
      expect((await call('get', path, fx.alice)).body).toEqual(declared.body);

      // Nobody starts the investigation by hand, and there is no way back to
      // DECLARED: neither is a status a change can name.
      for (const status of ['INVESTIGATING', 'DECLARED']) {
        expect((await call('patch', path, fx.alice, { status })).status).toBe(
          400,
        );
      }

      // A responder starting to investigate moves it.
      const started = await startAs(fx.orgA, fx.dave, 1);

      expect(started.status).toBe(200);
      expect(started.body.status).toBe('INVESTIGATING');
      expect(started.body.resolvedAt).toBeNull();

      // Not resolved while Dave investigates, and nothing else applied.
      expectCode(
        await call('patch', path, fx.alice, {
          status: 'RESOLVED',
          resolution: 'Rolled back.',
          severity: 'SEV2',
        }),
        409,
        'RESPONDERS_STILL_INVESTIGATING',
      );
      expect((await call('get', path, fx.alice)).body.severity).toBe('SEV1');

      expect((await completeAs(fx.orgA, fx.dave, 1)).status).toBe(200);

      const resolved = await call('patch', path, fx.alice, {
        status: 'RESOLVED',
        resolution: 'Rolled back.',
        severity: 'SEV2',
      });

      expect(resolved.status).toBe(200);
      expect(resolved.body.status).toBe('RESOLVED');
      expect(resolved.body.severity).toBe('SEV2');
      expect(Date.parse(resolved.body.resolvedAt)).not.toBeNaN();
      expect(resolved.body.resolution).toBe('Rolled back.');

      // The note is history too: the resolution's own timeline entry.
      const timeline = await call('get', `${path}/timeline`, fx.dave);

      expect(timeline.body.at(-1)).toEqual(
        expect.objectContaining({
          type: 'STATUS_CHANGED',
          fromValue: 'INVESTIGATING',
          toValue: 'RESOLVED',
          message: 'Rolled back.',
        }),
      );

      // Resolved is terminal: nothing about it changes again.
      for (const change of [
        { title: 'Typo fixed' },
        { status: 'RESOLVED', resolution: 'Rolled back.' },
        { teamId: fx.platformA },
      ]) {
        expectCode(
          await call('patch', path, fx.alice, change),
          409,
          'INCIDENT_RESOLVED',
        );
      }

      expect((await call('get', path, fx.dave)).body).toEqual(resolved.body);
    });

    it('should let a member read an incident and post updates, but not run its lifecycle', async () => {
      await declare(fx.orgA, fx.alice, fx.apiA);
      const path = `${fx.orgA}/incidents/1`;
      const before = await call('get', path, fx.dave);

      expect(before.status).toBe(200);

      for (const refused of [
        declare(fx.orgA, fx.dave, fx.apiA),
        call('patch', path, fx.dave, { title: 'Renamed' }),
        call('patch', path, fx.dave, { summary: 'Rewritten' }),
        call('patch', path, fx.dave, { severity: 'SEV3' }),
        call('patch', path, fx.dave, { status: 'INVESTIGATING' }),
        call('patch', path, fx.dave, { status: 'RESOLVED', resolution: 'Rolled back.' }),
        call('patch', path, fx.dave, { teamId: fx.platformA }),
      ]) {
        expectCode(await refused, 403, 'PERMISSION_DENIED');
      }

      // Nothing the refusals named was written: one incident, as declared.
      const after = await call('get', path, fx.dave);

      expect(after.body).toEqual(before.body);
      expect(await prisma.incident.count()).toBe(1);

      // Responding is theirs: start, then post.
      expect((await startAs(fx.orgA, fx.dave, 1)).status).toBe(200);

      const posted = await call('post', `${path}/updates`, fx.dave, {
        message: 'Seeing timeouts from the card processor.',
      });

      expect(posted.status).toBe(201);
      expect(posted.body.actor).toEqual({ id: fx.dave, name: 'Dave Duarte' });
      expect(
        (await call('get', `${path}/timeline`, fx.dave)).body.map(
          ({ type }: { type: string }) => type,
        ),
      ).toEqual(['DECLARED', 'RESPONSE_STARTED', 'STATUS_CHANGED', 'UPDATE']);
    });

    it('should snapshot the owner as the responsible team: reassigning the service rewrites no history', async () => {
      await declare(fx.orgA, fx.alice, fx.apiA);

      expect(
        (
          await call('patch', `${fx.orgA}/services/${fx.apiA}`, fx.alice, {
            ownerTeamId: fx.platformA,
          })
        ).status,
      ).toBe(200);

      const later = await declare(fx.orgA, fx.alice, fx.apiA);
      const earlier = await call('get', `${fx.orgA}/incidents/1`, fx.alice);

      expect(earlier.body.team.id).toBe(fx.paymentsA);
      expect(later.body.team.id).toBe(fx.platformA);
    });

    it('should reassign the responsible team within the organization only', async () => {
      await declare(fx.orgA, fx.alice, fx.apiA);
      const path = `${fx.orgA}/incidents/1`;

      const moved = await call('patch', path, fx.alice, {
        teamId: fx.platformA,
      });

      expect(moved.status).toBe(200);
      expect(moved.body.team.id).toBe(fx.platformA);

      const foreign = await call('patch', path, fx.alice, {
        teamId: fx.paymentsB,
      });
      const missing = await call('patch', path, fx.alice, {
        teamId: randomUUID(),
      });

      expectCode(foreign, 404, 'TEAM_NOT_FOUND');
      expect(comparable(foreign.body)).toEqual(comparable(missing.body));
      expect(
        (
          await prisma.incident.findFirstOrThrow({
            where: { organizationId: fx.orgA },
          })
        ).teamId,
      ).toBe(fx.platformA);
    });

    it('should name the declarer after their account is deleted', async () => {
      await declare(fx.orgA, fx.carol, fx.apiA);
      await prisma.user.update({
        where: { id: fx.carol },
        data: { deletedAt: new Date() },
      });

      expect(
        (await call('get', `${fx.orgA}/incidents/1`, fx.alice)).body.createdBy,
      ).toEqual({ id: fx.carol, name: 'Carol Chen' });
    });

    it('should judge one token by the role it holds in each organization', async () => {
      // Carol is ADMIN in A and MEMBER in B: she may declare only in A.
      expect((await declare(fx.orgA, fx.carol, fx.apiA)).status).toBe(201);
      expectCode(
        await declare(fx.orgB, fx.carol, fx.apiB),
        403,
        'PERMISSION_DENIED',
      );
    });
  });

  describe('numbering', () => {
    it('should number each organization independently', async () => {
      const a1 = await declare(fx.orgA, fx.alice, fx.apiA);
      const a2 = await declare(fx.orgA, fx.alice, fx.apiA);
      const b1 = await declare(fx.orgB, fx.bob, fx.apiB);

      expect([a1.body.number, a2.body.number, b1.body.number]).toEqual([
        1, 2, 1,
      ]);
    });

    it('should give concurrent declarations distinct numbers, all of them succeeding', async () => {
      const responses = await Promise.all(
        Array.from({ length: 10 }, () => declare(fx.orgA, fx.alice, fx.apiA)),
      );

      expect(responses.map((response) => response.status)).toEqual(
        Array(10).fill(201),
      );

      const numbers = responses.map(
        (response) => response.body.number as number,
      );

      expect(new Set(numbers).size).toBe(10);
      expect(
        (
          await prisma.organization.findUniqueOrThrow({
            where: { id: fx.orgA },
          })
        ).lastIncidentNumber,
      ).toBe(Math.max(...numbers));
    });

    it('should not consume a number for a refused declaration', async () => {
      await declare(fx.orgA, fx.alice, randomUUID());
      await declare(fx.orgA, fx.alice, fx.apiB);

      expect((await declare(fx.orgA, fx.alice, fx.apiA)).body.number).toBe(1);
    });
  });

  describe('lists', () => {
    /** Incidents written directly: more than one page, mixed severities. */
    const many = (count: number, resolved: boolean) =>
      prisma.incident.createMany({
        data: Array.from({ length: count }, (_, index) => ({
          organizationId: fx.orgA,
          number: index + 1,
          title: `Incident ${index + 1}`,
          serviceId: fx.apiA,
          teamId: fx.paymentsA,
          createdById: fx.alice,
          severity: SEVERITY_ORDER[(index * 7) % 4] as 'SEV1',
          // Both active statuses, so both are paged as active.
          status: resolved
            ? ('RESOLVED' as const)
            : index % 2 === 0
              ? ('DECLARED' as const)
              : ('INVESTIGATING' as const),
          resolvedAt: resolved ? new Date() : null,
        })),
      });

    const walk = async (state: 'active' | 'resolved') => {
      const seen: { number: number; severity: string }[] = [];
      let cursor: string | null = null;
      let pages = 0;

      do {
        const query: string = cursor
          ? `state=${state}&cursor=${encodeURIComponent(cursor)}`
          : `state=${state}`;
        const response = await call(
          'get',
          `${fx.orgA}/incidents?${query}`,
          fx.dave,
        );

        expect(response.status).toBe(200);
        expect(response.body.page.hasMore).toBe(
          response.body.page.cursor !== null,
        );
        seen.push(...response.body.items);
        cursor = response.body.page.cursor;
        pages += 1;
      } while (cursor);

      return { seen, pages };
    };

    it('should page every active incident, most severe first, then longest-running', async () => {
      await many(INCIDENT_PAGE_SIZE + 7, false);

      const { seen, pages } = await walk('active');

      expect(pages).toBe(2);
      expect(seen).toHaveLength(INCIDENT_PAGE_SIZE + 7);
      expect(new Set(seen.map(({ number }) => number)).size).toBe(seen.length);

      const expected = [...seen].sort(
        (a, b) =>
          SEVERITY_ORDER.indexOf(a.severity) -
            SEVERITY_ORDER.indexOf(b.severity) || a.number - b.number,
      );

      expect(seen).toEqual(expected);
    });

    it('should page every resolved incident, most recent first', async () => {
      await many(INCIDENT_PAGE_SIZE + 3, true);

      const { seen, pages } = await walk('resolved');

      expect(pages).toBe(2);
      expect(seen.map(({ number }) => number)).toEqual(
        Array.from(
          { length: INCIDENT_PAGE_SIZE + 3 },
          (_, index) => INCIDENT_PAGE_SIZE + 3 - index,
        ),
      );
    });

    it('should keep the two states apart and each organization to itself', async () => {
      await declare(fx.orgA, fx.alice, fx.apiA);
      await declare(fx.orgA, fx.alice, fx.apiA);
      await resolve(fx.orgA, fx.alice, 2);
      await declare(fx.orgB, fx.bob, fx.apiB);

      const active = await call(
        'get',
        `${fx.orgA}/incidents?state=active`,
        fx.alice,
      );
      const resolved = await call(
        'get',
        `${fx.orgA}/incidents?state=resolved`,
        fx.alice,
      );

      expect(
        active.body.items.map((each: { number: number }) => each.number),
      ).toEqual([1]);
      expect(
        resolved.body.items.map((each: { number: number }) => each.number),
      ).toEqual([2]);
    });

    it('should narrow each state by the moment that defines it', async () => {
      // Declared before the period, resolved inside it.
      await prisma.incident.create({
        data: {
          organizationId: fx.orgA,
          number: 1,
          title: 'Declared earlier, resolved inside',
          serviceId: fx.apiA,
          teamId: fx.paymentsA,
          createdById: fx.alice,
          severity: 'SEV2',
          status: 'RESOLVED',
          createdAt: new Date('2026-09-01T08:00:00Z'),
          resolvedAt: new Date('2026-09-15T08:00:00Z'),
        },
      });
      // Declared inside the period, still running.
      await prisma.incident.create({
        data: {
          organizationId: fx.orgA,
          number: 2,
          title: 'Declared inside, still running',
          serviceId: fx.apiA,
          teamId: fx.paymentsA,
          createdById: fx.alice,
          severity: 'SEV3',
          // Not yet investigated: still active, and still open.
          status: 'DECLARED',
          createdAt: new Date('2026-09-15T09:00:00Z'),
        },
      });
      // Declared and resolved outside it.
      await prisma.incident.create({
        data: {
          organizationId: fx.orgA,
          number: 3,
          title: 'Outside the period',
          serviceId: fx.apiA,
          teamId: fx.paymentsA,
          createdById: fx.alice,
          severity: 'SEV4',
          status: 'RESOLVED',
          createdAt: new Date('2026-08-01T08:00:00Z'),
          resolvedAt: new Date('2026-08-02T08:00:00Z'),
        },
      });

      const period = 'from=2026-09-13&to=2026-09-19';
      const numbers = async (state: string) =>
        (
          await call(
            'get',
            `${fx.orgA}/incidents?state=${state}&${period}`,
            fx.dave,
          )
        ).body.items.map((each: { number: number }) => each.number);

      // Active: declared in the period. Resolved: resolved in it.
      expect(await numbers('active')).toEqual([2]);
      expect(await numbers('resolved')).toEqual([1]);
    });

    it.each([
      'from=2026-09-13',
      'to=2026-09-19',
      'from=2026-09-19&to=2026-09-13',
      'from=2025-01-01&to=2026-09-19',
    ])('should refuse the period %s with 400', async (period) => {
      expect(
        (
          await call(
            'get',
            `${fx.orgA}/incidents?state=active&${period}`,
            fx.dave,
          )
        ).status,
      ).toBe(400);
    });

    it('should refuse a cursor that does not fit the state', async () => {
      expectCode(
        await call(
          'get',
          `${fx.orgA}/incidents?state=active&cursor=41`,
          fx.alice,
        ),
        400,
        'INVALID_CURSOR',
      );
    });

    describe('filters', () => {
      interface Listed {
        number: number;
        severity: string;
        service: { id: string };
        team: { id: string };
      }

      /** Every page of one state under `filters`, following the cursor. */
      const walkFiltered = async (
        state: 'active' | 'resolved',
        filters: string,
      ) => {
        const seen: Listed[] = [];
        let cursor: string | null = null;
        let pages = 0;

        do {
          const query: string = cursor
            ? `state=${state}&${filters}&cursor=${encodeURIComponent(cursor)}`
            : `state=${state}&${filters}`;
          const response = await call(
            'get',
            `${fx.orgA}/incidents?${query}`,
            fx.dave,
          );

          expect(response.status).toBe(200);
          seen.push(...response.body.items);
          cursor = response.body.page.cursor;
          pages += 1;
        } while (cursor);

        return { seen, pages };
      };

      /**
       * A second service in A, owned by Platform, and `count` incidents per
       * state spread across both services, both teams, and every severity —
       * so one filter alone still leaves more than a page.
       */
      const spread = async (count: number) => {
        const { id: portalA } = await prisma.service.create({
          data: {
            organizationId: fx.orgA,
            name: 'Customer Portal',
            slug: 'customer-portal',
            ownerTeamId: fx.platformA,
          },
          select: { id: true },
        });

        await prisma.incident.createMany({
          data: Array.from({ length: count * 2 }, (_, index) => {
            const resolved = index >= count;

            return {
              organizationId: fx.orgA,
              number: index + 1,
              title: `Incident ${index + 1}`,
              serviceId: index % 2 === 0 ? fx.apiA : portalA,
              teamId: index % 3 === 0 ? fx.platformA : fx.paymentsA,
              createdById: fx.alice,
              severity: SEVERITY_ORDER[(index * 7) % 4] as 'SEV1',
              status: resolved
                ? ('RESOLVED' as const)
                : ('INVESTIGATING' as const),
              resolvedAt: resolved ? new Date() : null,
            };
          }),
        });

        return portalA;
      };

      it.each(['active', 'resolved'] as const)(
        'should page every %s incident a filter matches, in order, and nothing else',
        async (state) => {
          const portalA = await spread(INCIDENT_PAGE_SIZE * 2 + 10);
          const everything = (await walkFiltered(state, 'q=Incident')).seen;
          const cases: [string, (each: Listed) => boolean][] = [
            [`serviceId=${fx.apiA}`, (each) => each.service.id === fx.apiA],
            [`teamId=${fx.paymentsA}`, (each) => each.team.id === fx.paymentsA],
            ['severity=SEV2', (each) => each.severity === 'SEV2'],
            [
              `severity=SEV2&serviceId=${portalA}&teamId=${fx.platformA}`,
              (each) =>
                each.severity === 'SEV2' &&
                each.service.id === portalA &&
                each.team.id === fx.platformA,
            ],
          ];

          for (const [filters, matches] of cases) {
            const { seen } = await walkFiltered(state, filters);
            const expected = everything.filter(matches);

            expect(expected.length).toBeGreaterThan(0);
            // The same incidents, in the unfiltered order, each once.
            expect(seen.map(({ number }) => number)).toEqual(
              expected.map(({ number }) => number),
            );
          }

          // One filter alone still spans pages, and pages to the end.
          const byService = await walkFiltered(state, `serviceId=${fx.apiA}`);

          expect(byService.pages).toBe(2);
          expect(byService.seen).toHaveLength(INCIDENT_PAGE_SIZE + 5);
        },
      );

      it('should search titles case-insensitively, taking % and _ literally, and find an incident by its number', async () => {
        for (const title of [
          'Checkout latency',
          'Slow CHECKOUT for EU customers',
          '100% CPU on the database',
          'login_errors spiking',
          'Login errors in Brazil',
          String.raw`Path C:\ops\runbook unreadable`,
        ]) {
          await declare(fx.orgA, fx.alice, fx.apiA, { title });
        }

        const found = async (q: string) =>
          (
            await call(
              'get',
              `${fx.orgA}/incidents?state=active&q=${encodeURIComponent(q)}`,
              fx.dave,
            )
          ).body.items
            .map((each: { number: number }) => each.number)
            .sort((a: number, b: number) => a - b);

        expect(await found('checkout')).toEqual([1, 2]);
        expect(await found('%')).toEqual([3]);
        expect(await found('_')).toEqual([4]);
        // The escape character is literal too.
        expect(await found('\\')).toEqual([6]);
        expect(await found('INC-5')).toEqual([5]);
        expect(await found('inc-5')).toEqual([5]);
        // A number matches that incident, and any title containing it.
        expect(await found('1')).toEqual([1, 3]);
        expect(await found('no such words')).toEqual([]);
      });

      it('should answer a service or team outside the organization with an empty page, not an error', async () => {
        await declare(fx.orgA, fx.alice, fx.apiA);
        await declare(fx.orgB, fx.bob, fx.apiB);

        for (const filter of [
          `serviceId=${fx.apiB}`,
          `teamId=${fx.paymentsB}`,
          'serviceId=0199a1b2-c3d4-7000-8000-00000000ffff',
        ]) {
          const response = await call(
            'get',
            `${fx.orgA}/incidents?state=active&${filter}`,
            fx.alice,
          );

          expect(response.status).toBe(200);
          expect(response.body).toEqual({
            items: [],
            page: { cursor: null, hasMore: false },
          });
        }
      });

      it.each([
        'severity=SEV0',
        'serviceId=payment-api',
        'teamId=payments',
        `q=${'x'.repeat(201)}`,
      ])('should refuse the filter %s with 400', async (filter) => {
        expect(
          (
            await call(
              'get',
              `${fx.orgA}/incidents?state=active&${filter}`,
              fx.dave,
            )
          ).status,
        ).toBe(400);
      });
    });
  });

  describe("a member's responses", () => {
    const responses = (
      organizationId: string,
      membershipId: string,
      userId: string,
      cursor?: string,
    ) =>
      call(
        'get',
        `${organizationId}/memberships/${membershipId}/responses${
          cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
        }`,
        userId,
      );

    it('should list only the incidents a member started, most recently started first, with their own state', async () => {
      for (let number = 1; number <= 3; number += 1) {
        await declare(fx.orgA, fx.alice, fx.apiA, { title: `Incident ${number}` });
      }

      expect((await startAs(fx.orgA, fx.dave, 1)).status).toBe(200);
      expect((await completeAs(fx.orgA, fx.dave, 1)).status).toBe(200);
      expect((await startAs(fx.orgA, fx.dave, 2)).status).toBe(200);
      // Reassigned to Platform: Dave's response stands, and Erin starts one.
      await call('patch', `${fx.orgA}/incidents/2`, fx.alice, {
        teamId: fx.platformA,
      });
      expect((await startAs(fx.orgA, fx.erin, 2)).status).toBe(200);
      expect((await startAs(fx.orgA, fx.dave, 3)).status).toBe(200);

      const dave = await responses(fx.orgA, fx.daveInA, fx.erin);

      expect(dave.status).toBe(200);
      expect(
        dave.body.items.map(
          (each: { incident: { number: number }; status: string }) => [
            each.incident.number,
            each.status,
          ],
        ),
      ).toEqual([
        [3, 'INVESTIGATING'],
        [2, 'INVESTIGATING'],
        [1, 'COMPLETED'],
      ]);
      expect(dave.body.items[2].completedAt).not.toBeNull();
      expect(dave.body.items[0].completedAt).toBeNull();
      // The incident as the lists give it: no responders, no resolution.
      expect(dave.body.items[0].incident).not.toHaveProperty('responders');
      expect(dave.body.items[0].incident).not.toHaveProperty('resolution');
      expect(dave.body.page).toEqual({ cursor: null, hasMore: false });

      const erin = await responses(fx.orgA, fx.erinInA, fx.dave);

      expect(
        erin.body.items.map(
          (each: { incident: { number: number } }) => each.incident.number,
        ),
      ).toEqual([2]);

      // On the responsible team, but never started: no responses at all.
      await aMemberOn(fx.paymentsA, 'Frank');
      const frank = await prisma.membership.findFirstOrThrow({
        where: { organizationId: fx.orgA, user: { name: 'Frank' } },
        select: { id: true },
      });

      expect((await responses(fx.orgA, frank.id, fx.dave)).body.items).toEqual(
        [],
      );
    });

    it('should page every response, most recently started first, a tie broken by id', async () => {
      const count = RESPONSE_PAGE_SIZE * 2 + 3;

      await prisma.incident.createMany({
        data: Array.from({ length: count }, (_, index) => ({
          organizationId: fx.orgA,
          number: index + 1,
          title: `Incident ${index + 1}`,
          serviceId: fx.apiA,
          teamId: fx.paymentsA,
          createdById: fx.alice,
          severity: 'SEV3' as const,
          status: 'INVESTIGATING' as const,
        })),
      });

      const incidents = await prisma.incident.findMany({
        where: { organizationId: fx.orgA },
        select: { id: true, number: true },
      });

      // Pairs of responses share a start, so the id decides between them.
      await prisma.incidentResponder.createMany({
        data: incidents.map(({ id, number }) => ({
          organizationId: fx.orgA,
          incidentId: id,
          membershipId: fx.daveInA,
          startedAt: new Date(
            Date.UTC(2026, 8, 1) + Math.floor(number / 2) * 60_000,
          ),
        })),
      });

      const seen: { startedAt: string; incident: { number: number } }[] = [];
      let cursor: string | undefined;
      let pages = 0;

      do {
        const page = await responses(fx.orgA, fx.daveInA, fx.dave, cursor);

        expect(page.status).toBe(200);
        seen.push(...page.body.items);
        cursor = page.body.page.cursor ?? undefined;
        pages += 1;
      } while (cursor);

      expect(pages).toBe(3);
      expect(seen).toHaveLength(count);
      expect(new Set(seen.map((each) => each.incident.number)).size).toBe(
        count,
      );

      const expected = await prisma.incidentResponder.findMany({
        where: { membershipId: fx.daveInA },
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        select: { incident: { select: { number: true } } },
      });

      expect(seen.map((each) => each.incident.number)).toEqual(
        expected.map((each) => each.incident.number),
      );
    });

    it('should answer a membership of another organization exactly as a missing one', async () => {
      await declare(fx.orgB, fx.bob, fx.apiB);

      const foreign = await responses(fx.orgA, fx.carolInB, fx.alice);
      const missing = await responses(
        fx.orgA,
        '0199a1b2-c3d4-7000-8000-00000000ffff',
        fx.alice,
      );
      const malformed = await responses(fx.orgA, 'not-a-membership', fx.alice);

      expectCode(foreign, 404, 'MEMBERSHIP_NOT_FOUND');
      expect(comparable(foreign.body)).toEqual(comparable(missing.body));
      expect(comparable(foreign.body)).toEqual(comparable(malformed.body));

      // And from the other side: A's member is not B's to read.
      expectCode(
        await responses(fx.orgB, fx.daveInA, fx.bob),
        404,
        'MEMBERSHIP_NOT_FOUND',
      );
    });

    it('should isolate in the service itself, with no guard in front of it', async () => {
      await declare(fx.orgA, fx.alice, fx.apiA);
      await startAs(fx.orgA, fx.dave, 1);

      const service = app.get(IncidentsService);

      await expect(
        service.memberResponses(fx.orgB, fx.daveInA, {}),
      ).rejects.toMatchObject({ status: 404 });
      expect(
        (await service.memberResponses(fx.orgA, fx.daveInA, {})).items,
      ).toHaveLength(1);
    });
  });

  describe('summary', () => {
    let next = 0;

    /** An incident written directly, with the times a test needs. */
    const at = (
      createdAt: string,
      extra: {
        resolvedAt?: string;
        severity?: 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4';
        organizationId?: string;
      } = {},
    ) => {
      const organizationId = extra.organizationId ?? fx.orgA;
      next += 1;

      return prisma.incident.create({
        data: {
          organizationId,
          number: next,
          title: `Incident ${next}`,
          serviceId: organizationId === fx.orgA ? fx.apiA : fx.apiB,
          teamId: organizationId === fx.orgA ? fx.paymentsA : fx.paymentsB,
          createdById: organizationId === fx.orgA ? fx.alice : fx.bob,
          severity: extra.severity ?? 'SEV2',
          status: extra.resolvedAt ? 'RESOLVED' : 'INVESTIGATING',
          createdAt: new Date(createdAt),
          resolvedAt: extra.resolvedAt ? new Date(extra.resolvedAt) : null,
        },
      });
    };

    /** The history as [number, declaredInPeriod, resolvedInPeriod] rows. */
    const history = (body: {
      period: {
        history: {
          items: {
            incident: { number: number };
            declaredInPeriod: boolean;
            resolvedInPeriod: boolean;
          }[];
        };
      };
    }) =>
      body.period.history.items.map((item) => [
        item.incident.number,
        item.declaredInPeriod,
        item.resolvedInPeriod,
      ]);

    const summary = async (
      from: string,
      to: string,
      organizationId = fx.orgA,
    ) => {
      const response = await call(
        'get',
        `${organizationId}/incidents/summary?from=${from}&to=${to}`,
        organizationId === fx.orgA ? fx.dave : fx.bob,
      );

      expect(response.status).toBe(200);

      return response.body;
    };

    beforeEach(() => {
      next = 0;
    });

    it('should count whole UTC days, both ends included, and keep the current state out of the period', async () => {
      // Active, declared long before the period.
      await at('2026-01-05T10:00:00Z', { severity: 'SEV1' });
      // Declared on the last instant before the period.
      await at('2026-09-12T23:59:59.999Z', {
        resolvedAt: '2026-09-13T00:00:00Z',
      });
      // Declared on the period's first and last instants; one still open.
      await at('2026-09-13T00:00:00Z', { severity: 'SEV3' });
      await at('2026-09-19T23:59:59.999Z', {
        severity: 'SEV1',
        resolvedAt: '2026-09-20T00:00:00Z',
      });
      // The first instant after the period.
      await at('2026-09-20T00:00:00Z', { severity: 'SEV4' });

      const body = await summary('2026-09-13', '2026-09-19');

      expect(body.current).toMatchObject({
        active: 3,
        activeBySeverity: { SEV1: 1, SEV2: 0, SEV3: 1, SEV4: 1 },
      });
      expect(body.current.affectedServices).toEqual([
        expect.objectContaining({
          id: fx.apiA,
          name: 'Payment API',
          ownerTeam: { id: fx.paymentsA, name: 'Payments', slug: 'payments' },
          activeIncidents: 3,
          worstSeverity: 'SEV1',
        }),
      ]);
      expect(body.period).toMatchObject({
        from: '2026-09-13',
        to: '2026-09-19',
        declared: 2,
        declaredBySeverity: { SEV1: 1, SEV2: 0, SEV3: 1, SEV4: 0 },
        // Resolved at the period's first instant, though declared before it.
        resolved: 1,
        stillOpen: 1,
      });
      // Three things happened in the period: two declarations, and the
      // resolution of an incident declared before it.
      expect(body.period.history.total).toBe(3);
      expect(history(body)).toEqual([
        [4, true, false],
        [3, true, false],
        [2, false, true],
      ]);
    });

    it('should order the history by what happened last, and count each incident once', async () => {
      // 1: declared and resolved in the day — one entry, both flags.
      await at('2026-09-19T09:15:00Z', { resolvedAt: '2026-09-19T23:59:00Z' });
      // 2: declared in the day, still running.
      await at('2026-09-19T09:45:00Z', { severity: 'SEV1' });
      // 3: declared before the day, resolved in it.
      await at('2026-09-01T12:00:00Z', { resolvedAt: '2026-09-19T09:30:00Z' });
      // 4: declared before the day and resolved after it — no part of it.
      await at('2026-09-01T12:00:00Z', { resolvedAt: '2026-09-20T09:30:00Z' });

      const body = await summary('2026-09-19', '2026-09-19');

      expect(body.period).toMatchObject({
        declared: 2,
        resolved: 2,
        stillOpen: 1,
      });
      // Two declared plus two resolved, less the one that was both.
      expect(body.period.history.total).toBe(3);
      expect(history(body)).toEqual([
        // Resolved at 23:59.
        [1, true, true],
        // Declared at 09:45, still running.
        [2, true, false],
        // Resolved at 09:30, declared on 1 September.
        [3, false, true],
      ]);
    });

    it('should count past a page, and preview only the ten most recent', async () => {
      for (let index = 0; index < INCIDENT_PAGE_SIZE + 7; index += 1) {
        await at('2026-09-15T08:00:00Z');
      }
      for (let hour = 1; hour <= 7; hour += 1) {
        await at('2026-09-14T00:00:00Z', {
          resolvedAt: `2026-09-16T${String(hour).padStart(2, '0')}:00:00Z`,
        });
      }

      const body = await summary('2026-09-13', '2026-09-19');

      expect(body.current.active).toBe(INCIDENT_PAGE_SIZE + 7);
      expect(body.period.declared).toBe(INCIDENT_PAGE_SIZE + 14);
      expect(body.period.resolved).toBe(7);
      // Every incident here was declared in the period, so each counts once
      // however many things happened to it.
      expect(body.period.history.total).toBe(INCIDENT_PAGE_SIZE + 14);
      expect(body.period.history.items).toHaveLength(HISTORY_PREVIEW_LIMIT);
      // The seven resolutions on the 16th, then the newest declarations.
      expect(history(body).slice(0, 8)).toEqual([
        [64, true, true],
        [63, true, true],
        [62, true, true],
        [61, true, true],
        [60, true, true],
        [59, true, true],
        [58, true, true],
        [57, true, false],
      ]);
    });

    it('should keep each organization to itself', async () => {
      await at('2026-09-15T08:00:00Z');
      await at('2026-09-15T08:00:00Z', { organizationId: fx.orgB });
      await at('2026-09-15T08:00:00Z', {
        organizationId: fx.orgB,
        resolvedAt: '2026-09-16T08:00:00Z',
      });

      const body = await summary('2026-09-13', '2026-09-19');

      expect(body.current.active).toBe(1);
      expect(
        body.current.affectedServices.map((each: { id: string }) => each.id),
      ).toEqual([fx.apiA]);
      expect(body.period).toMatchObject({ declared: 1, resolved: 0 });
      expect(body.period.history.total).toBe(1);
      expect(history(body)).toEqual([[1, true, false]]);

      const other = await summary('2026-09-13', '2026-09-19', fx.orgB);

      expect(other.current.active).toBe(1);
      expect(other.period).toMatchObject({ declared: 2, resolved: 1 });
      expect(other.period.history.total).toBe(2);
      expect(history(other)).toEqual([
        [3, true, true],
        [2, true, false],
      ]);
    });
  });

  describe('operational activity', () => {
    let next = 0;

    /**
     * An incident with timeline entries written directly, so a test can put
     * activity on the days it means to. Every entry is on the incident's own
     * organization, as the application only ever writes them.
     */
    const withActivity = async (
      entries: {
        type:
          | 'DECLARED'
          | 'UPDATE'
          | 'SEVERITY_CHANGED'
          | 'STATUS_CHANGED'
          | 'RESPONSE_STARTED'
          | 'RESPONSE_COMPLETED';
        at: string;
        toValue?: string;
      }[],
      { organizationId = fx.orgA }: { organizationId?: string } = {},
    ) => {
      const inA = organizationId === fx.orgA;

      next += 1;

      const incident = await prisma.incident.create({
        data: {
          organizationId,
          number: next,
          title: `Incident ${next}`,
          serviceId: inA ? fx.apiA : fx.apiB,
          teamId: inA ? fx.paymentsA : fx.paymentsB,
          createdById: inA ? fx.alice : fx.bob,
          severity: 'SEV2',
          status: 'INVESTIGATING',
          createdAt: new Date(entries[0].at),
        },
      });

      await prisma.incidentActivity.createMany({
        data: entries.map((entry) => ({
          organizationId,
          incidentId: incident.id,
          actorId: inA ? fx.alice : fx.bob,
          type: entry.type,
          toValue: entry.toValue ?? null,
          createdAt: new Date(entry.at),
        })),
      });

      return incident;
    };

    const activity = async (
      from: string,
      to: string,
      organizationId = fx.orgA,
    ) => {
      const response = await call(
        'get',
        `${organizationId}/incidents/activity?from=${from}&to=${to}`,
        organizationId === fx.orgA ? fx.dave : fx.bob,
      );

      expect(response.status).toBe(200);

      return response.body;
    };

    /** The days that had anything, as [date, total, level]. */
    const busy = (body: {
      days: { date: string; total: number; level: number }[];
    }) =>
      body.days
        .filter((day) => day.total > 0)
        .map((day) => [day.date, day.total, day.level]);

    beforeEach(() => {
      next = 0;
    });

    it('should count a period by whole UTC days, both ends included', async () => {
      await withActivity([
        // The last instant before the period.
        { type: 'DECLARED', at: '2026-09-12T23:59:59.999Z' },
        // The period's first instant, and its last.
        { type: 'UPDATE', at: '2026-09-13T00:00:00.000Z' },
        { type: 'UPDATE', at: '2026-09-19T23:59:59.999Z' },
        // The first instant after it.
        { type: 'UPDATE', at: '2026-09-20T00:00:00.000Z' },
      ]);

      const body = await activity('2026-09-13', '2026-09-19');

      expect(body).toMatchObject({
        from: '2026-09-13',
        to: '2026-09-19',
        total: 2,
        activeDays: 2,
        thresholds: [1, 3, 6, 11],
      });
      // Every day of the period, quiet ones included.
      expect(body.days).toHaveLength(7);
      expect(busy(body)).toEqual([
        ['2026-09-13', 1, 1],
        ['2026-09-19', 1, 1],
      ]);
    });

    it('should break a day down, and not count the status change a start causes', async () => {
      await withActivity([
        { type: 'DECLARED', at: '2026-09-15T09:00:00Z', toValue: 'SEV2' },
        { type: 'RESPONSE_STARTED', at: '2026-09-15T09:05:00Z' },
        {
          type: 'STATUS_CHANGED',
          at: '2026-09-15T09:05:00.001Z',
          toValue: 'INVESTIGATING',
        },
        { type: 'UPDATE', at: '2026-09-15T10:00:00Z' },
        { type: 'SEVERITY_CHANGED', at: '2026-09-15T10:30:00Z', toValue: 'SEV1' },
        { type: 'RESPONSE_COMPLETED', at: '2026-09-15T11:00:00Z' },
        { type: 'STATUS_CHANGED', at: '2026-09-15T11:30:00Z', toValue: 'RESOLVED' },
      ]);

      const body = await activity('2026-09-15', '2026-09-15');
      const [day] = body.days;

      expect(day.counts).toEqual({
        declared: 1,
        responseStarted: 1,
        update: 1,
        responseCompleted: 1,
        resolved: 1,
        changed: 1,
      });
      // Seven entries, six events: the pickup and the status it moved are
      // one act.
      expect(day.total).toBe(6);
      expect(day.level).toBe(3);
      expect(body.total).toBe(6);
    });

    it('should name a day’s incidents, identity only, with how much happened to each', async () => {
      const quiet = await withActivity([
        { type: 'DECLARED', at: '2026-09-15T12:00:00Z' },
      ]);
      const busier = await withActivity([
        { type: 'DECLARED', at: '2026-09-15T09:00:00Z' },
        { type: 'UPDATE', at: '2026-09-15T09:30:00Z' },
        { type: 'UPDATE', at: '2026-09-15T10:00:00Z' },
      ]);

      const [day] = (await activity('2026-09-15', '2026-09-15')).days;

      expect(day.incidents).toEqual([
        {
          id: busier.id,
          number: busier.number,
          title: `Incident ${busier.number}`,
          severity: 'SEV2',
          status: 'INVESTIGATING',
          service: { name: 'Payment API', slug: 'payment-api' },
          events: 3,
        },
        {
          id: quiet.id,
          number: quiet.number,
          title: `Incident ${quiet.number}`,
          severity: 'SEV2',
          status: 'INVESTIGATING',
          service: { name: 'Payment API', slug: 'payment-api' },
          events: 1,
        },
      ]);
      expect(day.moreIncidents).toBe(0);
    });

    it('should keep each organization to itself', async () => {
      await withActivity([{ type: 'DECLARED', at: '2026-09-15T09:00:00Z' }]);
      await withActivity(
        [
          { type: 'DECLARED', at: '2026-09-15T09:00:00Z' },
          { type: 'UPDATE', at: '2026-09-15T10:00:00Z' },
          { type: 'UPDATE', at: '2026-09-16T10:00:00Z' },
        ],
        { organizationId: fx.orgB },
      );

      const mine = await activity('2026-09-13', '2026-09-19');

      expect(mine.total).toBe(1);
      expect(busy(mine)).toEqual([['2026-09-15', 1, 1]]);

      const other = await activity('2026-09-13', '2026-09-19', fx.orgB);

      expect(other.total).toBe(3);
      expect(busy(other)).toEqual([
        ['2026-09-15', 2, 1],
        ['2026-09-16', 1, 1],
      ]);
    });

    it('should answer a period with nothing in it as quiet days, not as nothing', async () => {
      const body = await activity('2026-09-13', '2026-09-19');

      expect(body.total).toBe(0);
      expect(body.activeDays).toBe(0);
      expect(body.days).toHaveLength(7);
      expect(body.days.every((day: { level: number }) => day.level === 0)).toBe(
        true,
      );
    });

    it('should cover 26 weeks of days in one answer', async () => {
      await withActivity([{ type: 'DECLARED', at: '2026-09-19T09:00:00Z' }]);

      // A Sunday-to-Saturday window, as the client draws its weeks.
      const body = await activity('2026-03-22', '2026-09-19');

      expect(body.days).toHaveLength(26 * 7);
      expect(body.days[0].date).toBe('2026-03-22');
      expect(body.days.at(-1).date).toBe('2026-09-19');
      expect(body.activeDays).toBe(1);
    });
  });

  describe('member response activity', () => {
    /**
     * A period wide enough to hold whatever "now" is, so a run crossing UTC
     * midnight cannot split a member's work across the ends of it.
     */
    const around = () => {
      const day = (offset: number) =>
        new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

      return { from: day(-1), to: day(1) };
    };

    const activityOf = async (
      organizationId: string,
      membershipId: string,
      userId: string,
      period = around(),
    ) =>
      call(
        'get',
        `${organizationId}/memberships/${membershipId}/activity?from=${period.from}&to=${period.to}`,
        userId,
      );

    /** The whole period's counts, summed — a run may cross midnight. */
    const counted = (body: {
      days: {
        counts: Record<string, number>;
        incidents: { number: number }[];
      }[];
    }) => {
      const counts = { responseStarted: 0, update: 0, responseCompleted: 0 };
      const incidents = new Set<number>();

      for (const day of body.days) {
        counts.responseStarted += day.counts.responseStarted;
        counts.update += day.counts.update;
        counts.responseCompleted += day.counts.responseCompleted;
        for (const incident of day.incidents) incidents.add(incident.number);
      }

      return { counts, incidents: [...incidents].sort((a, b) => a - b) };
    };

    const membershipOf = async (organizationId: string, userId: string) =>
      (
        await prisma.membership.findFirstOrThrow({
          where: { organizationId, userId },
          select: { id: true },
        })
      ).id;

    it('should count only the three acts of responding, each to their own author', async () => {
      for (let number = 1; number <= 3; number += 1) {
        await declare(fx.orgA, fx.alice, fx.apiA, { title: `Incident ${number}` });
      }

      // Dave, on Payments, works incident 1 from end to end.
      expect((await startAs(fx.orgA, fx.dave, 1)).status).toBe(200);
      await call('post', `${fx.orgA}/incidents/1/updates`, fx.dave, {
        message: 'Retries are failing at the gateway.',
      });
      await call('post', `${fx.orgA}/incidents/1/updates`, fx.dave, {
        message: 'Pinned traffic to the healthy route.',
      });
      expect((await completeAs(fx.orgA, fx.dave, 1)).status).toBe(200);

      // Incident 2 moves to Platform, and Erin works it.
      await call('patch', `${fx.orgA}/incidents/2`, fx.alice, {
        teamId: fx.platformA,
      });
      expect((await startAs(fx.orgA, fx.erin, 2)).status).toBe(200);
      await call('post', `${fx.orgA}/incidents/2/updates`, fx.erin, {
        message: 'Signing keys rotated an hour early.',
      });

      // Alice declared all three and resolves one — authority, not
      // participation — and writes one update, which is participation.
      await call('post', `${fx.orgA}/incidents/3/updates`, fx.alice, {
        message: 'Holding this one until the vendor replies.',
      });
      expect(
        (
          await call('patch', `${fx.orgA}/incidents/1`, fx.alice, {
            status: 'RESOLVED',
            resolution: 'Failed over to the healthy route.',
          })
        ).status,
      ).toBe(200);

      const dave = await activityOf(fx.orgA, fx.daveInA, fx.erin);

      expect(dave.status).toBe(200);
      expect(dave.body.thresholds).toEqual([1, 2, 4, 6]);
      expect(dave.body.total).toBe(4);
      expect(dave.body.activeDays).toBe(1);
      expect(counted(dave.body)).toEqual({
        // A start, two updates, a completion — and not the STATUS_CHANGED to
        // INVESTIGATING his own start caused.
        counts: { responseStarted: 1, update: 2, responseCompleted: 1 },
        // Only the incident he worked: nothing of Erin's, and nothing of
        // incident 3, which he never touched.
        incidents: [1],
      });

      const erin = await activityOf(fx.orgA, fx.erinInA, fx.dave);

      expect(erin.body.total).toBe(2);
      expect(counted(erin.body)).toEqual({
        counts: { responseStarted: 1, update: 1, responseCompleted: 0 },
        incidents: [2],
      });

      // The Admin: her update counts; her three declarations, her
      // reassignment and her resolution do not.
      const alice = await activityOf(
        fx.orgA,
        await membershipOf(fx.orgA, fx.alice),
        fx.dave,
      );

      expect(alice.body.total).toBe(1);
      expect(counted(alice.body)).toEqual({
        counts: { responseStarted: 0, update: 1, responseCompleted: 0 },
        incidents: [3],
      });
    });

    it('should give a member of the responsible team who never acted nothing at all', async () => {
      await declare(fx.orgA, fx.alice, fx.apiA);
      expect((await startAs(fx.orgA, fx.dave, 1)).status).toBe(200);

      // Frank is on Payments with Dave, and did none of the work.
      await aMemberOn(fx.paymentsA, 'Frank');

      const frank = await activityOf(
        fx.orgA,
        await prisma.membership
          .findFirstOrThrow({
            where: { organizationId: fx.orgA, user: { name: 'Frank' } },
            select: { id: true },
          })
          .then(({ id }) => id),
        fx.dave,
      );

      expect(frank.status).toBe(200);
      expect(frank.body.total).toBe(0);
      expect(frank.body.activeDays).toBe(0);
      expect(frank.body.days.length).toBeGreaterThan(0);
      expect(
        frank.body.days.every((day: { level: number }) => day.level === 0),
      ).toBe(true);
    });

    it('should keep one person’s two organizations apart', async () => {
      // Carol is ADMIN in A and MEMBER in B: one user, two memberships, and
      // two separate histories.
      const carolInA = await membershipOf(fx.orgA, fx.carol);

      const incidentIn = async (organizationId: string) =>
        prisma.incident.create({
          data: {
            organizationId,
            number: 1,
            title: 'Card payments failing',
            serviceId: organizationId === fx.orgA ? fx.apiA : fx.apiB,
            teamId: organizationId === fx.orgA ? fx.paymentsA : fx.paymentsB,
            createdById: organizationId === fx.orgA ? fx.alice : fx.bob,
            severity: 'SEV2',
            status: 'INVESTIGATING',
          },
          select: { id: true },
        });

      const inA = await incidentIn(fx.orgA);
      const inB = await incidentIn(fx.orgB);
      const at = new Date();

      await prisma.incidentActivity.createMany({
        data: [
          {
            organizationId: fx.orgA,
            incidentId: inA.id,
            actorId: fx.carol,
            type: 'UPDATE',
            createdAt: at,
          },
          {
            organizationId: fx.orgB,
            incidentId: inB.id,
            actorId: fx.carol,
            type: 'UPDATE',
            createdAt: at,
          },
          {
            organizationId: fx.orgB,
            incidentId: inB.id,
            actorId: fx.carol,
            type: 'RESPONSE_STARTED',
            createdAt: at,
          },
        ],
      });

      const a = await activityOf(fx.orgA, carolInA, fx.alice);

      expect(a.body.total).toBe(1);
      expect(counted(a.body).counts).toEqual({
        responseStarted: 0,
        update: 1,
        responseCompleted: 0,
      });

      const b = await activityOf(fx.orgB, fx.carolInB, fx.bob);

      expect(b.body.total).toBe(2);
      expect(counted(b.body).counts).toEqual({
        responseStarted: 1,
        update: 1,
        responseCompleted: 0,
      });
    });

    it('should answer a foreign or missing membership exactly as a malformed one', async () => {
      const period = around();
      const expected = { status: 404, code: 'MEMBERSHIP_NOT_FOUND' };

      // Carol's membership in B, asked for in A.
      const foreign = await activityOf(
        fx.orgA,
        fx.carolInB,
        fx.alice,
        period,
      );
      // Well formed, and nobody's.
      const missing = await activityOf(
        fx.orgA,
        randomUUID(),
        fx.alice,
        period,
      );
      // Not an id at all.
      const malformed = await activityOf(
        fx.orgA,
        'not-a-membership',
        fx.alice,
        period,
      );

      for (const response of [foreign, missing, malformed]) {
        expect({
          status: response.status,
          code: response.body.code,
        }).toEqual(expected);
      }
    });
  });

  describe('tenant isolation', () => {
    it('should answer a foreign incident exactly as a nonexistent one, on every route', async () => {
      await declare(fx.orgA, fx.alice, fx.apiA);
      await declare(fx.orgB, fx.bob, fx.apiB);
      await declare(fx.orgB, fx.bob, fx.apiB);

      // B has a #2; A does not.
      for (const [method, body] of [
        ['get', undefined],
        ['patch', { status: 'RESOLVED', resolution: 'Rolled back.' }],
      ] as const) {
        const foreign = await call(
          method,
          `${fx.orgA}/incidents/2`,
          fx.alice,
          body,
        );
        const missing = await call(
          method,
          `${fx.orgA}/incidents/999`,
          fx.alice,
          body,
        );

        expectCode(foreign, 404, 'INCIDENT_NOT_FOUND');
        expect(comparable(foreign.body)).toEqual(comparable(missing.body));
      }

      expect(
        (
          await prisma.incident.findFirstOrThrow({
            where: { organizationId: fx.orgB, number: 2 },
          })
        ).status,
      ).toBe('DECLARED');
    });

    it('should answer a foreign service exactly as a nonexistent one, and write nothing', async () => {
      const foreign = await declare(fx.orgA, fx.alice, fx.apiB);
      const missing = await declare(fx.orgA, fx.alice, randomUUID());

      expectCode(foreign, 404, 'SERVICE_NOT_FOUND');
      expect(comparable(foreign.body)).toEqual(comparable(missing.body));
      expect(await prisma.incident.count()).toBe(0);
    });

    it('should refuse a body that names an organization, number, or declarer', async () => {
      for (const extra of [
        { organizationId: fx.orgB },
        { number: 5 },
        { createdById: fx.bob },
        { teamId: fx.platformA },
      ]) {
        expect((await declare(fx.orgA, fx.alice, fx.apiA, extra)).status).toBe(
          400,
        );
      }

      expect(await prisma.incident.count()).toBe(0);
    });

    it('should isolate in the service itself, with no guard in front of it', async () => {
      const incidents = app.get(IncidentsService);
      await declare(fx.orgB, fx.bob, fx.apiB);

      // Carol's membership in B cannot declare into A, whatever A's service.
      const caught = await incidents
        .create(
          fx.orgA,
          { membershipId: fx.carolInB },
          {
            title: 'x',
            serviceId: fx.apiA,
            severity: 'SEV4',
          },
        )
        .catch((error: unknown) => error);

      expect(caught).toBeInstanceOf(HttpException);
      expect((caught as HttpException).getStatus()).toBe(404);
      expect(
        await prisma.incident.count({ where: { organizationId: fx.orgA } }),
      ).toBe(0);

      expect(
        (await incidents.list(fx.orgA, { state: 'active' })).items,
      ).toEqual([]);
      await expect(incidents.get(fx.orgA, '1')).rejects.toBeInstanceOf(
        HttpException,
      );
    });

    it('should make every incident route of a soft-deleted organization unreachable', async () => {
      await declare(fx.orgA, fx.alice, fx.apiA);
      await prisma.organization.update({
        where: { id: fx.orgA },
        data: { deletedAt: new Date() },
      });

      for (const response of [
        await call('get', `${fx.orgA}/incidents?state=active`, fx.alice),
        await call('get', `${fx.orgA}/incidents/1`, fx.alice),
        await declare(fx.orgA, fx.alice, fx.apiA),
        await call('patch', `${fx.orgA}/incidents/1`, fx.alice, {
          status: 'RESOLVED',
          resolution: 'Rolled back.',
        }),
      ]) {
        expectCode(response, 404, 'ORGANIZATION_NOT_FOUND');
      }
    });
  });

  describe('archival and deletion', () => {
    it('should refuse declaring against an archived service, keep it on its incidents, and allow it again once unarchived', async () => {
      await declare(fx.orgA, fx.alice, fx.apiA);

      const archived = await call(
        'patch',
        `${fx.orgA}/services/${fx.apiA}`,
        fx.alice,
        {
          archived: true,
        },
      );

      expect(archived.status).toBe(200);
      expect(Date.parse(archived.body.archivedAt)).not.toBeNaN();

      expectCode(
        await declare(fx.orgA, fx.alice, fx.apiA),
        409,
        'SERVICE_ARCHIVED',
      );
      expect(await prisma.incident.count()).toBe(1);

      // Its incident still names it, and can still be worked and resolved.
      const existing = await call('get', `${fx.orgA}/incidents/1`, fx.dave);

      expect(existing.body.service.archivedAt).toBe(archived.body.archivedAt);
      expect((await resolve(fx.orgA, fx.alice, 1)).status).toBe(200);

      await call('patch', `${fx.orgA}/services/${fx.apiA}`, fx.alice, {
        archived: false,
      });

      expect((await declare(fx.orgA, fx.alice, fx.apiA)).status).toBe(201);
    });

    it('should not let a member archive a service', async () => {
      expectCode(
        await call('patch', `${fx.orgA}/services/${fx.apiA}`, fx.dave, {
          archived: true,
        }),
        403,
        'PERMISSION_DENIED',
      );
    });

    it('should refuse deleting a service with incidents, but delete an archived one with none', async () => {
      await declare(fx.orgA, fx.alice, fx.apiA);

      expectCode(
        await call('delete', `${fx.orgA}/services/${fx.apiA}`, fx.alice),
        409,
        'SERVICE_HAS_INCIDENTS',
      );
      expect(await prisma.service.count({ where: { id: fx.apiA } })).toBe(1);

      const unused = await aService(fx.orgA, fx.paymentsA, 'Legacy Portal');
      await call('patch', `${fx.orgA}/services/${unused}`, fx.alice, {
        archived: true,
      });

      expect(
        (await call('delete', `${fx.orgA}/services/${unused}`, fx.alice))
          .status,
      ).toBe(204);
    });

    it('should refuse deleting a team that has been responsible for an incident', async () => {
      // Platform owns nothing; only the incident names it.
      await declare(fx.orgA, fx.alice, fx.apiA);
      await call('patch', `${fx.orgA}/incidents/1`, fx.alice, {
        teamId: fx.platformA,
      });

      expectCode(
        await call('delete', `${fx.orgA}/teams/${fx.platformA}`, fx.alice),
        409,
        'TEAM_HAS_INCIDENTS',
      );
      expect(await prisma.team.count({ where: { id: fx.platformA } })).toBe(1);
    });
  });

  describe('concurrency', () => {
    it('should move the incident once when two members start at once: both respond, one status change', async () => {
      const finn = await aMemberOn(fx.paymentsA, 'Finn');
      await declare(fx.orgA, fx.alice, fx.apiA);

      const responses = await Promise.all([
        startAs(fx.orgA, fx.dave, 1),
        startAs(fx.orgA, finn, 1),
      ]);

      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      expect(await prisma.incidentResponder.count()).toBe(2);
      expect(
        await prisma.incidentActivity.count({
          where: { type: 'STATUS_CHANGED' },
        }),
      ).toBe(1);
      expect(
        await prisma.incidentActivity.count({
          where: { type: 'RESPONSE_STARTED' },
        }),
      ).toBe(2);
    });

    it('should record one response when the same member starts twice at once', async () => {
      await declare(fx.orgA, fx.alice, fx.apiA);

      const responses = await Promise.all([
        startAs(fx.orgA, fx.dave, 1),
        startAs(fx.orgA, fx.dave, 1),
      ]);

      expect(responses.map((response) => response.status)).toEqual([200, 200]);
      expect(await prisma.incidentResponder.count()).toBe(1);
      expect(
        await prisma.incidentActivity.count({
          where: { type: 'RESPONSE_STARTED' },
        }),
      ).toBe(1);
    });

    it('should refuse a resolution that waits on a response starting', async () => {
      const finn = await aMemberOn(fx.paymentsA, 'Finn');
      await declare(fx.orgA, fx.alice, fx.apiA);
      await startAs(fx.orgA, fx.dave, 1);
      await completeAs(fx.orgA, fx.dave, 1);

      const incident = await prisma.incident.findFirstOrThrow({
        where: { organizationId: fx.orgA, number: 1 },
      });
      const finnInA = await prisma.membership.findFirstOrThrow({
        where: { organizationId: fx.orgA, userId: finn },
      });
      // A start in flight: it holds the incident's row, as lockActive does,
      // and has written its response.
      const held = await hold(async (tx) => {
        await tx.incident.updateMany({
          where: { id: incident.id },
          data: { updatedAt: new Date() },
        });
        await tx.incidentResponder.create({
          data: {
            organizationId: fx.orgA,
            incidentId: incident.id,
            membershipId: finnInA.id,
          },
        });
      });
      const resolving = inFlight(
        call('patch', `${fx.orgA}/incidents/1`, fx.alice, {
          status: 'RESOLVED',
          resolution: 'Rolled back.',
        }),
      );

      await someoneIsWaitingOnALock();
      held.release();
      await held.done;

      expectCode(await resolving, 409, 'RESPONDERS_STILL_INVESTIGATING');
    });

    it('should refuse a start that waits on a resolution', async () => {
      const finn = await aMemberOn(fx.paymentsA, 'Finn');
      await declare(fx.orgA, fx.alice, fx.apiA);
      await startAs(fx.orgA, fx.dave, 1);
      await completeAs(fx.orgA, fx.dave, 1);

      const held = await hold((tx) =>
        tx.incident.updateMany({
          where: { organizationId: fx.orgA, number: 1 },
          data: { status: 'RESOLVED', resolvedAt: new Date() },
        }),
      );
      const starting = inFlight(startAs(fx.orgA, finn, 1));

      await someoneIsWaitingOnALock();
      held.release();
      await held.done;

      expectCode(await starting, 409, 'INCIDENT_RESOLVED');
      expect(await prisma.incidentResponder.count()).toBe(1);
    });

    it('should let exactly one of two concurrent resolutions win, writing resolvedAt once', async () => {
      await declare(fx.orgA, fx.alice, fx.apiA);
      const path = `${fx.orgA}/incidents/1`;
      await startAs(fx.orgA, fx.dave, 1);
      await completeAs(fx.orgA, fx.dave, 1);

      const responses = await Promise.all([
        call('patch', path, fx.alice, { status: 'RESOLVED', resolution: 'Rolled back.' }),
        call('patch', path, fx.carol, { status: 'RESOLVED', resolution: 'Rolled back.' }),
      ]);
      const statuses = responses.map((response) => response.status).sort();

      expect(statuses).toEqual([200, 409]);

      const winner = responses.find((response) => response.status === 200)!;
      const stored = await prisma.incident.findFirstOrThrow({
        where: { organizationId: fx.orgA, number: 1 },
      });

      expect(stored.resolvedAt?.toISOString()).toBe(winner.body.resolvedAt);
    });

    it('should wait for an in-flight reassignment, then declare with the new owner', async () => {
      const held = await hold((tx) =>
        tx.service.update({
          where: { id: fx.apiA },
          data: { ownerTeamId: fx.platformA },
        }),
      );
      const declaring = inFlight(declare(fx.orgA, fx.alice, fx.apiA));

      await someoneIsWaitingOnALock();
      held.release();
      await held.done;

      const response = await declaring;

      expect(response.status).toBe(201);
      expect(response.body.team.id).toBe(fx.platformA);
    });

    it('should wait for an in-flight archive, then refuse the declaration', async () => {
      const held = await hold((tx) =>
        tx.service.update({
          where: { id: fx.apiA },
          data: { archivedAt: new Date() },
        }),
      );
      const declaring = inFlight(declare(fx.orgA, fx.alice, fx.apiA));

      await someoneIsWaitingOnALock();
      held.release();
      await held.done;

      expectCode(await declaring, 409, 'SERVICE_ARCHIVED');
      expect(await prisma.incident.count()).toBe(0);
    });

    it('should wait for an in-flight service deletion, then answer 404', async () => {
      const held = await hold((tx) =>
        tx.service.delete({ where: { id: fx.apiA } }),
      );
      const declaring = inFlight(declare(fx.orgA, fx.alice, fx.apiA));

      await someoneIsWaitingOnALock();
      held.release();
      await held.done;

      expectCode(await declaring, 404, 'SERVICE_NOT_FOUND');
      expect(await prisma.incident.count()).toBe(0);
    });

    it('should make a deletion wait for an in-flight declaration, then refuse it', async () => {
      // A transaction holding the service FOR SHARE, as a declaration does
      // between its lock and its commit, followed by the incident it inserts.
      const held = await hold(async (tx) => {
        await tx.$queryRaw`SELECT id FROM services WHERE id = ${fx.apiA}::uuid FOR SHARE`;
        await tx.incident.create({
          data: {
            organizationId: fx.orgA,
            number: 1,
            title: 'Card payments failing',
            serviceId: fx.apiA,
            teamId: fx.paymentsA,
            createdById: fx.alice,
            severity: 'SEV1',
          },
        });
      });
      const deleting = inFlight(
        call('delete', `${fx.orgA}/services/${fx.apiA}`, fx.alice),
      );
      const reassigning = inFlight(
        call('patch', `${fx.orgA}/services/${fx.apiA}`, fx.carol, {
          ownerTeamId: fx.platformA,
        }),
      );

      await someoneIsWaitingOnALock();
      held.release();
      await held.done;

      expectCode(await deleting, 409, 'SERVICE_HAS_INCIDENTS');
      // The reassignment waited too, and applies after: the incident keeps
      // the owner it was declared with.
      expect((await reassigning).status).toBe(200);
      expect((await prisma.incident.findFirstOrThrow()).teamId).toBe(
        fx.paymentsA,
      );
    });

    it('should resolve a burst of declarations and a service deletion without a 500 or an orphan', async () => {
      const responses = await Promise.all([
        declare(fx.orgA, fx.alice, fx.apiA),
        call('delete', `${fx.orgA}/services/${fx.apiA}`, fx.alice),
        declare(fx.orgA, fx.dave, fx.apiA),
      ]);

      for (const response of responses) {
        expect(response.status).toBeLessThan(500);
      }

      const deleted = responses[1].status === 204;
      const incidents = await prisma.incident.count();

      if (deleted) {
        expect(incidents).toBe(0);
      } else {
        expectCode(responses[1], 409, 'SERVICE_HAS_INCIDENTS');
        expect(incidents).toBeGreaterThan(0);
        expect(await prisma.service.count({ where: { id: fx.apiA } })).toBe(1);
      }
    });
  });

  describe('team-based response', () => {
    const path = (organizationId: string) => `${organizationId}/incidents/1`;
    const post = (organizationId: string, userId: string, message: string) =>
      call('post', `${path(organizationId)}/updates`, userId, { message });
    const count = (type: string) =>
      prisma.incidentActivity.count({
        where: { type: type as 'UPDATE' },
      });

    it('should let a responsible-team member start investigating, moving a declared incident and recording both', async () => {
      await declare(fx.orgA, fx.alice, fx.apiA);

      const started = await startAs(fx.orgA, fx.dave, 1);

      expect(started.status).toBe(200);
      expect(started.body.status).toBe('INVESTIGATING');
      expect(started.body.responders).toEqual([
        {
          membershipId: fx.daveInA,
          name: 'Dave Duarte',
          status: 'INVESTIGATING',
          startedAt: expect.any(String),
          completedAt: null,
        },
      ]);

      const timeline = (await call('get', `${path(fx.orgA)}/timeline`, fx.dave))
        .body;

      expect(
        timeline.map(
          (entry: {
            type: string;
            fromValue: string | null;
            toValue: string | null;
            actor: { id: string };
          }) => [entry.type, entry.fromValue, entry.toValue, entry.actor.id],
        ),
      ).toEqual([
        ['DECLARED', null, 'SEV1', fx.alice],
        ['RESPONSE_STARTED', null, null, fx.dave],
        ['STATUS_CHANGED', 'DECLARED', 'INVESTIGATING', fx.dave],
      ]);

      // Lists stay lean: no responders on a page.
      const list = await call(
        'get',
        `${fx.orgA}/incidents?state=active`,
        fx.dave,
      );

      expect(list.body.items[0]).not.toHaveProperty('responders');
    });

    it('should add a later responder without another status change, and treat a repeated start as done', async () => {
      const finn = await aMemberOn(fx.paymentsA, 'Finn');
      await declare(fx.orgA, fx.alice, fx.apiA);
      await startAs(fx.orgA, fx.dave, 1);

      const later = await startAs(fx.orgA, finn, 1);
      const again = await startAs(fx.orgA, fx.dave, 1);

      expect(later.status).toBe(200);
      expect(again.status).toBe(200);
      expect(
        again.body.responders.map(({ name }: { name: string }) => name),
      ).toEqual(['Dave Duarte', 'Finn']);
      expect(await count('STATUS_CHANGED')).toBe(1);
      expect(await count('RESPONSE_STARTED')).toBe(2);
    });

    it('should refuse starting to anyone off the responsible team, the admin included, and leave them able to read', async () => {
      await declare(fx.orgA, fx.alice, fx.apiA);

      for (const userId of [fx.erin, fx.carol]) {
        expectCode(
          await startAs(fx.orgA, userId, 1),
          403,
          'NOT_ON_RESPONSIBLE_TEAM',
        );
      }
      expect(await prisma.incidentResponder.count()).toBe(0);
      expect((await call('get', path(fx.orgA), fx.erin)).body.status).toBe(
        'DECLARED',
      );
      expect(
        (await call('get', `${path(fx.orgA)}/timeline`, fx.erin)).status,
      ).toBe(200);
    });

    it('should let a member post only while investigating', async () => {
      await declare(fx.orgA, fx.alice, fx.apiA);

      // Being on the team is not enough, and nor is being on another.
      for (const userId of [fx.dave, fx.erin]) {
        expectCode(
          await post(fx.orgA, userId, 'Looking.'),
          403,
          'START_INVESTIGATING_FIRST',
        );
      }

      await startAs(fx.orgA, fx.dave, 1);
      expect((await post(fx.orgA, fx.dave, 'Card processor.')).status).toBe(
        201,
      );

      await completeAs(fx.orgA, fx.dave, 1);
      expectCode(
        await post(fx.orgA, fx.dave, 'One more thing.'),
        409,
        'RESPONSE_ALREADY_COMPLETED',
      );
      expect(await count('UPDATE')).toBe(1);
    });

    it('should let the admin post to any incident without responding', async () => {
      await declare(fx.orgA, fx.alice, fx.apiA);

      const posted = await post(fx.orgA, fx.carol, 'Support has been told.');

      expect(posted.status).toBe(201);
      expect(posted.body.actor).toEqual({ id: fx.carol, name: 'Carol Chen' });
      expect(await prisma.incidentResponder.count()).toBe(0);
    });

    it("should complete only the caller's own response, resolving nothing, and never restart it", async () => {
      const finn = await aMemberOn(fx.paymentsA, 'Finn');
      await declare(fx.orgA, fx.alice, fx.apiA);

      expectCode(
        await completeAs(fx.orgA, fx.dave, 1),
        409,
        'NOT_INVESTIGATING',
      );

      await startAs(fx.orgA, fx.dave, 1);
      await startAs(fx.orgA, finn, 1);

      const completed = await completeAs(fx.orgA, fx.dave, 1);

      expect(completed.status).toBe(200);
      expect(completed.body.status).toBe('INVESTIGATING');
      expect(
        completed.body.responders.map(
          ({ name, status }: { name: string; status: string }) => [
            name,
            status,
          ],
        ),
      ).toEqual([
        ['Dave Duarte', 'COMPLETED'],
        ['Finn', 'INVESTIGATING'],
      ]);
      expect(
        Date.parse(completed.body.responders[0].completedAt),
      ).not.toBeNaN();

      // Again changes nothing; restarting is refused.
      expect((await completeAs(fx.orgA, fx.dave, 1)).status).toBe(200);
      expect(await count('RESPONSE_COMPLETED')).toBe(1);
      expectCode(
        await startAs(fx.orgA, fx.dave, 1),
        409,
        'RESPONSE_ALREADY_COMPLETED',
      );
    });

    it('should resolve only once every responder has completed, whoever on the team never started', async () => {
      const finn = await aMemberOn(fx.paymentsA, 'Finn');
      await aMemberOn(fx.paymentsA, 'Gita');
      await declare(fx.orgA, fx.alice, fx.apiA);
      await startAs(fx.orgA, fx.dave, 1);
      await startAs(fx.orgA, finn, 1);
      await completeAs(fx.orgA, fx.dave, 1);

      const refused = await call('patch', path(fx.orgA), fx.alice, {
        status: 'RESOLVED',
        resolution: 'Rolled back.',
        title: 'Renamed',
      });

      expectCode(refused, 409, 'RESPONDERS_STILL_INVESTIGATING');
      expect((await call('get', path(fx.orgA), fx.alice)).body.title).toBe(
        'Card payments failing',
      );

      // Gita never started, so she does not hold it up.
      await completeAs(fx.orgA, finn, 1);

      expect(
        (
          await call('patch', path(fx.orgA), fx.alice, {
            status: 'RESOLVED',
            resolution: 'Rolled back.',
          })
        ).status,
      ).toBe(200);
    });

    it('should keep a resolved incident closed to every response, and readable', async () => {
      const finn = await aMemberOn(fx.paymentsA, 'Finn');
      await declare(fx.orgA, fx.alice, fx.apiA);
      await resolve(fx.orgA, fx.alice, 1);
      const before = await prisma.incidentActivity.count();

      for (const refused of [
        startAs(fx.orgA, finn, 1),
        startAs(fx.orgA, fx.dave, 1),
        completeAs(fx.orgA, fx.dave, 1),
        post(fx.orgA, fx.dave, 'Late.'),
        post(fx.orgA, fx.alice, 'Late.'),
      ]) {
        expectCode(await refused, 409, 'INCIDENT_RESOLVED');
      }

      expect(await prisma.incidentActivity.count()).toBe(before);

      const read = await call('get', path(fx.orgA), fx.erin);

      expect(read.body.status).toBe('RESOLVED');
      expect(read.body.responders).toEqual([
        expect.objectContaining({ name: 'Dave Duarte', status: 'COMPLETED' }),
      ]);
    });

    it('should let only the new team start after a reassignment, while a response already started is finished', async () => {
      const finn = await aMemberOn(fx.paymentsA, 'Finn');
      await declare(fx.orgA, fx.alice, fx.apiA);
      await startAs(fx.orgA, fx.dave, 1);

      const reassigned = await call('patch', path(fx.orgA), fx.alice, {
        teamId: fx.platformA,
      });

      expect(reassigned.status).toBe(200);
      expect(reassigned.body.team.name).toBe('Platform');
      expect(reassigned.body.responders).toHaveLength(1);

      // Payments can no longer start; Platform can.
      expectCode(
        await startAs(fx.orgA, finn, 1),
        403,
        'NOT_ON_RESPONSIBLE_TEAM',
      );
      expect((await startAs(fx.orgA, fx.erin, 1)).status).toBe(200);

      // Dave's response is his to finish, and holds the resolution until he
      // does.
      expect((await post(fx.orgA, fx.dave, 'Handing over.')).status).toBe(201);
      await completeAs(fx.orgA, fx.erin, 1);
      expectCode(
        await call('patch', path(fx.orgA), fx.alice, { status: 'RESOLVED', resolution: 'Rolled back.' }),
        409,
        'RESPONDERS_STILL_INVESTIGATING',
      );
      expect((await completeAs(fx.orgA, fx.dave, 1)).status).toBe(200);

      const timeline = (await call('get', `${path(fx.orgA)}/timeline`, fx.dave))
        .body;
      const teamChange = timeline.find(
        (entry: { type: string }) => entry.type === 'TEAM_CHANGED',
      );

      expect(teamChange).toMatchObject({
        fromValue: 'Payments',
        toValue: 'Platform',
        message: null,
        actor: { id: fx.alice },
      });

      // Renaming a team afterwards does not rewrite what was recorded.
      await prisma.team.update({
        where: { id: fx.platformA },
        data: { name: 'Platform Engineering' },
      });
      expect(
        (await call('get', `${path(fx.orgA)}/timeline`, fx.dave)).body.find(
          (entry: { type: string }) => entry.type === 'TEAM_CHANGED',
        ),
      ).toMatchObject({ fromValue: 'Payments', toValue: 'Platform' });
    });

    it('should record nothing when the team named is the one already responsible', async () => {
      await declare(fx.orgA, fx.alice, fx.apiA);

      await call('patch', path(fx.orgA), fx.alice, { teamId: fx.paymentsA });

      expect(await count('TEAM_CHANGED')).toBe(0);
    });

    it('should let a member taken off the team finish their response, but not start one', async () => {
      const finn = await aMemberOn(fx.paymentsA, 'Finn');
      const finnInA = await prisma.membership.findFirstOrThrow({
        where: { organizationId: fx.orgA, userId: finn },
      });
      await declare(fx.orgA, fx.alice, fx.apiA);
      await startAs(fx.orgA, fx.dave, 1);

      for (const membershipId of [fx.daveInA, finnInA.id]) {
        expect(
          (
            await call(
              'delete',
              `${fx.orgA}/teams/${fx.paymentsA}/members/${membershipId}`,
              fx.alice,
            )
          ).status,
        ).toBe(204);
      }

      expectCode(
        await startAs(fx.orgA, finn, 1),
        403,
        'NOT_ON_RESPONSIBLE_TEAM',
      );
      expect((await post(fx.orgA, fx.dave, 'Still on it.')).status).toBe(201);
      expect((await completeAs(fx.orgA, fx.dave, 1)).status).toBe(200);
    });

    it("should answer another organization's incident as missing on every response route, writing nothing", async () => {
      await declare(fx.orgB, fx.bob, fx.apiB);

      for (const response of [
        await startAs(fx.orgA, fx.dave, 1),
        await completeAs(fx.orgA, fx.dave, 1),
        await post(fx.orgA, fx.dave, 'Not my incident.'),
      ]) {
        expectCode(response, 404, 'INCIDENT_NOT_FOUND');
      }

      expect(await prisma.incidentResponder.count()).toBe(0);
      expect(await count('UPDATE')).toBe(0);
    });

    it('should offer no lead, and no way to name who responds', async () => {
      const declared = await declare(fx.orgA, fx.alice, fx.apiA);

      expect(declared.body).not.toHaveProperty('lead');
      expect(declared.body.responders).toEqual([]);
      expect(
        (
          await call('patch', path(fx.orgA), fx.alice, {
            leadMembershipId: fx.daveInA,
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await call('post', `${path(fx.orgA)}/responders`, fx.alice, {
            membershipId: fx.daveInA,
          })
        ).status,
      ).toBe(404);
    });
  });

  describe('attention', () => {
    type Listed = { number: number; id: string }[];

    const attentionOf = async (organizationId: string, userId: string) => {
      const response = await call(
        'get',
        `${organizationId}/incidents/attention`,
        userId,
      );

      expect(response.status).toBe(200);

      return response.body as {
        manage: { readyToResolve: Listed } | null;
        respond: { needsYourTeam: Listed; yourResponses: Listed } | null;
      };
    };

    const numbers = (list: Listed | undefined) =>
      list?.map(({ number }) => number);

    /** Nothing waits on the caller in any list their permissions give them. */
    const nothingFor = async (organizationId: string, userId: string) => {
      const attention = await attentionOf(organizationId, userId);

      expect(attention.manage?.readyToResolve ?? []).toEqual([]);
      expect(attention.respond?.needsYourTeam).toEqual([]);
      expect(attention.respond?.yourResponses).toEqual([]);
    };

    it('should follow an incident through each list as its response moves, and drop it once resolved', async () => {
      const finn = await aMemberOn(fx.paymentsA, 'Finn');
      await declare(fx.orgA, fx.alice, fx.apiA);

      // Declared: Payments' work, and nothing for the admin to resolve.
      for (const member of [fx.dave, finn]) {
        expect(
          numbers((await attentionOf(fx.orgA, member)).respond?.needsYourTeam),
        ).toEqual([1]);
      }
      await nothingFor(fx.orgA, fx.erin);
      expect(await attentionOf(fx.orgA, fx.alice)).toEqual({
        manage: { readyToResolve: [] },
        respond: { needsYourTeam: [], yourResponses: [] },
      });

      // Dave starts: his response, and no longer unclaimed for Finn.
      await startAs(fx.orgA, fx.dave, 1);
      const dave = await attentionOf(fx.orgA, fx.dave);

      expect(dave.respond?.needsYourTeam).toEqual([]);
      expect(numbers(dave.respond?.yourResponses)).toEqual([1]);
      await nothingFor(fx.orgA, finn);
      await nothingFor(fx.orgA, fx.alice);

      // Dave completes: the admin's to resolve, and nobody else's.
      await completeAs(fx.orgA, fx.dave, 1);
      const alice = await attentionOf(fx.orgA, fx.alice);

      expect(numbers(alice.manage?.readyToResolve)).toEqual([1]);
      expect(alice.manage?.readyToResolve[0]).toMatchObject({
        status: 'INVESTIGATING',
        responders: [{ name: 'Dave Duarte', status: 'COMPLETED' }],
      });
      await nothingFor(fx.orgA, fx.dave);
      await nothingFor(fx.orgA, finn);

      expect(
        (
          await call('patch', `${fx.orgA}/incidents/1`, fx.alice, {
            status: 'RESOLVED',
            resolution: 'Rolled back.',
          })
        ).status,
      ).toBe(200);

      for (const user of [fx.alice, fx.dave, finn, fx.erin]) {
        await nothingFor(fx.orgA, user);
      }
    });

    it('should bring a reassigned incident to the new team, while it stays resolvable for the admin', async () => {
      await declare(fx.orgA, fx.alice, fx.apiA);
      await startAs(fx.orgA, fx.dave, 1);
      await completeAs(fx.orgA, fx.dave, 1);
      await call('patch', `${fx.orgA}/incidents/1`, fx.alice, {
        teamId: fx.platformA,
      });

      // Two facts about one incident: resolvable, and not yet picked up by
      // anyone on Platform.
      expect(
        numbers((await attentionOf(fx.orgA, fx.alice)).manage?.readyToResolve),
      ).toEqual([1]);
      expect(
        numbers((await attentionOf(fx.orgA, fx.erin)).respond?.needsYourTeam),
      ).toEqual([1]);
      await nothingFor(fx.orgA, fx.dave);

      // Erin starts: her response, and no longer resolvable.
      await startAs(fx.orgA, fx.erin, 1);
      const erin = await attentionOf(fx.orgA, fx.erin);

      expect(erin.respond?.needsYourTeam).toEqual([]);
      expect(numbers(erin.respond?.yourResponses)).toEqual([1]);
      await nothingFor(fx.orgA, fx.alice);
    });

    it('should keep a response under way on the list of whoever started it, after a reassignment away', async () => {
      await declare(fx.orgA, fx.alice, fx.apiA);
      await startAs(fx.orgA, fx.dave, 1);
      await call('patch', `${fx.orgA}/incidents/1`, fx.alice, {
        teamId: fx.platformA,
      });

      const dave = await attentionOf(fx.orgA, fx.dave);

      expect(dave.respond?.needsYourTeam).toEqual([]);
      expect(numbers(dave.respond?.yourResponses)).toEqual([1]);
      expect(
        numbers((await attentionOf(fx.orgA, fx.erin)).respond?.needsYourTeam),
      ).toEqual([1]);
    });

    it('should follow who is on the team now', async () => {
      await declare(fx.orgA, fx.alice, fx.apiA);
      await call(
        'delete',
        `${fx.orgA}/teams/${fx.paymentsA}/members/${fx.daveInA}`,
        fx.alice,
      );

      await nothingFor(fx.orgA, fx.dave);

      // Alice joins Payments: an admin on a team is told what it needs.
      const aliceInA = await prisma.membership.findFirstOrThrow({
        where: { organizationId: fx.orgA, userId: fx.alice },
      });
      await prisma.teamMembership.create({
        data: {
          organizationId: fx.orgA,
          teamId: fx.paymentsA,
          membershipId: aliceInA.id,
        },
      });

      expect(await attentionOf(fx.orgA, fx.alice)).toMatchObject({
        manage: { readyToResolve: [] },
        respond: { needsYourTeam: [{ number: 1 }], yourResponses: [] },
      });
    });

    it('should judge one token by the role and teams it holds in each organization, keeping each to itself', async () => {
      await prisma.teamMembership.create({
        data: {
          organizationId: fx.orgB,
          teamId: fx.paymentsB,
          membershipId: fx.carolInB,
        },
      });
      const inA = (await declare(fx.orgA, fx.alice, fx.apiA)).body.id;
      const inB = (await declare(fx.orgB, fx.bob, fx.apiB)).body.id;

      // Admin in A, on no team there: nothing of B's, and no team work.
      const carolA = await attentionOf(fx.orgA, fx.carol);

      expect(carolA.manage).toEqual({ readyToResolve: [] });
      expect(carolA.respond?.needsYourTeam).toEqual([]);

      // Member in B, on B's Payments: B's incident and no management.
      const carolB = await attentionOf(fx.orgB, fx.carol);

      expect(carolB.manage).toBeNull();
      expect(carolB.respond?.needsYourTeam.map(({ id }) => id)).toEqual([inB]);

      // Dave, on A's Payments, is shown A's incident and never B's.
      expect(
        (await attentionOf(fx.orgA, fx.dave)).respond?.needsYourTeam.map(
          ({ id }) => id,
        ),
      ).toEqual([inA]);
      expectCode(
        await call('get', `${fx.orgB}/incidents/attention`, fx.dave),
        404,
        'ORGANIZATION_NOT_FOUND',
      );
    });

    it('should isolate in the service itself: a membership of another organization is given nothing', async () => {
      await declare(fx.orgA, fx.alice, fx.apiA);
      await startAs(fx.orgA, fx.dave, 1);

      // Carol's membership in B, asked about A: no team of A's is hers.
      expect(
        await app
          .get(IncidentsService)
          .attention(fx.orgA, { membershipId: fx.carolInB, role: 'MEMBER' }),
      ).toEqual({
        manage: null,
        respond: { needsYourTeam: [], yourResponses: [] },
      });
    });

    it("should make a soft-deleted organization's attention unreachable", async () => {
      await prisma.organization.update({
        where: { id: fx.orgA },
        data: { deletedAt: new Date() },
      });

      expectCode(
        await call('get', `${fx.orgA}/incidents/attention`, fx.alice),
        404,
        'ORGANIZATION_NOT_FOUND',
      );
    });
  });

  describe('timeline and operational updates', () => {
    const incidentPath = `incidents/1`;
    const timelineOf = async (organizationId: string, userId: string) =>
      call('get', `${organizationId}/${incidentPath}/timeline`, userId);
    const post = (organizationId: string, userId: string, message: string) =>
      call('post', `${organizationId}/${incidentPath}/updates`, userId, {
        message,
      });

    it('should tell the story in order: declared, updates, and each recorded change, attributed', async () => {
      await declare(fx.orgA, fx.alice, fx.apiA, { severity: 'SEV2' });
      await startAs(fx.orgA, fx.dave, 1);

      const posted = await post(
        fx.orgA,
        fx.dave,
        '  Investigating elevated database latency.  ',
      );

      expect(posted.status).toBe(201);
      expect(posted.body).toEqual({
        id: expect.any(String),
        type: 'UPDATE',
        message: 'Investigating elevated database latency.',
        fromValue: null,
        toValue: null,
        actor: { id: fx.dave, name: 'Dave Duarte' },
        createdAt: expect.any(String),
      });

      await call('patch', `${fx.orgA}/${incidentPath}`, fx.carol, {
        severity: 'SEV1',
      });
      await post(fx.orgA, fx.carol, 'Connection pool exhaustion identified.');
      await completeAs(fx.orgA, fx.dave, 1);
      await call('patch', `${fx.orgA}/${incidentPath}`, fx.alice, {
        status: 'RESOLVED',
        resolution: 'Rolled back.',
      });

      const timeline = await timelineOf(fx.orgA, fx.dave);

      expect(timeline.status).toBe(200);
      expect(
        timeline.body.map(
          (entry: Record<string, unknown> & { actor: { name: string } }) => [
            entry.type,
            entry.fromValue ?? entry.message,
            entry.toValue,
            entry.actor.name,
          ],
        ),
      ).toEqual([
        ['DECLARED', null, 'SEV2', 'Alice Anders'],
        ['RESPONSE_STARTED', null, null, 'Dave Duarte'],
        ['STATUS_CHANGED', 'DECLARED', 'INVESTIGATING', 'Dave Duarte'],
        [
          'UPDATE',
          'Investigating elevated database latency.',
          null,
          'Dave Duarte',
        ],
        ['SEVERITY_CHANGED', 'SEV2', 'SEV1', 'Carol Chen'],
        [
          'UPDATE',
          'Connection pool exhaustion identified.',
          null,
          'Carol Chen',
        ],
        ['RESPONSE_COMPLETED', null, null, 'Dave Duarte'],
        ['STATUS_CHANGED', 'INVESTIGATING', 'RESOLVED', 'Alice Anders'],
      ]);
    });

    it('should record the two changes of one request, and nothing for a value that did not change', async () => {
      await declare(fx.orgA, fx.alice, fx.apiA);

      await call('patch', `${fx.orgA}/${incidentPath}`, fx.alice, {
        severity: 'SEV3',
        teamId: fx.platformA,
      });
      await call('patch', `${fx.orgA}/${incidentPath}`, fx.alice, {
        severity: 'SEV3',
        title: 'Renamed',
        teamId: fx.platformA,
      });

      const types = (await timelineOf(fx.orgA, fx.alice)).body.map(
        (entry: { type: string }) => entry.type,
      );

      // The second request changed only the title, which is not recorded;
      // its severity and team were already so.
      expect(types).toHaveLength(3);
      expect(types[0]).toBe('DECLARED');
      expect(types.slice(1).sort()).toEqual([
        'SEVERITY_CHANGED',
        'TEAM_CHANGED',
      ]);
    });

    it('should keep the timeline of a resolved incident readable, and refuse new updates with 409', async () => {
      await declare(fx.orgA, fx.alice, fx.apiA);
      await resolve(fx.orgA, fx.alice, 1);

      expectCode(
        await post(fx.orgA, fx.alice, 'Customer comms sent.'),
        409,
        'INCIDENT_RESOLVED',
      );
      // Declared; Dave started, which started the investigation; he
      // completed; resolved.
      expect((await timelineOf(fx.orgA, fx.alice)).body).toHaveLength(5);
    });

    it("should answer another organization's incident exactly as a missing one, and write nothing", async () => {
      await declare(fx.orgB, fx.bob, fx.apiB);

      // B has a #1; A has none.
      for (const [foreign, missing] of [
        [
          await timelineOf(fx.orgA, fx.alice),
          await call('get', `${fx.orgA}/incidents/999/timeline`, fx.alice),
        ],
        [
          await post(fx.orgA, fx.alice, 'Not yours.'),
          await call('post', `${fx.orgA}/incidents/999/updates`, fx.alice, {
            message: 'Not yours.',
          }),
        ],
      ]) {
        expectCode(foreign, 404, 'INCIDENT_NOT_FOUND');
        expect(comparable(foreign.body)).toEqual(comparable(missing.body));
      }

      expect(
        await prisma.incidentActivity.count({ where: { type: 'UPDATE' } }),
      ).toBe(0);
      expectCode(
        await timelineOf(fx.orgB, fx.alice),
        404,
        'ORGANIZATION_NOT_FOUND',
      );
    });

    it('should refuse a body that names an actor or a type', async () => {
      await declare(fx.orgA, fx.alice, fx.apiA);

      for (const extra of [{ actorId: fx.bob }, { type: 'STATUS_CHANGED' }]) {
        expect(
          (
            await call('post', `${fx.orgA}/${incidentPath}/updates`, fx.alice, {
              message: 'x',
              ...extra,
            })
          ).status,
        ).toBe(400);
      }

      expect(
        await prisma.incidentActivity.count({ where: { type: 'UPDATE' } }),
      ).toBe(0);
    });

    it('should wait for an in-flight resolution, then refuse the update', async () => {
      await declare(fx.orgA, fx.alice, fx.apiA);
      const held = await hold((tx) =>
        tx.incident.updateMany({
          where: { organizationId: fx.orgA, number: 1 },
          data: { status: 'RESOLVED', resolvedAt: new Date() },
        }),
      );
      const posting = inFlight(post(fx.orgA, fx.alice, 'Rolled back.'));

      await someoneIsWaitingOnALock();
      held.release();
      await held.done;

      expectCode(await posting, 409, 'INCIDENT_RESOLVED');
      expect(
        await prisma.incidentActivity.count({ where: { type: 'UPDATE' } }),
      ).toBe(0);
    });

    it('should record a true previous value when two severity changes race', async () => {
      await declare(fx.orgA, fx.alice, fx.apiA, { severity: 'SEV3' });

      await Promise.all([
        call('patch', `${fx.orgA}/${incidentPath}`, fx.alice, {
          severity: 'SEV2',
        }),
        call('patch', `${fx.orgA}/${incidentPath}`, fx.carol, {
          severity: 'SEV1',
        }),
      ]);

      const changes = (await timelineOf(fx.orgA, fx.alice)).body.filter(
        (entry: { type: string }) => entry.type === 'SEVERITY_CHANGED',
      );

      // Whichever applied second starts from where the first left it.
      const first = changes.find(
        (entry: { fromValue: string }) => entry.fromValue === 'SEV3',
      );
      const second = changes.find(
        (entry: { fromValue: string }) => entry !== first,
      );

      expect(changes).toHaveLength(2);
      expect(first).toBeDefined();
      expect(second.fromValue).toBe(first.toValue);
    });
  });
});
