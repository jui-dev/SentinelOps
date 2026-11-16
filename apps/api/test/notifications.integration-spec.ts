import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from './../src/app.module.js';
import { TokenService } from './../src/auth/token.service.js';
import { PrismaService } from './../src/database/prisma.service.js';
import type { NotificationType } from './../src/generated/prisma/enums.js';
import { NOTIFICATION_PAGE_SIZE } from './../src/notifications/notifications.service.js';
import { leakedKeys } from './leaks.js';
import { resolveTestDatabaseUrl, truncate } from './test-database.js';

/**
 * Notifications against a real database.
 *
 * Two tenants. Alice is ADMIN of A and Dave a MEMBER of A; Bob is ADMIN of B;
 * Carol is ADMIN in A and MEMBER in B — one token, two memberships, two
 * inboxes. Nothing generates notifications yet, so rows are written directly.
 *
 * What is proven here and nowhere else: that a caller lists, counts, and
 * acknowledges only their own admitted membership's notifications in the
 * organization they are in; that anyone else's is indistinguishable from none
 * and is left untouched; that pages hold together across ties; that readAt is
 * written once, even under concurrent acknowledgement; and that reading
 * through a notification leaves anything newer unread.
 */

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

interface Fixture {
  orgA: string;
  orgB: string;
  alice: string;
  bob: string;
  dave: string;
  carol: string;
  aliceInA: string;
  daveInA: string;
  carolInA: string;
  carolInB: string;
  bobInB: string;
  paymentsA: string;
  paymentsB: string;
  /** INC-1 in A, declared SEV2 by Alice, since raised to SEV1. */
  declaredA: string;
  raisedA: string;
  /** An entry on an incident in B. */
  declaredB: string;
}

const MISSING = '0199a1b2-c3d4-7000-8000-00000000dead';

