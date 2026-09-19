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
} from './../src/incidents/incidents.service.js';
import { leakedKeys } from './leaks.js';
import { resolveTestDatabaseUrl } from './test-database.js';

/**
 * Incidents against a real database.
 *
 * Two tenants. Alice owns A, Bob owns B, Carol is ADMIN in A and MEMBER in B
 * — one token, two capacities — and Dave is a plain MEMBER of A. A has two
 * teams, Payments and Platform, and a Payment API owned by Payments; B has
 * its own Payments and Payment API.
 *
 * What is proven here and nowhere else: that a member declares and resolves;
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
  carolInB: string;
  paymentsA: string;
  platformA: string;
  paymentsB: string;
  apiA: string;
  apiB: string;
}

type Role = 'OWNER' | 'ADMIN' | 'MEMBER';

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

    await grant(orgA, alice, 'OWNER');
    await grant(orgB, bob, 'OWNER');
    await grant(orgA, carol, 'ADMIN');
    const carolInB = await grant(orgB, carol, 'MEMBER');
    await grant(orgA, dave, 'MEMBER');

    const paymentsA = await aTeam(orgA, 'Payments');
    const platformA = await aTeam(orgA, 'Platform');
    const paymentsB = await aTeam(orgB, 'Payments');

    return {
      orgA,
      orgB,
      alice,
      bob,
      carol,
      dave,
      carolInB,
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
    it('should let a member declare an incident, move it in any direction, and resolve it', async () => {
      const declared = await declare(fx.orgA, fx.dave, fx.apiA, {
        summary: 'Card declines since 14:02',
      });

      expect(declared.status).toBe(201);
      expect(declared.body).toEqual(
        expect.objectContaining({
          number: 1,
          status: 'INVESTIGATING',
          severity: 'SEV1',
          summary: 'Card declines since 14:02',
          resolvedAt: null,
          service: expect.objectContaining({
            id: fx.apiA,
            criticality: 'NORMAL',
          }),
          team: expect.objectContaining({ id: fx.paymentsA, name: 'Payments' }),
          createdBy: { id: fx.dave, name: 'Dave Duarte' },
        }),
      );

      const path = `${fx.orgA}/incidents/1`;

      for (const status of ['IDENTIFIED', 'INVESTIGATING', 'MONITORING']) {
        const moved = await call('patch', path, fx.dave, { status });

        expect(moved.status).toBe(200);
        expect(moved.body.status).toBe(status);
        expect(moved.body.resolvedAt).toBeNull();
      }

      const resolved = await call('patch', path, fx.dave, {
        status: 'RESOLVED',
        severity: 'SEV2',
      });

      expect(resolved.status).toBe(200);
      expect(resolved.body.status).toBe('RESOLVED');
      expect(resolved.body.severity).toBe('SEV2');
      expect(Date.parse(resolved.body.resolvedAt)).not.toBeNaN();

      // Resolved is terminal: nothing about it changes again.
      for (const change of [
        { title: 'Typo fixed' },
        { status: 'MONITORING' },
        { status: 'RESOLVED' },
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

      const moved = await call('patch', path, fx.dave, {
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
      await declare(fx.orgA, fx.dave, fx.apiA);
      await prisma.user.update({
        where: { id: fx.dave },
        data: { deletedAt: new Date() },
      });

      expect(
        (await call('get', `${fx.orgA}/incidents/1`, fx.alice)).body.createdBy,
      ).toEqual({ id: fx.dave, name: 'Dave Duarte' });
    });

    it('should judge one token by the role it holds in each organization', async () => {
      // Carol is ADMIN in A and MEMBER in B; both may respond.
      expect((await declare(fx.orgA, fx.carol, fx.apiA)).status).toBe(201);
      expect((await declare(fx.orgB, fx.carol, fx.apiB)).status).toBe(201);
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
          status: resolved ? ('RESOLVED' as const) : ('MONITORING' as const),
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
      await call('patch', `${fx.orgA}/incidents/2`, fx.alice, {
        status: 'RESOLVED',
      });
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
          status: 'INVESTIGATING',
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

  describe('tenant isolation', () => {
    it('should answer a foreign incident exactly as a nonexistent one, on every route', async () => {
      await declare(fx.orgA, fx.alice, fx.apiA);
      await declare(fx.orgB, fx.bob, fx.apiB);
      await declare(fx.orgB, fx.bob, fx.apiB);

      // B has a #2; A does not.
      for (const [method, body] of [
        ['get', undefined],
        ['patch', { status: 'RESOLVED' }],
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
      ).toBe('INVESTIGATING');
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
        await declare(fx.orgA, fx.dave, fx.apiA),
        409,
        'SERVICE_ARCHIVED',
      );
      expect(await prisma.incident.count()).toBe(1);

      // Its incident still names it, and can still be worked and resolved.
      const existing = await call('get', `${fx.orgA}/incidents/1`, fx.dave);

      expect(existing.body.service.archivedAt).toBe(archived.body.archivedAt);
      expect(
        (
          await call('patch', `${fx.orgA}/incidents/1`, fx.dave, {
            status: 'RESOLVED',
          })
        ).status,
      ).toBe(200);

      await call('patch', `${fx.orgA}/services/${fx.apiA}`, fx.alice, {
        archived: false,
      });

      expect((await declare(fx.orgA, fx.dave, fx.apiA)).status).toBe(201);
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
    it('should let exactly one of two concurrent resolutions win, writing resolvedAt once', async () => {
      await declare(fx.orgA, fx.alice, fx.apiA);
      const path = `${fx.orgA}/incidents/1`;

      const responses = await Promise.all([
        call('patch', path, fx.alice, { status: 'RESOLVED' }),
        call('patch', path, fx.dave, { status: 'RESOLVED' }),
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

  describe('incident response: lead and responders', () => {
    const membershipOf = async (organizationId: string, userId: string) =>
      (
        await prisma.membership.findFirstOrThrow({
          where: { organizationId, userId },
          select: { id: true },
        })
      ).id;

    /** Incident 1 — the only one each test declares. */
    const pathIn = (organizationId: string) => `${organizationId}/incidents/1`;

    it('should declare with no lead and no responders, whoever declares', async () => {
      const response = await declare(fx.orgA, fx.dave, fx.apiA);

      expect(response.status).toBe(201);
      expect(response.body.lead).toBeNull();
      expect(response.body.responders).toEqual([]);
    });

    it('should set, change, and clear the lead, showing it on the incident but not in lists', async () => {
      await declare(fx.orgA, fx.alice, fx.apiA);
      const dave = await membershipOf(fx.orgA, fx.dave);
      const carol = await membershipOf(fx.orgA, fx.carol);

      // A MEMBER may assign: incident response is everyone's work.
      const set = await call('patch', pathIn(fx.orgA), fx.dave, {
        leadMembershipId: dave,
      });
      expect(set.status).toBe(200);
      expect(set.body.lead).toStrictEqual({
        membershipId: dave,
        name: 'Dave Duarte',
      });
      // Creator and lead are separate: Alice declared, Dave leads.
      expect(set.body.createdBy.id).toBe(fx.alice);

      await call('patch', pathIn(fx.orgA), fx.alice, {
        leadMembershipId: carol,
      });
      const read = await call('get', pathIn(fx.orgA), fx.alice);
      expect(read.body.lead.name).toBe('Carol Chen');

      const list = await call(
        'get',
        `${fx.orgA}/incidents?state=active`,
        fx.alice,
      );
      expect(list.body.items[0]).not.toHaveProperty('lead');
      expect(list.body.items[0]).not.toHaveProperty('responders');

      const cleared = await call('patch', pathIn(fx.orgA), fx.alice, {
        leadMembershipId: null,
      });
      expect(cleared.body.lead).toBeNull();
    });

    it('should add responders from any team in the order they were added, and remove them', async () => {
      await declare(fx.orgA, fx.alice, fx.apiA);
      const dave = await membershipOf(fx.orgA, fx.dave);
      const carol = await membershipOf(fx.orgA, fx.carol);
      const responders = `${pathIn(fx.orgA)}/responders`;

      // Neither is on the responsible team, or any team.
      await call('post', responders, fx.alice, { membershipId: dave });
      const added = await call('post', responders, fx.alice, {
        membershipId: carol,
      });

      expect(added.status).toBe(201);
      expect(added.body.responders).toStrictEqual([
        { membershipId: dave, name: 'Dave Duarte' },
        { membershipId: carol, name: 'Carol Chen' },
      ]);

      const removed = await call('delete', `${responders}/${dave}`, fx.dave);
      expect(removed.status).toBe(204);

      const read = await call('get', pathIn(fx.orgA), fx.alice);
      expect(read.body.responders).toStrictEqual([
        { membershipId: carol, name: 'Carol Chen' },
      ]);
    });

    it('should let the lead also be a responder, independently', async () => {
      await declare(fx.orgA, fx.alice, fx.apiA);
      const dave = await membershipOf(fx.orgA, fx.dave);

      await call('patch', pathIn(fx.orgA), fx.alice, {
        leadMembershipId: dave,
      });
      await call('post', `${pathIn(fx.orgA)}/responders`, fx.alice, {
        membershipId: dave,
      });
      await call('delete', `${pathIn(fx.orgA)}/responders/${dave}`, fx.alice);

      const read = await call('get', pathIn(fx.orgA), fx.alice);
      expect(read.body.lead.membershipId).toBe(dave);
      expect(read.body.responders).toEqual([]);
    });

    it('should answer the same responder twice with 409', async () => {
      await declare(fx.orgA, fx.alice, fx.apiA);
      const dave = await membershipOf(fx.orgA, fx.dave);
      const responders = `${pathIn(fx.orgA)}/responders`;

      await call('post', responders, fx.alice, { membershipId: dave });

      expectCode(
        await call('post', responders, fx.alice, { membershipId: dave }),
        409,
        'ALREADY_A_RESPONDER',
      );
      expect(await prisma.incidentResponder.count()).toBe(1);
    });

    it("should answer another organization's membership exactly as a missing one, and change nothing", async () => {
      await declare(fx.orgA, fx.alice, fx.apiA);
      const missing = randomUUID();

      for (const membershipId of [fx.carolInB, missing]) {
        const asLead = await call('patch', pathIn(fx.orgA), fx.alice, {
          leadMembershipId: membershipId,
        });
        const asResponder = await call(
          'post',
          `${pathIn(fx.orgA)}/responders`,
          fx.alice,
          { membershipId },
        );

        expectCode(asLead, 404, 'MEMBERSHIP_NOT_FOUND');
        expectCode(asResponder, 404, 'MEMBERSHIP_NOT_FOUND');
      }

      const stored = await prisma.incident.findFirstOrThrow({
        where: { organizationId: fx.orgA },
      });
      expect(stored.leadMembershipId).toBeNull();
      expect(await prisma.incidentResponder.count()).toBe(0);
    });

    it('should refuse assigning a member whose account was deleted', async () => {
      await declare(fx.orgA, fx.alice, fx.apiA);
      const dave = await membershipOf(fx.orgA, fx.dave);
      await prisma.user.update({
        where: { id: fx.dave },
        data: { deletedAt: new Date() },
      });

      expectCode(
        await call('post', `${pathIn(fx.orgA)}/responders`, fx.alice, {
          membershipId: dave,
        }),
        404,
        'MEMBERSHIP_NOT_FOUND',
      );
    });

    it("should not reach another organization's incident", async () => {
      await declare(fx.orgB, fx.bob, fx.apiB);
      const carolInA = await membershipOf(fx.orgA, fx.carol);

      // Carol is a member of both; incident 1 exists only in B.
      expectCode(
        await call('post', `${pathIn(fx.orgA)}/responders`, fx.carol, {
          membershipId: carolInA,
        }),
        404,
        'INCIDENT_NOT_FOUND',
      );
      expect(await prisma.incidentResponder.count()).toBe(0);
    });

    it('should answer removing someone who is not responding with 404', async () => {
      await declare(fx.orgA, fx.alice, fx.apiA);
      const dave = await membershipOf(fx.orgA, fx.dave);
      const responders = `${pathIn(fx.orgA)}/responders`;

      for (const membershipId of [dave, fx.carolInB, 'not-a-uuid']) {
        expectCode(
          await call('delete', `${responders}/${membershipId}`, fx.alice),
          404,
          'RESPONDER_NOT_FOUND',
        );
      }
    });

    it('should keep a resolved incident frozen: no lead or responder changes', async () => {
      await declare(fx.orgA, fx.alice, fx.apiA);
      const dave = await membershipOf(fx.orgA, fx.dave);
      const carol = await membershipOf(fx.orgA, fx.carol);
      const responders = `${pathIn(fx.orgA)}/responders`;
      await call('post', responders, fx.alice, { membershipId: dave });
      await call('patch', pathIn(fx.orgA), fx.alice, { status: 'RESOLVED' });
      const before = await prisma.incident.findFirstOrThrow({
        where: { organizationId: fx.orgA },
      });

      expectCode(
        await call('patch', pathIn(fx.orgA), fx.alice, {
          leadMembershipId: carol,
        }),
        409,
        'INCIDENT_RESOLVED',
      );
      expectCode(
        await call('post', responders, fx.alice, { membershipId: carol }),
        409,
        'INCIDENT_RESOLVED',
      );
      expectCode(
        await call('delete', `${responders}/${dave}`, fx.alice),
        409,
        'INCIDENT_RESOLVED',
      );

      const after = await prisma.incident.findFirstOrThrow({
        where: { organizationId: fx.orgA },
      });
      expect(after.leadMembershipId).toBeNull();
      expect(after.updatedAt).toEqual(before.updatedAt);
      expect(await prisma.incidentResponder.count()).toBe(1);
    });

    it('should wait for an in-flight resolution, then refuse adding a responder', async () => {
      await declare(fx.orgA, fx.alice, fx.apiA);
      const dave = await membershipOf(fx.orgA, fx.dave);
      const held = await hold((tx) =>
        tx.incident.updateMany({
          where: { organizationId: fx.orgA, number: 1 },
          data: { status: 'RESOLVED', resolvedAt: new Date() },
        }),
      );
      const adding = inFlight(
        call('post', `${pathIn(fx.orgA)}/responders`, fx.alice, {
          membershipId: dave,
        }),
      );

      await someoneIsWaitingOnALock();
      held.release();
      await held.done;

      expectCode(await adding, 409, 'INCIDENT_RESOLVED');
      expect(await prisma.incidentResponder.count()).toBe(0);
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
      await call('patch', `${fx.orgA}/${incidentPath}`, fx.carol, {
        status: 'IDENTIFIED',
      });
      await post(fx.orgA, fx.carol, 'Connection pool exhaustion identified.');
      await call('patch', `${fx.orgA}/${incidentPath}`, fx.alice, {
        status: 'RESOLVED',
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
        [
          'UPDATE',
          'Investigating elevated database latency.',
          null,
          'Dave Duarte',
        ],
        ['SEVERITY_CHANGED', 'SEV2', 'SEV1', 'Carol Chen'],
        ['STATUS_CHANGED', 'INVESTIGATING', 'IDENTIFIED', 'Carol Chen'],
        [
          'UPDATE',
          'Connection pool exhaustion identified.',
          null,
          'Carol Chen',
        ],
        ['STATUS_CHANGED', 'IDENTIFIED', 'RESOLVED', 'Alice Anders'],
      ]);
    });

    it('should record the two changes of one request, and nothing for a value that did not change', async () => {
      await declare(fx.orgA, fx.alice, fx.apiA);

      await call('patch', `${fx.orgA}/${incidentPath}`, fx.alice, {
        severity: 'SEV3',
        status: 'MONITORING',
      });
      await call('patch', `${fx.orgA}/${incidentPath}`, fx.alice, {
        severity: 'SEV3',
        status: 'MONITORING',
        title: 'Renamed',
        teamId: fx.platformA,
      });

      const types = (await timelineOf(fx.orgA, fx.alice)).body.map(
        (entry: { type: string }) => entry.type,
      );

      expect(types).toHaveLength(3);
      expect(types[0]).toBe('DECLARED');
      expect(types.slice(1).sort()).toEqual([
        'SEVERITY_CHANGED',
        'STATUS_CHANGED',
      ]);
    });

    it('should keep the timeline of a resolved incident readable, and refuse new updates with 409', async () => {
      await declare(fx.orgA, fx.alice, fx.apiA);
      await call('patch', `${fx.orgA}/${incidentPath}`, fx.alice, {
        status: 'RESOLVED',
      });

      expectCode(
        await post(fx.orgA, fx.alice, 'Customer comms sent.'),
        409,
        'INCIDENT_RESOLVED',
      );
      expect((await timelineOf(fx.orgA, fx.alice)).body).toHaveLength(2);
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
