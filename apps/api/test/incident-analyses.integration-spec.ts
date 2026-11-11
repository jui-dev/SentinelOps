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
 * incident's analysis, and whoever may read the incident reads it, with facts and key moments
 * derived from the incident's real timeline; that an active incident is
 * refused; that of any number of concurrent starts exactly one succeeds and
 * the rest are told it has started — never two analyses, never a 500 —
 * including the start that only the unique key can refuse; that a draft is
 * edited by its owner or an admin, section by section, one version at a
 * time — of two edits based on one version exactly one applies, and an edit
 * the conditional UPDATE alone refuses is told why, never applied and never
 * a 500 — and a published one is not edited at all; that an admin hands a
 * draft to another active member one version at a time, so an edit its old
 * owner already had under way is refused, and they may no longer edit it;
 * that the owner or an admin publishes a draft that has a summary, once,
 * as it stood at the version they read — never a text changed under them,
 * and a second publication is told it was published; that the owner is
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
    method: 'get' | 'post' | 'patch' | 'put',
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
    await prisma.$executeRaw`
      UPDATE incidents SET response_access = 'OPEN'
      WHERE organization_id = ${organizationId}::uuid AND number = ${number}`;
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

  /**
   * Resolves once at least `sessions` other sessions in this database are
   * waiting on a lock.
   */
  const someoneIsWaitingOnALock = async (sessions = 1) => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const [{ waiting }] = await prisma.$queryRaw<{ waiting: number }[]>`
        SELECT count(*)::int AS waiting
        FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`;

      if (waiting >= sessions) return;

      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    throw new Error(`Fewer than ${sessions} sessions waiting on a lock`);
  };

  const editAnalysis = (
    organizationId: string,
    userId: string,
    number: number,
    body: object,
  ) => call('patch', analysisPath(organizationId, number), userId, body);

  /**
   * Places a member of A on A's Payments team, which is responsible for its
   * incidents: they see them, and own none of their analyses.
   */
  const onPaymentsInA = async (membershipId: string) => {
    const { id: teamId } = await prisma.team.findFirstOrThrow({
      where: { organizationId: fx.orgA },
      select: { id: true },
    });

    await prisma.teamMembership.create({
      data: { organizationId: fx.orgA, teamId, membershipId },
    });
  };

  /** The analysis row as it stands, read directly. */
  const stored = (organizationId: string, number: number) =>
    prisma.incidentAnalysis.findFirstOrThrow({
      where: { organizationId, incident: { number } },
      select: {
        id: true,
        status: true,
        version: true,
        summary: true,
        impact: true,
        cause: true,
        lessons: true,
        doneSections: true,
        updatedAt: true,
      },
    });

  /** A resolved incident in A with a draft analysis Dave owns. */
  const aDraftDaveOwns = async () => {
    const number = await aResolvedIncident(fx.orgA, fx.alice, fx.dave, fx.apiA);

    expect(
      (
        await startAnalysis(fx.orgA, fx.alice, number, {
          ownerMembershipId: fx.daveInA,
        })
      ).status,
    ).toBe(201);

    return number;
  };

  const reassign = (
    organizationId: string,
    userId: string,
    number: number,
    body: object,
  ) =>
    call('put', `${analysisPath(organizationId, number)}/owner`, userId, body);

  const publishAnalysis = (
    organizationId: string,
    userId: string,
    number: number,
    body: object,
  ) =>
    call(
      'post',
      `${analysisPath(organizationId, number)}/publish`,
      userId,
      body,
    );

  /**
   * A resolved incident in A whose analysis Dave owns, given a summary and
   * published through the routes: version 3, summary 'Final'.
   */
  const aPublishedAnalysisDaveOwns = async () => {
    const number = await aDraftDaveOwns();

    expect(
      (
        await editAnalysis(fx.orgA, fx.dave, number, {
          version: 1,
          summary: 'Final',
          markDone: ['summary'],
        })
      ).status,
    ).toBe(200);
    expect(
      (await publishAnalysis(fx.orgA, fx.dave, number, { version: 2 })).status,
    ).toBe(200);

    return number;
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
        doneSections: [],
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

      // Whoever may read the incident reads the same analysis the start
      // answered with: the admin, and Dave, on its team. Erin, on no team
      // and with no part in it, finds no incident at all.
      for (const userId of [fx.alice, fx.dave]) {
        const read = await readAnalysis(fx.orgA, userId, number);

        expect(read.status).toBe(200);
        expect(read.body).toEqual(started.body);
      }

      expectCode(
        await readAnalysis(fx.orgA, fx.erin, number),
        404,
        'INCIDENT_NOT_FOUND',
      );
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

  describe('editing', () => {
    it('should let the owner edit sections one version at a time, leaving the others as they were', async () => {
      const number = await aDraftDaveOwns();
      const before = await stored(fx.orgA, number);

      const first = await editAnalysis(fx.orgA, fx.dave, number, {
        version: 1,
        summary: 'Card payments failed for two hours.',
        cause: 'An expired certificate on the processor link.',
      });

      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({
        status: 'DRAFT',
        version: 2,
        summary: 'Card payments failed for two hours.',
        impact: null,
        cause: 'An expired certificate on the processor link.',
        lessons: null,
      });
      expect(new Date(first.body.updatedAt).getTime()).toBeGreaterThan(
        before.updatedAt.getTime(),
      );

      const second = await editAnalysis(fx.orgA, fx.dave, number, {
        version: 2,
        impact: 'Every card checkout in the EU.',
      });

      expect(second.status).toBe(200);
      expect(second.body).toMatchObject({
        version: 3,
        summary: 'Card payments failed for two hours.',
        impact: 'Every card checkout in the EU.',
        cause: 'An expired certificate on the processor link.',
        lessons: null,
      });
      // The facts are still the incident's, derived as before.
      expect(second.body.facts.responderCount).toBe(1);
      // Another reader, who may read every incident, sees the same.
      expect((await readAnalysis(fx.orgA, fx.carol, number)).body).toEqual(
        second.body,
      );
    });

    it('should clear a section sent blank or null', async () => {
      const number = await aDraftDaveOwns();

      await editAnalysis(fx.orgA, fx.dave, number, {
        version: 1,
        summary: 'Summary',
        cause: 'Cause',
      });

      const cleared = await editAnalysis(fx.orgA, fx.dave, number, {
        version: 2,
        summary: '   ',
        cause: null,
      });

      expect(cleared.status).toBe(200);
      expect(cleared.body).toMatchObject({
        version: 3,
        summary: null,
        cause: null,
      });
    });

    it('should record which sections are done, one version at a time', async () => {
      const number = await aDraftDaveOwns();

      // Text alone does not make a section done.
      const written = await editAnalysis(fx.orgA, fx.dave, number, {
        version: 1,
        summary: 'Card payments failed for two hours.',
      });

      expect(written.status).toBe(200);
      expect(written.body.doneSections).toEqual([]);

      // Marking one done is an edit like any other, and may carry its text.
      const marked = await editAnalysis(fx.orgA, fx.dave, number, {
        version: 2,
        cause: 'An expired certificate.',
        markDone: ['cause', 'summary'],
      });

      expect(marked.status).toBe(200);
      expect(marked.body).toMatchObject({
        version: 3,
        cause: 'An expired certificate.',
        doneSections: ['summary', 'cause'],
      });

      // Saved, not just answered.
      expect((await stored(fx.orgA, number)).doneSections.sort()).toEqual([
        'cause',
        'summary',
      ]);

      // Changing a done section's words un-marks it; the other stays done.
      const changed = await editAnalysis(fx.orgA, fx.dave, number, {
        version: 3,
        summary: 'Card payments failed for three hours.',
      });

      expect(changed.body.doneSections).toEqual(['cause']);

      const reopened = await editAnalysis(fx.orgA, fx.dave, number, {
        version: 4,
        reopen: ['cause'],
      });

      expect(reopened.status).toBe(200);
      expect(reopened.body).toMatchObject({
        version: 5,
        cause: 'An expired certificate.',
        doneSections: [],
      });
    });

    it('should refuse to mark done a section with no text, or against an older version, changing nothing', async () => {
      const number = await aDraftDaveOwns();

      expectCode(
        await editAnalysis(fx.orgA, fx.dave, number, {
          version: 1,
          markDone: ['lessons'],
        }),
        409,
        'ANALYSIS_SECTION_NOT_WRITTEN',
      );

      await editAnalysis(fx.orgA, fx.dave, number, {
        version: 1,
        summary: 'Card payments failed.',
      });

      expectCode(
        await editAnalysis(fx.orgA, fx.dave, number, {
          version: 1,
          markDone: ['summary'],
        }),
        409,
        'ANALYSIS_CHANGED',
      );

      expect(await stored(fx.orgA, number)).toMatchObject({
        version: 2,
        doneSections: [],
      });
    });

    it('should make a new version of every accepted edit, even one that changes no text', async () => {
      const number = await aDraftDaveOwns();

      await editAnalysis(fx.orgA, fx.dave, number, {
        version: 1,
        summary: 'Summary',
      });
      const again = await editAnalysis(fx.orgA, fx.dave, number, {
        version: 2,
        summary: 'Summary',
      });

      expect(again.status).toBe(200);
      expect(again.body.version).toBe(3);
    });

    it('should let an admin edit a draft they do not own, and refuse a member who does not own it', async () => {
      const number = await aDraftDaveOwns();

      const byAdmin = await editAnalysis(fx.orgA, fx.carol, number, {
        version: 1,
        lessons: 'Alert on certificate expiry.',
      });

      expect(byAdmin.status).toBe(200);
      expect(byAdmin.body.version).toBe(2);

      // Erin sees the incident, on its team, and does not own the analysis.
      await onPaymentsInA(fx.erinInA);
      expectCode(
        await editAnalysis(fx.orgA, fx.erin, number, {
          version: 2,
          lessons: 'Rewritten by someone else',
        }),
        403,
        'NOT_ANALYSIS_OWNER',
      );
      expect(await stored(fx.orgA, number)).toMatchObject({
        version: 2,
        lessons: 'Alert on certificate expiry.',
      });
    });

    it('should refuse an edit based on an older version with 409 ANALYSIS_CHANGED, applying nothing', async () => {
      const number = await aDraftDaveOwns();

      await editAnalysis(fx.orgA, fx.dave, number, {
        version: 1,
        summary: 'Current',
      });

      expectCode(
        await editAnalysis(fx.orgA, fx.carol, number, {
          version: 1,
          summary: 'Stale',
          impact: 'Stale',
        }),
        409,
        'ANALYSIS_CHANGED',
      );
      expect(await stored(fx.orgA, number)).toMatchObject({
        version: 2,
        summary: 'Current',
        impact: null,
      });
    });

    it('should apply exactly one of two edits based on the same version', async () => {
      const number = await aDraftDaveOwns();

      const responses = await Promise.all([
        editAnalysis(fx.orgA, fx.dave, number, {
          version: 1,
          summary: 'From Dave',
        }),
        editAnalysis(fx.orgA, fx.carol, number, {
          version: 1,
          summary: 'From Carol',
        }),
      ]);
      const [winner] = responses.filter(({ status }) => status === 200);
      const [loser] = responses.filter(({ status }) => status === 409);

      expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
      expect(loser.body.code).toBe('ANALYSIS_CHANGED');
      expect(await stored(fx.orgA, number)).toMatchObject({
        version: 2,
        summary: winner.body.summary,
      });
    });

    // The edit only the database can refuse: another writer has moved the
    // version on but not committed, so this edit reads version 1 and passes
    // every check, then its UPDATE waits on the row. Once the other commits,
    // Postgres re-evaluates the UPDATE's WHERE against the new row, matches
    // nothing, and the edit must be told — not applied, not a 500.
    it('should refuse an edit whose version moved on while its UPDATE waited, with 409 ANALYSIS_CHANGED', async () => {
      const number = await aDraftDaveOwns();
      const { id } = await stored(fx.orgA, number);

      const other = await hold((tx) =>
        tx.incidentAnalysis.update({
          where: { id },
          data: { lessons: 'Held', version: { increment: 1 } },
        }),
      );
      const pending = editAnalysis(fx.orgA, fx.dave, number, {
        version: 1,
        summary: 'Waited',
      });

      pending.catch(() => undefined);
      await someoneIsWaitingOnALock();
      other.release();
      await other.done;

      expectCode(await pending, 409, 'ANALYSIS_CHANGED');
      expect(await stored(fx.orgA, number)).toMatchObject({
        version: 2,
        summary: null,
        lessons: 'Held',
      });
    });

    it('should refuse an edit the analysis was published under while its UPDATE waited, with 409 ANALYSIS_PUBLISHED', async () => {
      const number = await aDraftDaveOwns();
      const { id } = await stored(fx.orgA, number);

      const publisher = await hold((tx) =>
        tx.incidentAnalysis.update({
          where: { id },
          data: {
            status: 'PUBLISHED',
            summary: 'Published summary',
            publishedAt: new Date(),
            publishedById: fx.alice,
            version: { increment: 1 },
          },
        }),
      );
      const pending = editAnalysis(fx.orgA, fx.dave, number, {
        version: 1,
        summary: 'Too late',
      });

      pending.catch(() => undefined);
      await someoneIsWaitingOnALock();
      publisher.release();
      await publisher.done;

      expectCode(await pending, 409, 'ANALYSIS_PUBLISHED');
      expect(await stored(fx.orgA, number)).toMatchObject({
        status: 'PUBLISHED',
        version: 2,
        summary: 'Published summary',
      });
    });

    it('should refuse editing a published analysis with 409 ANALYSIS_PUBLISHED, applying nothing', async () => {
      const number = await aPublishedAnalysisDaveOwns();

      for (const userId of [fx.dave, fx.alice]) {
        expectCode(
          await editAnalysis(fx.orgA, userId, number, {
            version: 3,
            summary: 'Changed after publishing',
          }),
          409,
          'ANALYSIS_PUBLISHED',
        );
      }
      expect(await stored(fx.orgA, number)).toMatchObject({
        status: 'PUBLISHED',
        version: 3,
        summary: 'Final',
      });
    });

    it('should answer 404 ANALYSIS_NOT_STARTED for an incident nobody has analysed', async () => {
      const number = await aResolvedIncident(
        fx.orgA,
        fx.alice,
        fx.dave,
        fx.apiA,
      );

      expectCode(
        await editAnalysis(fx.orgA, fx.alice, number, {
          version: 1,
          summary: 'Summary',
        }),
        404,
        'ANALYSIS_NOT_STARTED',
      );
    });

    it("should answer another organization's incident exactly as a missing one", async () => {
      // B's incident 1 has an analysis Bob started; A has no incident 1.
      const inB = await aResolvedIncident(fx.orgB, fx.bob, fx.carol, fx.apiB);

      expect((await startAnalysis(fx.orgB, fx.bob, inB)).status).toBe(201);

      const body = { version: 1, summary: 'From another organization' };
      const missing = await editAnalysis(fx.orgA, fx.alice, 99, body);

      expectCode(missing, 404, 'INCIDENT_NOT_FOUND');
      expect(
        comparable((await editAnalysis(fx.orgA, fx.alice, inB, body)).body),
      ).toEqual(comparable(missing.body));
      expect(await stored(fx.orgB, inB)).toMatchObject({
        version: 1,
        summary: null,
      });
    });

    it('should judge a caller by their capacity in the organization named', async () => {
      // Carol is ADMIN in A, but only a MEMBER in B, where Bob owns it.
      const inB = await aResolvedIncident(fx.orgB, fx.bob, fx.carol, fx.apiB);

      expect((await startAnalysis(fx.orgB, fx.bob, inB)).status).toBe(201);
      expectCode(
        await editAnalysis(fx.orgB, fx.carol, inB, {
          version: 1,
          summary: 'Summary',
        }),
        403,
        'NOT_ANALYSIS_OWNER',
      );
    });
  });

  describe('reassigning the owner', () => {
    /** The analysis row's owner and version, read directly. */
    const ownership = async (organizationId: string, number: number) => {
      const { status, version, owner } =
        await prisma.incidentAnalysis.findFirstOrThrow({
          where: { organizationId, incident: { number } },
          select: {
            status: true,
            version: true,
            owner: { select: { id: true } },
          },
        });

      return { status, version, ownerMembershipId: owner.id };
    };

    it('should hand a draft to another active member as the next version', async () => {
      const number = await aDraftDaveOwns();

      const response = await reassign(fx.orgA, fx.alice, number, {
        ownerMembershipId: fx.erinInA,
        version: 1,
      });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        status: 'DRAFT',
        version: 2,
        owner: { membershipId: fx.erinInA, name: 'Erin Estrada' },
        // Who started it does not change.
        createdBy: { id: fx.alice, name: 'Alice Anders' },
      });
      expect((await readAnalysis(fx.orgA, fx.dave, number)).body).toEqual(
        response.body,
      );
    });

    // The ownership and concurrency contract, through the real routes: an
    // edit Dave already had under way when he was replaced is refused as
    // changed; once he reads the analysis again he is not its owner, and
    // Erin edits it at the version it is now.
    it("should refuse the old owner's edit already under way, then his next one, and let the new owner edit", async () => {
      const number = await aDraftDaveOwns();
      const { id } = await stored(fx.orgA, number);

      // Holds the row, so both requests below pass their checks and then
      // queue on it: the reassignment first, Dave's edit behind it.
      const gate = await hold(
        (tx) =>
          tx.$queryRaw`SELECT id FROM incident_analyses WHERE id = ${id}::uuid FOR UPDATE`,
      );
      const reassigning = reassign(fx.orgA, fx.alice, number, {
        ownerMembershipId: fx.erinInA,
        version: 1,
      });

      reassigning.catch(() => undefined);
      await someoneIsWaitingOnALock(1);

      const editing = editAnalysis(fx.orgA, fx.dave, number, {
        version: 1,
        summary: 'Written by Dave while he was replaced',
      });

      editing.catch(() => undefined);
      await someoneIsWaitingOnALock(2);
      gate.release();
      await gate.done;

      const reassigned = await reassigning;

      expect(reassigned.status).toBe(200);
      expect(reassigned.body.version).toBe(2);
      expectCode(await editing, 409, 'ANALYSIS_CHANGED');

      // Dave reads it again: Erin owns it, at version 2.
      const refetched = await readAnalysis(fx.orgA, fx.dave, number);

      expect(refetched.body).toMatchObject({
        version: 2,
        summary: null,
        owner: { membershipId: fx.erinInA },
      });
      expectCode(
        await editAnalysis(fx.orgA, fx.dave, number, {
          version: refetched.body.version,
          summary: 'Written by Dave after he was replaced',
        }),
        403,
        'NOT_ANALYSIS_OWNER',
      );

      const byErin = await editAnalysis(fx.orgA, fx.erin, number, {
        version: 2,
        summary: 'Written by Erin',
      });

      expect(byErin.status).toBe(200);
      expect(byErin.body).toMatchObject({
        version: 3,
        summary: 'Written by Erin',
      });
    });

    it('should refuse a reassignment whose version moved on while its UPDATE waited, with 409 ANALYSIS_CHANGED', async () => {
      const number = await aDraftDaveOwns();
      const { id } = await stored(fx.orgA, number);

      // An edit, applied but not yet committed.
      const edit = await hold((tx) =>
        tx.incidentAnalysis.update({
          where: { id },
          data: { summary: 'Held edit', version: { increment: 1 } },
        }),
      );
      const pending = reassign(fx.orgA, fx.alice, number, {
        ownerMembershipId: fx.erinInA,
        version: 1,
      });

      pending.catch(() => undefined);
      await someoneIsWaitingOnALock();
      edit.release();
      await edit.done;

      expectCode(await pending, 409, 'ANALYSIS_CHANGED');
      expect(await ownership(fx.orgA, number)).toEqual({
        status: 'DRAFT',
        version: 2,
        ownerMembershipId: fx.daveInA,
      });
    });

    it('should apply exactly one of two reassignments based on the same version', async () => {
      const number = await aDraftDaveOwns();

      const responses = await Promise.all([
        reassign(fx.orgA, fx.alice, number, {
          ownerMembershipId: fx.erinInA,
          version: 1,
        }),
        reassign(fx.orgA, fx.carol, number, {
          ownerMembershipId: fx.aliceInA,
          version: 1,
        }),
      ]);
      const [winner] = responses.filter(({ status }) => status === 200);
      const [loser] = responses.filter(({ status }) => status === 409);

      expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
      expect(loser.body.code).toBe('ANALYSIS_CHANGED');
      expect(await ownership(fx.orgA, number)).toEqual({
        status: 'DRAFT',
        version: 2,
        ownerMembershipId: winner.body.owner.membershipId,
      });
    });

    it('should accept naming the current owner, and still make a new version', async () => {
      const number = await aDraftDaveOwns();

      const response = await reassign(fx.orgA, fx.alice, number, {
        ownerMembershipId: fx.daveInA,
        version: 1,
      });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        version: 2,
        owner: { membershipId: fx.daveInA },
      });
    });

    it('should refuse an owner who is not an active member here, alike whether foreign, missing, or deleted', async () => {
      const number = await aDraftDaveOwns();

      const foreign = await reassign(fx.orgA, fx.alice, number, {
        ownerMembershipId: fx.carolInB,
        version: 1,
      });
      const missing = await reassign(fx.orgA, fx.alice, number, {
        ownerMembershipId: randomUUID(),
        version: 1,
      });

      await prisma.user.update({
        where: { id: fx.erin },
        data: { deletedAt: new Date() },
      });

      const deleted = await reassign(fx.orgA, fx.alice, number, {
        ownerMembershipId: fx.erinInA,
        version: 1,
      });

      expectCode(foreign, 404, 'MEMBERSHIP_NOT_FOUND');
      expect(comparable(missing.body)).toEqual(comparable(foreign.body));
      expect(comparable(deleted.body)).toEqual(comparable(foreign.body));
      expect(await ownership(fx.orgA, number)).toEqual({
        status: 'DRAFT',
        version: 1,
        ownerMembershipId: fx.daveInA,
      });
    });

    it('should refuse a stale version with 409 ANALYSIS_CHANGED, changing nothing', async () => {
      const number = await aDraftDaveOwns();

      await editAnalysis(fx.orgA, fx.dave, number, {
        version: 1,
        summary: 'Summary',
      });

      expectCode(
        await reassign(fx.orgA, fx.alice, number, {
          ownerMembershipId: fx.erinInA,
          version: 1,
        }),
        409,
        'ANALYSIS_CHANGED',
      );
      expect(await ownership(fx.orgA, number)).toMatchObject({
        version: 2,
        ownerMembershipId: fx.daveInA,
      });
    });

    it('should refuse reassigning a published analysis with 409 ANALYSIS_PUBLISHED', async () => {
      const number = await aPublishedAnalysisDaveOwns();

      expectCode(
        await reassign(fx.orgA, fx.alice, number, {
          ownerMembershipId: fx.erinInA,
          version: 3,
        }),
        409,
        'ANALYSIS_PUBLISHED',
      );
      expect(await ownership(fx.orgA, number)).toEqual({
        status: 'PUBLISHED',
        version: 3,
        ownerMembershipId: fx.daveInA,
      });
    });

    it('should refuse a member, even the owner, with 403', async () => {
      const number = await aDraftDaveOwns();

      expectCode(
        await reassign(fx.orgA, fx.dave, number, {
          ownerMembershipId: fx.erinInA,
          version: 1,
        }),
        403,
        'PERMISSION_DENIED',
      );
      expect((await ownership(fx.orgA, number)).version).toBe(1);
    });

    it('should answer 404 ANALYSIS_NOT_STARTED for an incident nobody has analysed', async () => {
      const number = await aResolvedIncident(
        fx.orgA,
        fx.alice,
        fx.dave,
        fx.apiA,
      );

      expectCode(
        await reassign(fx.orgA, fx.alice, number, {
          ownerMembershipId: fx.erinInA,
          version: 1,
        }),
        404,
        'ANALYSIS_NOT_STARTED',
      );
    });

    it("should answer another organization's incident exactly as a missing one, and judge the caller by the organization named", async () => {
      const inB = await aResolvedIncident(fx.orgB, fx.bob, fx.carol, fx.apiB);

      expect((await startAnalysis(fx.orgB, fx.bob, inB)).status).toBe(201);

      const body = { ownerMembershipId: fx.erinInA, version: 1 };
      const missing = await reassign(fx.orgA, fx.alice, 99, body);

      expectCode(missing, 404, 'INCIDENT_NOT_FOUND');
      expect(
        comparable((await reassign(fx.orgA, fx.alice, inB, body)).body),
      ).toEqual(comparable(missing.body));
      // Carol is ADMIN in A, but only a MEMBER in B.
      expectCode(
        await reassign(fx.orgB, fx.carol, inB, {
          ownerMembershipId: fx.carolInB,
          version: 1,
        }),
        403,
        'PERMISSION_DENIED',
      );
      expect((await ownership(fx.orgB, inB)).version).toBe(1);
    });
  });

  describe('publishing', () => {
    /** The published columns as they stand, read directly. */
    const publication = (organizationId: string, number: number) =>
      prisma.incidentAnalysis.findFirstOrThrow({
        where: { organizationId, incident: { number } },
        select: {
          id: true,
          status: true,
          version: true,
          summary: true,
          publishedAt: true,
          publishedById: true,
        },
      });

    /** Dave's draft with a summary written: version 2. */
    const aSummarisedDraftDaveOwns = async () => {
      const number = await aDraftDaveOwns();

      expect(
        (
          await editAnalysis(fx.orgA, fx.dave, number, {
            version: 1,
            summary: 'Card payments failed for two hours.',
            markDone: ['summary'],
          })
        ).status,
      ).toBe(200);

      return number;
    };

    it('should publish the owner’s draft as it stands, attributed to them, as the next version', async () => {
      const number = await aSummarisedDraftDaveOwns();
      const before = Date.now();

      const published = await publishAnalysis(fx.orgA, fx.dave, number, {
        version: 2,
      });

      expect(published.status).toBe(200);
      expect(published.body).toMatchObject({
        status: 'PUBLISHED',
        version: 3,
        owner: { membershipId: fx.daveInA, name: 'Dave Duarte' },
        createdBy: { id: fx.alice, name: 'Alice Anders' },
        publishedBy: { id: fx.dave, name: 'Dave Duarte' },
        summary: 'Card payments failed for two hours.',
        // The other sections may honestly be unknown.
        impact: null,
        cause: null,
        lessons: null,
      });
      expect(
        new Date(published.body.publishedAt).getTime(),
      ).toBeGreaterThanOrEqual(before - 1000);
      // Another reader, who may read every incident, sees the same.
      expect((await readAnalysis(fx.orgA, fx.carol, number)).body).toEqual(
        published.body,
      );
    });

    it('should let an admin publish a draft they do not own, and record who published it apart from owner and starter', async () => {
      const number = await aSummarisedDraftDaveOwns();

      await reassign(fx.orgA, fx.alice, number, {
        ownerMembershipId: fx.erinInA,
        version: 2,
      });

      const published = await publishAnalysis(fx.orgA, fx.carol, number, {
        version: 3,
      });

      expect(published.status).toBe(200);
      expect(published.body).toMatchObject({
        version: 4,
        createdBy: { id: fx.alice },
        owner: { membershipId: fx.erinInA },
        publishedBy: { id: fx.carol, name: 'Carol Chen' },
      });
    });

    it('should refuse a member who does not own it with 403 NOT_ANALYSIS_OWNER, keeping it a draft', async () => {
      const number = await aSummarisedDraftDaveOwns();

      // Erin sees the incident, on its team, and does not own the analysis.
      await onPaymentsInA(fx.erinInA);
      expectCode(
        await publishAnalysis(fx.orgA, fx.erin, number, { version: 2 }),
        403,
        'NOT_ANALYSIS_OWNER',
      );
      expect(await publication(fx.orgA, number)).toMatchObject({
        status: 'DRAFT',
        version: 2,
        publishedAt: null,
        publishedById: null,
      });
    });

    it('should refuse a draft without a summary with 409 ANALYSIS_SUMMARY_REQUIRED, keeping it a draft', async () => {
      const number = await aDraftDaveOwns();

      await editAnalysis(fx.orgA, fx.dave, number, {
        version: 1,
        impact: 'Every card checkout.',
        cause: 'Not yet determined.',
        lessons: 'Alert on certificate expiry.',
      });

      expectCode(
        await publishAnalysis(fx.orgA, fx.dave, number, { version: 2 }),
        409,
        'ANALYSIS_SUMMARY_REQUIRED',
      );
      expect(await publication(fx.orgA, number)).toMatchObject({
        status: 'DRAFT',
        version: 2,
      });
    });

    it('should refuse a summary that is written but not marked done, keeping it a draft', async () => {
      const number = await aDraftDaveOwns();

      await editAnalysis(fx.orgA, fx.dave, number, {
        version: 1,
        summary: 'Card payments failed.',
      });

      expectCode(
        await publishAnalysis(fx.orgA, fx.dave, number, { version: 2 }),
        409,
        'ANALYSIS_SUMMARY_REQUIRED',
      );
      expect((await publication(fx.orgA, number)).status).toBe('DRAFT');
    });

    it('should publish an optional section still in progress, as it stands', async () => {
      const number = await aDraftDaveOwns();

      await editAnalysis(fx.orgA, fx.dave, number, {
        version: 1,
        summary: 'Card payments failed.',
        impact: 'Still counting.',
        markDone: ['summary'],
      });

      const published = await publishAnalysis(fx.orgA, fx.dave, number, {
        version: 2,
      });

      expect(published.status).toBe(200);
      expect(published.body).toMatchObject({
        status: 'PUBLISHED',
        impact: 'Still counting.',
        doneSections: ['summary'],
      });
    });

    it('should refuse a stale version with 409 ANALYSIS_CHANGED, keeping it a draft', async () => {
      const number = await aSummarisedDraftDaveOwns();

      expectCode(
        await publishAnalysis(fx.orgA, fx.dave, number, { version: 1 }),
        409,
        'ANALYSIS_CHANGED',
      );
      expect((await publication(fx.orgA, number)).status).toBe('DRAFT');
    });

    it('should tell a second publication, and a repeated one, that it is published — keeping the first publisher', async () => {
      const number = await aPublishedAnalysisDaveOwns();

      // A double click, with the version the first click read.
      expectCode(
        await publishAnalysis(fx.orgA, fx.dave, number, { version: 2 }),
        409,
        'ANALYSIS_PUBLISHED',
      );
      // Someone else, with the version it has now.
      expectCode(
        await publishAnalysis(fx.orgA, fx.alice, number, { version: 3 }),
        409,
        'ANALYSIS_PUBLISHED',
      );
      expect(await publication(fx.orgA, number)).toMatchObject({
        status: 'PUBLISHED',
        version: 3,
        publishedById: fx.dave,
      });
    });

    it('should publish exactly once of two concurrent publications', async () => {
      const number = await aSummarisedDraftDaveOwns();

      const responses = await Promise.all([
        publishAnalysis(fx.orgA, fx.dave, number, { version: 2 }),
        publishAnalysis(fx.orgA, fx.alice, number, { version: 2 }),
      ]);
      const [winner] = responses.filter(({ status }) => status === 200);
      const [loser] = responses.filter(({ status }) => status === 409);

      expect(responses.map(({ status }) => status).sort()).toEqual([200, 409]);
      expect(loser.body.code).toBe('ANALYSIS_PUBLISHED');
      expect(await publication(fx.orgA, number)).toMatchObject({
        status: 'PUBLISHED',
        version: 3,
        publishedById: winner.body.publishedBy.id,
      });
    });

    // The safety the version gives publishing: an edit that cleared the
    // summary is applied but not committed, so the publication reads the
    // old summary and passes every check, then waits on the row. Once the
    // edit commits, the publication matches nothing — a text changed under
    // it is never published.
    it('should not publish a summary cleared while its UPDATE waited', async () => {
      const number = await aSummarisedDraftDaveOwns();
      const { id } = await publication(fx.orgA, number);

      const edit = await hold((tx) =>
        tx.incidentAnalysis.update({
          where: { id },
          data: { summary: null, version: { increment: 1 } },
        }),
      );
      const pending = publishAnalysis(fx.orgA, fx.dave, number, {
        version: 2,
      });

      pending.catch(() => undefined);
      await someoneIsWaitingOnALock();
      edit.release();
      await edit.done;

      expectCode(await pending, 409, 'ANALYSIS_CHANGED');
      expect(await publication(fx.orgA, number)).toMatchObject({
        status: 'DRAFT',
        version: 3,
        summary: null,
        publishedAt: null,
        publishedById: null,
      });
    });

    it('should refuse an edit queued behind a publication with 409 ANALYSIS_PUBLISHED', async () => {
      const number = await aSummarisedDraftDaveOwns();
      const { id } = await publication(fx.orgA, number);

      const gate = await hold(
        (tx) =>
          tx.$queryRaw`SELECT id FROM incident_analyses WHERE id = ${id}::uuid FOR UPDATE`,
      );
      const publishing = publishAnalysis(fx.orgA, fx.dave, number, {
        version: 2,
      });

      publishing.catch(() => undefined);
      await someoneIsWaitingOnALock(1);

      const editing = editAnalysis(fx.orgA, fx.alice, number, {
        version: 2,
        summary: 'Rewritten as it was published',
      });

      editing.catch(() => undefined);
      await someoneIsWaitingOnALock(2);
      gate.release();
      await gate.done;

      expect((await publishing).status).toBe(200);
      expectCode(await editing, 409, 'ANALYSIS_PUBLISHED');
      expect(await publication(fx.orgA, number)).toMatchObject({
        status: 'PUBLISHED',
        version: 3,
        summary: 'Card payments failed for two hours.',
      });
    });

    it("should refuse the old owner's publication queued behind a reassignment, then refuse him outright", async () => {
      const number = await aSummarisedDraftDaveOwns();
      const { id } = await publication(fx.orgA, number);

      const gate = await hold(
        (tx) =>
          tx.$queryRaw`SELECT id FROM incident_analyses WHERE id = ${id}::uuid FOR UPDATE`,
      );
      const reassigning = reassign(fx.orgA, fx.alice, number, {
        ownerMembershipId: fx.erinInA,
        version: 2,
      });

      reassigning.catch(() => undefined);
      await someoneIsWaitingOnALock(1);

      const publishing = publishAnalysis(fx.orgA, fx.dave, number, {
        version: 2,
      });

      publishing.catch(() => undefined);
      await someoneIsWaitingOnALock(2);
      gate.release();
      await gate.done;

      expect((await reassigning).status).toBe(200);
      expectCode(await publishing, 409, 'ANALYSIS_CHANGED');
      expectCode(
        await publishAnalysis(fx.orgA, fx.dave, number, { version: 3 }),
        403,
        'NOT_ANALYSIS_OWNER',
      );
      expect(await publication(fx.orgA, number)).toMatchObject({
        status: 'DRAFT',
        version: 3,
      });
    });

    it('should answer 404 ANALYSIS_NOT_STARTED for an incident nobody has analysed', async () => {
      const number = await aResolvedIncident(
        fx.orgA,
        fx.alice,
        fx.dave,
        fx.apiA,
      );

      expectCode(
        await publishAnalysis(fx.orgA, fx.alice, number, { version: 1 }),
        404,
        'ANALYSIS_NOT_STARTED',
      );
    });

    it("should answer another organization's incident exactly as a missing one, and judge the caller by the organization named", async () => {
      const inB = await aResolvedIncident(fx.orgB, fx.bob, fx.carol, fx.apiB);

      expect((await startAnalysis(fx.orgB, fx.bob, inB)).status).toBe(201);
      expect(
        (
          await editAnalysis(fx.orgB, fx.bob, inB, {
            version: 1,
            summary: 'Summary in B',
          })
        ).status,
      ).toBe(200);

      const missing = await publishAnalysis(fx.orgA, fx.alice, 99, {
        version: 2,
      });

      expectCode(missing, 404, 'INCIDENT_NOT_FOUND');
      expect(
        comparable(
          (await publishAnalysis(fx.orgA, fx.alice, inB, { version: 2 })).body,
        ),
      ).toEqual(comparable(missing.body));
      // Carol is ADMIN in A, but only a MEMBER in B, where Bob owns it.
      expectCode(
        await publishAnalysis(fx.orgB, fx.carol, inB, { version: 2 }),
        403,
        'NOT_ANALYSIS_OWNER',
      );
      expect((await publication(fx.orgB, inB)).status).toBe('DRAFT');
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