describe('notifications (integration)', () => {
  const prisma = new PrismaService({ url: resolveTestDatabaseUrl() });
  let app: INestApplication;
  let tokens: TokenService;
  let fx: Fixture;

  const call = async (
    method: 'get' | 'post',
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

  /** A team notification, written directly, at a time of the test's choosing. */
  const aTeamNotification = async (
    organizationId: string,
    recipientMembershipId: string,
    teamId: string,
    createdAt: Date,
    type: NotificationType = 'TEAM_MEMBERSHIP_ADDED',
  ) =>
    (
      await prisma.notification.create({
        data: {
          organizationId,
          recipientMembershipId,
          type,
          actorId: fx.alice,
          teamId,
          createdAt,
        },
        select: { id: true },
      })
    ).id;

  const readAtOf = async (id: string) =>
    (
      await prisma.notification.findUniqueOrThrow({
        where: { id },
        select: { readAt: true },
      })
    ).readAt;

  const at = (minute: number) =>
    new Date(Date.UTC(2026, 8, 18, 12, minute, 0, 0));

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
      role: 'ADMIN' | 'RESPONDER',
    ) =>
      (
        await prisma.membership.create({
          data: { organizationId, userId, role },
          select: { id: true },
        })
      ).id;
    const team = async (organizationId: string) =>
      (
        await prisma.team.create({
          data: { organizationId, name: 'Payments', slug: 'payments' },
          select: { id: true },
        })
      ).id;
    const incident = async (
      organizationId: string,
      teamId: string,
      createdById: string,
    ) => {
      const service = await prisma.service.create({
        data: {
          organizationId,
          ownerTeamId: teamId,
          name: 'Payment API',
          slug: 'payment-api',
        },
        select: { id: true },
      });

      return prisma.incident.create({
        data: {
          organizationId,
          number: 1,
          title: 'Card payments failing',
          serviceId: service.id,
          teamId,
          severity: 'SEV1',
          createdById,
        },
        select: { id: true },
      });
    };
    const entry = async (
      organizationId: string,
      incidentId: string,
      actorId: string,
      data: {
        type: 'DECLARED' | 'SEVERITY_CHANGED';
        fromValue?: string;
        toValue: string;
      },
    ) =>
      (
        await prisma.incidentActivity.create({
          data: { organizationId, incidentId, actorId, ...data },
          select: { id: true },
        })
      ).id;

    const orgA = await organization('Acme Operations', 'acme-operations');
    const orgB = await organization('Bravo Reliability', 'bravo-reliability');
    const alice = await user('alice@acme.example', 'Alice Anders');
    const bob = await user('bob@bravo.example', 'Bob Brandt');
    const carol = await user('carol@both.example', 'Carol Chen');
    const dave = await user('dave@acme.example', 'Dave Duarte');
    const paymentsA = await team(orgA);
    const paymentsB = await team(orgB);
    const incidentA = await incident(orgA, paymentsA, alice);
    const incidentB = await incident(orgB, paymentsB, bob);

    return {
      orgA,
      orgB,
      alice,
      bob,
      dave,
      carol,
      aliceInA: await grant(orgA, alice, 'ADMIN'),
      daveInA: await grant(orgA, dave, 'RESPONDER'),
      carolInA: await grant(orgA, carol, 'ADMIN'),
      carolInB: await grant(orgB, carol, 'RESPONDER'),
      bobInB: await grant(orgB, bob, 'ADMIN'),
      paymentsA,
      paymentsB,
      declaredA: await entry(orgA, incidentA.id, alice, {
        type: 'DECLARED',
        toValue: 'SEV2',
      }),
      raisedA: await entry(orgA, incidentA.id, alice, {
        type: 'SEVERITY_CHANGED',
        fromValue: 'SEV2',
        toValue: 'SEV1',
      }),
      declaredB: await entry(orgB, incidentB.id, bob, {
        type: 'DECLARED',
        toValue: 'SEV1',
      }),
    };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('/api/v1');
    await app.listen(0);

    tokens = app.get(TokenService);
  });

  beforeEach(async () => {
    await truncate(
      prisma,
      'TRUNCATE TABLE incidents, services, team_memberships, teams, invitations, refresh_tokens, memberships, users, organizations RESTART IDENTITY CASCADE',
    );

    fx = await seed();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('reading', () => {
    it('should list the incident as it stands and the change as recorded, newest first', async () => {
      await prisma.notification.create({
        data: {
          organizationId: fx.orgA,
          recipientMembershipId: fx.daveInA,
          type: 'INCIDENT_DECLARED',
          actorId: fx.alice,
          activityId: fx.declaredA,
          createdAt: at(1),
        },
      });
      await prisma.notification.create({
        data: {
          organizationId: fx.orgA,
          recipientMembershipId: fx.daveInA,
          type: 'INCIDENT_SEVERITY_CHANGED',
          actorId: fx.alice,
          activityId: fx.raisedA,
          createdAt: at(2),
        },
      });
      // Alice departs; she is still named.
      await prisma.user.update({
        where: { id: fx.alice },
        data: { deletedAt: new Date() },
      });

      const response = await call('get', `${fx.orgA}/notifications`, fx.dave);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        items: [
          {
            id: expect.any(String),
            type: 'INCIDENT_SEVERITY_CHANGED',
            createdAt: at(2).toISOString(),
            readAt: null,
            actor: { id: fx.alice, name: 'Alice Anders' },
            incident: {
              number: 1,
              title: 'Card payments failing',
              severity: 'SEV1',
              status: 'DECLARED',
              service: { name: 'Payment API', slug: 'payment-api' },
            },
            change: { from: 'SEV2', to: 'SEV1' },
            team: null,
          },
          expect.objectContaining({
            type: 'INCIDENT_DECLARED',
            change: { from: null, to: 'SEV2' },
          }),
        ],
        page: { cursor: null, hasMore: false },
      });
      expect(JSON.stringify(response.body)).not.toContain('@');
    });

    it("should list and count only the caller's own, never a teammate's", async () => {
      await aTeamNotification(fx.orgA, fx.aliceInA, fx.paymentsA, at(1));
      await aTeamNotification(fx.orgA, fx.daveInA, fx.paymentsA, at(2));
      await aTeamNotification(fx.orgA, fx.daveInA, fx.paymentsA, at(3));

      const list = await call('get', `${fx.orgA}/notifications`, fx.alice);
      const count = await call(
        'get',
        `${fx.orgA}/notifications/unread-count`,
        fx.alice,
      );

      expect(list.body.items).toHaveLength(1);
      expect(list.body.items[0].createdAt).toBe(at(1).toISOString());
      expect(count.body).toEqual({ count: 1 });
    });

    it("should keep one person's two memberships as two inboxes", async () => {
      await aTeamNotification(fx.orgA, fx.carolInA, fx.paymentsA, at(1));
      await aTeamNotification(fx.orgB, fx.carolInB, fx.paymentsB, at(2));
      await aTeamNotification(fx.orgB, fx.carolInB, fx.paymentsB, at(3));

      const inA = await call('get', `${fx.orgA}/notifications`, fx.carol);
      const inB = await call('get', `${fx.orgB}/notifications`, fx.carol);

      expect(
        inA.body.items.map((item: { team: { id: string } }) => item.team.id),
      ).toEqual([fx.paymentsA]);
      expect(
        inB.body.items.map((item: { team: { id: string } }) => item.team.id),
      ).toEqual([fx.paymentsB, fx.paymentsB]);
      expect(
        (await call('get', `${fx.orgA}/notifications/unread-count`, fx.carol))
          .body,
      ).toEqual({ count: 1 });
      expect(
        (await call('get', `${fx.orgB}/notifications/unread-count`, fx.carol))
          .body,
      ).toEqual({ count: 2 });
    });

    it('should refuse an organization the caller is not in, and one soft-deleted', async () => {
      await aTeamNotification(fx.orgB, fx.bobInB, fx.paymentsB, at(1));

      const outsider = await call('get', `${fx.orgB}/notifications`, fx.dave);

      expect(outsider.status).toBe(404);
      expect(outsider.body.code).toBe('ORGANIZATION_NOT_FOUND');

      await prisma.organization.update({
        where: { id: fx.orgB },
        data: { deletedAt: new Date() },
      });

      for (const path of ['notifications', 'notifications/unread-count']) {
        const response = await call('get', `${fx.orgB}/${path}`, fx.bob);

        expect(response.status).toBe(404);
      }
    });
  });

  describe('paging', () => {
    it('should walk every page with no repeat and no gap, across ties on createdAt', async () => {
      const count = 2 * NOTIFICATION_PAGE_SIZE + 5;
      // Most share one instant, so the id alone orders them; the rest are
      // either side of it. Dave's are interleaved and must never appear.
      for (let i = 0; i < count; i += 1) {
        const createdAt = i < 5 ? at(1) : i < count - 5 ? at(2) : at(3);

        await aTeamNotification(fx.orgA, fx.aliceInA, fx.paymentsA, createdAt);
        await aTeamNotification(fx.orgA, fx.daveInA, fx.paymentsA, createdAt);
      }

      const expected = (
        await prisma.notification.findMany({
          where: { recipientMembershipId: fx.aliceInA },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { id: true },
        })
      ).map(({ id }) => id);

      const seen: string[] = [];
      const sizes: number[] = [];
      let cursor: string | null = null;

      do {
        const response: request.Response = await call(
          'get',
          `${fx.orgA}/notifications${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`,
          fx.alice,
        );

        expect(response.status).toBe(200);
        seen.push(
          ...response.body.items.map((item: { id: string }) => item.id),
        );
        sizes.push(response.body.items.length);
        expect(response.body.page.hasMore).toBe(
          response.body.page.cursor !== null,
        );
        cursor = response.body.page.cursor;
      } while (cursor);

      expect(sizes).toEqual([
        NOTIFICATION_PAGE_SIZE,
        NOTIFICATION_PAGE_SIZE,
        5,
      ]);
      expect(seen).toEqual(expected);
    });

    it('should refuse a cursor it did not issue with 400', async () => {
      const response = await call(
        'get',
        `${fx.orgA}/notifications?cursor=page-2`,
        fx.alice,
      );

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('INVALID_CURSOR');
    });
  });

  describe('acknowledging one', () => {
    it('should write readAt once: the first acknowledgement stands', async () => {
      const id = await aTeamNotification(
        fx.orgA,
        fx.aliceInA,
        fx.paymentsA,
        at(1),
      );

      const first = await call(
        'post',
        `${fx.orgA}/notifications/${id}/read`,
        fx.alice,
      );
      const again = await call(
        'post',
        `${fx.orgA}/notifications/${id}/read`,
        fx.alice,
      );

      expect(first.status).toBe(200);
      expect(first.body.readAt).toEqual(expect.any(String));
      expect(again.status).toBe(200);
      expect(again.body.readAt).toBe(first.body.readAt);
      expect((await readAtOf(id))?.toISOString()).toBe(first.body.readAt);
      expect(
        (await call('get', `${fx.orgA}/notifications/unread-count`, fx.alice))
          .body,
      ).toEqual({ count: 0 });
    });

    it('should settle concurrent acknowledgements on one readAt', async () => {
      const id = await aTeamNotification(
        fx.orgA,
        fx.aliceInA,
        fx.paymentsA,
        at(1),
      );

      const responses = await Promise.all(
        Array.from({ length: 6 }, () =>
          call('post', `${fx.orgA}/notifications/${id}/read`, fx.alice),
        ),
      );
      const stored = (await readAtOf(id))?.toISOString();

      expect(responses.map(({ status }) => status)).toEqual(Array(6).fill(200));
      expect(stored).toEqual(expect.any(String));
      expect(new Set(responses.map(({ body }) => body.readAt))).toEqual(
        new Set([stored]),
      );
    });

    it("should answer anyone else's notification exactly as a missing one, and leave it unread", async () => {
      const alices = await aTeamNotification(
        fx.orgA,
        fx.aliceInA,
        fx.paymentsA,
        at(1),
      );
      const bobs = await aTeamNotification(
        fx.orgB,
        fx.bobInB,
        fx.paymentsB,
        at(1),
      );
      const carolsInB = await aTeamNotification(
        fx.orgB,
        fx.carolInB,
        fx.paymentsB,
        at(1),
      );

      const missing = await call(
        'post',
        `${fx.orgA}/notifications/${MISSING}/read`,
        fx.dave,
      );

      expect(missing.status).toBe(404);
      expect(missing.body.code).toBe('NOTIFICATION_NOT_FOUND');

      for (const [id, userId] of [
        // A teammate's, in the same organization.
        [alices, fx.dave],
        // Another organization's, named from this one.
        [bobs, fx.alice],
        // The caller's own, but from their other membership.
        [carolsInB, fx.carol],
        ['not-a-uuid', fx.dave],
      ]) {
        const response = await call(
          'post',
          `${fx.orgA}/notifications/${id}/read`,
          userId,
        );

        expect(response.status).toBe(404);
        expect(comparable(response.body)).toEqual(comparable(missing.body));
      }

      for (const id of [alices, bobs, carolsInB]) {
        expect(await readAtOf(id)).toBeNull();
      }
    });
  });

  describe('reading through', () => {
    it('should acknowledge up to the bound, leave anything newer unread, and answer with what remains', async () => {
      const ids: string[] = [];

      for (let minute = 1; minute <= 5; minute += 1) {
        ids.push(
          await aTeamNotification(
            fx.orgA,
            fx.aliceInA,
            fx.paymentsA,
            at(minute),
          ),
        );
      }
      const davesOlder = await aTeamNotification(
        fx.orgA,
        fx.daveInA,
        fx.paymentsA,
        at(0),
      );

      const response = await call(
        'post',
        `${fx.orgA}/notifications/read`,
        fx.alice,
        {
          through: ids[2],
        },
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ count: 2 });
      for (const id of ids.slice(0, 3)) {
        expect(await readAtOf(id)).not.toBeNull();
      }
      for (const id of ids.slice(3)) {
        expect(await readAtOf(id)).toBeNull();
      }
      expect(await readAtOf(davesOlder)).toBeNull();
    });

    it('should leave unread a notification that arrived after the newest one seen', async () => {
      await aTeamNotification(fx.orgA, fx.aliceInA, fx.paymentsA, at(1));
      await aTeamNotification(fx.orgA, fx.aliceInA, fx.paymentsA, at(2));

      const seen = await call('get', `${fx.orgA}/notifications`, fx.alice);
      const newestSeen = seen.body.items[0].id as string;

      // Arrives while the list is open: the same instant as the newest seen,
      // and after it, as well as later.
      const sameInstant = await prisma.notification.create({
        data: {
          organizationId: fx.orgA,
          recipientMembershipId: fx.aliceInA,
          type: 'TEAM_MEMBERSHIP_REMOVED',
          actorId: fx.alice,
          teamId: fx.paymentsA,
          createdAt: at(2),
        },
        select: { id: true },
      });
      const later = await aTeamNotification(
        fx.orgA,
        fx.aliceInA,
        fx.paymentsA,
        at(3),
      );

      const response = await call(
        'post',
        `${fx.orgA}/notifications/read`,
        fx.alice,
        {
          through: newestSeen,
        },
      );

      expect(response.body).toEqual({ count: 2 });
      expect(await readAtOf(sameInstant.id)).toBeNull();
      expect(await readAtOf(later)).toBeNull();
    });

    it('should keep the readAt of one already acknowledged', async () => {
      const older = await aTeamNotification(
        fx.orgA,
        fx.aliceInA,
        fx.paymentsA,
        at(1),
      );
      const newer = await aTeamNotification(
        fx.orgA,
        fx.aliceInA,
        fx.paymentsA,
        at(2),
      );
      const first = await call(
        'post',
        `${fx.orgA}/notifications/${older}/read`,
        fx.alice,
      );

      await new Promise((resolve) => setTimeout(resolve, 5));
      await call('post', `${fx.orgA}/notifications/read`, fx.alice, {
        through: newer,
      });

      expect((await readAtOf(older))?.toISOString()).toBe(first.body.readAt);
      expect(await readAtOf(newer)).not.toBeNull();
    });

    it("should refuse a bound that is anyone else's exactly as a missing one, changing nothing", async () => {
      const davesOwn = await aTeamNotification(
        fx.orgA,
        fx.daveInA,
        fx.paymentsA,
        at(1),
      );
      const alices = await aTeamNotification(
        fx.orgA,
        fx.aliceInA,
        fx.paymentsA,
        at(2),
      );
      const bobs = await aTeamNotification(
        fx.orgB,
        fx.bobInB,
        fx.paymentsB,
        at(3),
      );

      const missing = await call(
        'post',
        `${fx.orgA}/notifications/read`,
        fx.dave,
        {
          through: MISSING,
        },
      );

      expect(missing.status).toBe(404);
      expect(missing.body.code).toBe('NOTIFICATION_NOT_FOUND');

      for (const through of [alices, bobs]) {
        const response = await call(
          'post',
          `${fx.orgA}/notifications/read`,
          fx.dave,
          { through },
        );

        expect(response.status).toBe(404);
        expect(comparable(response.body)).toEqual(comparable(missing.body));
      }

      // Alice's is newer than Dave's own: had it been accepted as a bound,
      // Dave's would now be read.
      for (const id of [davesOwn, alices, bobs]) {
        expect(await readAtOf(id)).toBeNull();
      }
    });
  });
});
