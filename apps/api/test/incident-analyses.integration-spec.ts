import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from './../src/app.module.js';
import { TokenService } from './../src/auth/token.service.js';
import { PrismaService } from './../src/database/prisma.service.js';
import type { Prisma } from './../src/generated/prisma/client.js';
import { leakedKeys } from './leaks.js';
import { resolveTestDatabaseUrl } from './test-database.js';

/**
 * Incident analyses against a real database.
 *
 * Two tenants. Alice is ADMIN of A, Bob of B; Carol is ADMIN in A and MEMBER
 * in B — one token, two capacities. Dave and Erin are MEMBERs of A. Dave is
 * on A's Payments team, which owns its Payment API; Carol is on B's.
 *
 * What is proven here and nowhere else: that an admin starts a resolved
 * incident's analysis, and every member reads it, with facts and key moments
 * derived from the incident's real timeline; that an active incident is
 * refused; that of any number of concurrent starts exactly one succeeds and
 * the rest are told it has started — never two analyses, never a 500 —
 * including the start that only the unique key can refuse; that the owner is
 * an active member of the admitted organization, a foreign, missing, or
 * deleted one being indistinguishable; and that another organization's
 * incidents are indistinguishable from missing ones.
 */

interface Fixture {
  orgA: string;
  orgB: string;
  alice: string;
  bob: string;
  carol: string;
  dave: string;
  erin: string;
  aliceInA: string;
  carolInB: string;
  daveInA: string;
  erinInA: string;
  apiA: string;
  apiB: string;
}

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

describe('incident analyses (integration)', () => {
  const prisma = new PrismaService({ url: resolveTestDatabaseUrl() });
  let app: INestApplication;
  let tokens: TokenService;
  let fx: Fixture;

  const call = async (
    method: 'get' | 'post' | 'patch',
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

  const analysisPath = (organizationId: string, number: number) =>
    `${organizationId}/incidents/${number}/analysis`;

  const startAnalysis = (
    organizationId: string,
    userId: string,
    number: number,
    body?: object,
  ) => call('post', analysisPath(organizationId, number), userId, body);

  const readAnalysis = (
    organizationId: string,
    userId: string,
    number: number,
  ) => call('get', analysisPath(organizationId, number), userId);

  const analysesOf = (organizationId: string) =>
    prisma.incidentAnalysis.count({ where: { organizationId } });

  /**
   * Declares a Payment API incident as `admin`, has `responder` start
   * investigating, post an update, and complete, then resolves it. Answers
   * its number.
   */
  const aResolvedIncident = async (
    organizationId: string,
    admin: string,
    responder: string,
    serviceId: string,
  ) => {
    const declared = await call('post', `${organizationId}/incidents`, admin, {
      title: 'Card payments failing',
      serviceId,
      severity: 'SEV2',
    });
    const number = declared.body.number as number;
    const incident = `${organizationId}/incidents/${number}`;

    expect(declared.status).toBe(201);
    expect(
      (await call('post', `${incident}/responders/me`, responder)).status,
    ).toBe(200);
    expect(
      (
        await call('post', `${incident}/updates`, responder, {
          message: 'Card processor timing out.',
        })
      ).status,
    ).toBe(201);
    expect(
      (await call('post', `${incident}/responders/me/complete`, responder))
        .status,
    ).toBe(200);
    expect(
      (
        await call('patch', incident, admin, {
          status: 'RESOLVED',
          resolution: 'Failed over to the secondary processor.',
        })
      ).status,
    ).toBe(200);

    return number;
  };

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
    const grant = async (
      organizationId: string,
      userId: string,
      role: 'ADMIN' | 'MEMBER',
    ) =>
      (
        await prisma.membership.create({
          data: { organizationId, userId, role },
          select: { id: true },
        })
      ).id;
    const team = async (organizationId: string, membershipId: string) => {
      const { id } = await prisma.team.create({
        data: { organizationId, name: 'Payments', slug: 'payments' },
        select: { id: true },
      });

      await prisma.teamMembership.create({
        data: { organizationId, teamId: id, membershipId },
      });

      return id;
    };
    const service = async (organizationId: string, ownerTeamId: string) =>
      (
        await prisma.service.create({
          data: {
            organizationId,
            ownerTeamId,
            name: 'Payment API',
            slug: 'payment-api',
          },
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

    const aliceInA = await grant(orgA, alice, 'ADMIN');
    await grant(orgB, bob, 'ADMIN');
    await grant(orgA, carol, 'ADMIN');
    const carolInB = await grant(orgB, carol, 'MEMBER');
    const daveInA = await grant(orgA, dave, 'MEMBER');
    const erinInA = await grant(orgA, erin, 'MEMBER');

    return {
      orgA,
      orgB,
      alice,
      bob,
      carol,
      dave,
      erin,
      aliceInA,
      carolInB,
      daveInA,
      erinInA,
      apiA: await service(orgA, await team(orgA, daveInA)),
      apiB: await service(orgB, await team(orgB, carolInB)),
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

  describe('starting and reading', () => {
    it('should start a resolved incident’s analysis as a draft owned by the admin, with facts from its timeline', async () => {
      const number = await aResolvedIncident(
        fx.orgA,
        fx.alice,
        fx.dave,
        fx.apiA,
      );
      const incident = await prisma.incident.findFirstOrThrow({
        where: { organizationId: fx.orgA, number },
        select: {
          createdAt: true,
          resolvedAt: true,
          responders: { select: { startedAt: true } },
        },
      });

      const started = await startAnalysis(fx.orgA, fx.alice, number);

      expect(started.status).toBe(201);
      expect(started.body).toEqual({
        status: 'DRAFT',
        version: 1,
        owner: { membershipId: fx.aliceInA, name: 'Alice Anders' },
        summary: null,
        impact: null,
        cause: null,
        lessons: null,
        createdBy: { id: fx.alice, name: 'Alice Anders' },
        createdAt: expect.any(String),
        publishedBy: null,
        publishedAt: null,
        updatedAt: expect.any(String),
        facts: {
          declaredAt: incident.createdAt.toISOString(),
          resolvedAt: incident.resolvedAt?.toISOString(),
          firstResponseAt: incident.responders[0].startedAt.toISOString(),
          responderCount: 1,
          updateCount: 1,
          severity: { declared: 'SEV2', highest: 'SEV2', final: 'SEV2' },
          reassignmentCount: 0,
        },
        keyMoments: [
          expect.objectContaining({
            kind: 'DECLARED',
            actor: { id: fx.alice, name: 'Alice Anders' },
            toValue: 'SEV2',
          }),
          expect.objectContaining({
            kind: 'FIRST_RESPONSE',
            actor: { id: fx.dave, name: 'Dave Duarte' },
          }),
          expect.objectContaining({
            kind: 'LAST_RESPONSE_COMPLETED',
            actor: { id: fx.dave, name: 'Dave Duarte' },
          }),
          expect.objectContaining({
            kind: 'RESOLVED',
            actor: { id: fx.alice, name: 'Alice Anders' },
            toValue: 'RESOLVED',
          }),
        ],
      });

      // Every member reads the same analysis the start answered with.
      for (const userId of [fx.alice, fx.dave, fx.erin]) {
        const read = await readAnalysis(fx.orgA, userId, number);

        expect(read.status).toBe(200);
        expect(read.body).toEqual(started.body);
      }
    });

    it('should start it owned by another active member of the organization', async () => {
      const number = await aResolvedIncident(
        fx.orgA,
        fx.alice,
        fx.dave,
        fx.apiA,
      );

      const started = await startAnalysis(fx.orgA, fx.carol, number, {
        ownerMembershipId: fx.daveInA,
      });

      expect(started.status).toBe(201);
      expect(started.body.owner).toEqual({
        membershipId: fx.daveInA,
        name: 'Dave Duarte',
      });
      // Started by the caller, whoever owns it.
      expect(started.body.createdBy).toEqual({
        id: fx.carol,
        name: 'Carol Chen',
      });
    });

    it('should answer 404 ANALYSIS_NOT_STARTED for a resolved incident nobody has analysed', async () => {
      const number = await aResolvedIncident(
        fx.orgA,
        fx.alice,
        fx.dave,
        fx.apiA,
      );

      expectCode(
        await readAnalysis(fx.orgA, fx.dave, number),
        404,
        'ANALYSIS_NOT_STARTED',
      );
    });

    it('should refuse an active incident with 409 INCIDENT_NOT_RESOLVED, writing nothing', async () => {
      const declared = await call('post', `${fx.orgA}/incidents`, fx.alice, {
        title: 'Card payments failing',
        serviceId: fx.apiA,
        severity: 'SEV2',
      });

      expectCode(
        await startAnalysis(fx.orgA, fx.alice, declared.body.number),
        409,
        'INCIDENT_NOT_RESOLVED',
      );
      expect(await analysesOf(fx.orgA)).toBe(0);
    });

    it('should refuse a member starting one with 403, writing nothing', async () => {
      const number = await aResolvedIncident(
        fx.orgA,
        fx.alice,
        fx.dave,
        fx.apiA,
      );

      expectCode(
        await startAnalysis(fx.orgA, fx.dave, number, {
          ownerMembershipId: fx.daveInA,
        }),
        403,
        'PERMISSION_DENIED',
      );
      expect(await analysesOf(fx.orgA)).toBe(0);
    });

    it('should judge a caller by their capacity in the organization named, not another', async () => {
      // Carol is ADMIN in A and MEMBER in B.
      const inB = await aResolvedIncident(fx.orgB, fx.bob, fx.carol, fx.apiB);

      expectCode(
        await startAnalysis(fx.orgB, fx.carol, inB),
        403,
        'PERMISSION_DENIED',
      );
      expect(await analysesOf(fx.orgB)).toBe(0);
    });
  });

  describe('one analysis per incident', () => {
    it('should refuse a second start with 409 ANALYSIS_ALREADY_STARTED, keeping the first', async () => {
      const number = await aResolvedIncident(
        fx.orgA,
        fx.alice,
        fx.dave,
        fx.apiA,
      );

      expect((await startAnalysis(fx.orgA, fx.alice, number)).status).toBe(201);
      expectCode(
        await startAnalysis(fx.orgA, fx.carol, number, {
          ownerMembershipId: fx.daveInA,
        }),
        409,
        'ANALYSIS_ALREADY_STARTED',
      );

      const read = await readAnalysis(fx.orgA, fx.alice, number);

      expect(read.body.owner.membershipId).toBe(fx.aliceInA);
      expect(await analysesOf(fx.orgA)).toBe(1);
    });

    it('should let exactly one of many concurrent starts succeed, and tell the rest', async () => {
      const number = await aResolvedIncident(
        fx.orgA,
        fx.alice,
        fx.dave,
        fx.apiA,
      );

      const responses = await Promise.all(
        Array.from({ length: 6 }, (_, index) =>
          startAnalysis(fx.orgA, index % 2 === 0 ? fx.alice : fx.carol, number),
        ),
      );

      expect(responses.map((response) => response.status).sort()).toEqual([
        201, 409, 409, 409, 409, 409,
      ]);
      for (const response of responses.filter(({ status }) => status === 409)) {
        expect(response.body.code).toBe('ANALYSIS_ALREADY_STARTED');
      }
      expect(await analysesOf(fx.orgA)).toBe(1);
    });

    // The start the read cannot catch: another start has inserted but not
    // committed, so this one reads no analysis, then waits on the unique key
    // until the other commits — and must be told, not given a 500.
    it('should answer a start refused only by the unique key with 409 ANALYSIS_ALREADY_STARTED', async () => {
      const number = await aResolvedIncident(
        fx.orgA,
        fx.alice,
        fx.dave,
        fx.apiA,
      );
      const { id: incidentId } = await prisma.incident.findFirstOrThrow({
        where: { organizationId: fx.orgA, number },
        select: { id: true },
      });

      const other = await hold((tx) =>
        tx.incidentAnalysis.create({
          data: {
            organizationId: fx.orgA,
            incidentId,
            ownerMembershipId: fx.daveInA,
            createdById: fx.carol,
          },
        }),
      );
      const pending = startAnalysis(fx.orgA, fx.alice, number);

      pending.catch(() => undefined);
      await someoneIsWaitingOnALock();
      other.release();
      await other.done;

      expectCode(await pending, 409, 'ANALYSIS_ALREADY_STARTED');
      expect(await analysesOf(fx.orgA)).toBe(1);
      expect(
        (await readAnalysis(fx.orgA, fx.alice, number)).body.owner.membershipId,
      ).toBe(fx.daveInA);
    });
  });

  describe('tenant isolation', () => {
    it('should refuse an owner who is not an active member here, alike whether foreign, missing, or deleted', async () => {
      const number = await aResolvedIncident(
        fx.orgA,
        fx.alice,
        fx.dave,
        fx.apiA,
      );

      const foreign = await startAnalysis(fx.orgA, fx.alice, number, {
        ownerMembershipId: fx.carolInB,
      });
      const missing = await startAnalysis(fx.orgA, fx.alice, number, {
        ownerMembershipId: randomUUID(),
      });

      await prisma.user.update({
        where: { id: fx.erin },
        data: { deletedAt: new Date() },
      });

      const deleted = await startAnalysis(fx.orgA, fx.alice, number, {
        ownerMembershipId: fx.erinInA,
      });

      expectCode(foreign, 404, 'MEMBERSHIP_NOT_FOUND');
      expect(comparable(missing.body)).toEqual(comparable(foreign.body));
      expect(comparable(deleted.body)).toEqual(comparable(foreign.body));
      expect(await analysesOf(fx.orgA)).toBe(0);
    });

    it("should answer another organization's incident exactly as a missing one, reading and starting", async () => {
      // B has incidents 1 and 2, and an analysis of 2; A has only 1.
      await aResolvedIncident(fx.orgB, fx.bob, fx.carol, fx.apiB);
      const inB = await aResolvedIncident(fx.orgB, fx.bob, fx.carol, fx.apiB);
      await aResolvedIncident(fx.orgA, fx.alice, fx.dave, fx.apiA);

      expect((await startAnalysis(fx.orgB, fx.bob, inB)).status).toBe(201);

      const missing = await readAnalysis(fx.orgA, fx.alice, 99);

      expectCode(missing, 404, 'INCIDENT_NOT_FOUND');
      expect(
        comparable((await readAnalysis(fx.orgA, fx.alice, inB)).body),
      ).toEqual(comparable(missing.body));
      expect(
        comparable((await startAnalysis(fx.orgA, fx.alice, inB)).body),
      ).toEqual(comparable(missing.body));
      expect(await analysesOf(fx.orgA)).toBe(0);
      expect(await analysesOf(fx.orgB)).toBe(1);
    });

    it('should answer a malformed incident number with 404 INCIDENT_NOT_FOUND', async () => {
      expectCode(
        await call('get', `${fx.orgA}/incidents/INC-1/analysis`, fx.alice),
        404,
        'INCIDENT_NOT_FOUND',
      );
    });
  });
});
