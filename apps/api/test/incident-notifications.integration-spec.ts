import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from './../src/app.module.js';
import { TokenService } from './../src/auth/token.service.js';
import { PrismaService } from './../src/database/prisma.service.js';
import { NotificationsWriter } from './../src/notifications/notifications.writer.js';
import { resolveTestDatabaseUrl } from './test-database.js';

/**
 * The notifications incident workflows write, against a real database and
 * through the real routes.
 *
 * Organization A. Alice is the Admin who runs the lifecycle; Gus is a second
 * Admin on no team. Payments is Ben, Cara, Dan, and Carol; Platform is Ben
 * and Eve. Payment API is Payments'. Carol is also a member of organization
 * B, where Bob is the Admin.
 *
 * What is proven here: who each timeline entry is told to, entry by entry —
 * several entries from one request each reach their own recipients — that
 * each notification takes its entry's time, that a change which records
 * nothing notifies nobody, that a failed notification rolls the whole change
 * back, that two responses completing at once make one "ready to resolve",
 * and that nothing crosses into another organization.
 */

type Person = 'alice' | 'gus' | 'ben' | 'cara' | 'dan' | 'eve' | 'carol';

interface Fixture {
  orgA: string;
  orgB: string;
  users: Record<Person | 'bob', string>;
  /** Each person's membership in A; Bob's and Carol's in B. */
  inA: Record<Person, string>;
  carolInB: string;
  bobInB: string;
  payments: string;
  platform: string;
  paymentApi: string;
  ledgerB: string;
}

describe('incident notifications (integration)', () => {
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

    return body === undefined ? pending : pending.send(body);
  };

  const as = (person: Person) => fx.users[person];

  const declare = async (
    serviceId = fx.paymentApi,
    orgId = fx.orgA,
    access: 'OPEN' | 'PENDING' = 'OPEN',
  ) => {
    const response = await call(
      'post',
      `${orgId}/incidents`,
      orgId === fx.orgA ? as('alice') : fx.users.bob,
      { title: 'Card payments failing', serviceId, severity: 'SEV2' },
    );

    expect(response.status).toBe(201);
    await prisma.$executeRaw`
      UPDATE incidents SET response_access = ${access}::incident_response_access
      WHERE organization_id = ${orgId}::uuid
        AND number = ${response.body.number as number}`;

    return response.body.number as number;
  };

  const respond = async (person: Person, number: number, step = '') => {
    const response = await call(
      'post',
      `${fx.orgA}/incidents/${number}/responders/me${step}`,
      as(person),
    );

    expect(response.status).toBe(200);
  };

  const change = async (number: number, body: object, expected = 200) => {
    const response = await call(
      'patch',
      `${fx.orgA}/incidents/${number}`,
      as('alice'),
      body,
    );

    expect(response.status).toBe(expected);

    return response;
  };

  /** Who is told of each entry of this type: sorted names per entry. */
  const toldOf = async (
    type: string,
  ): Promise<{ activityId: string; recipients: string[] }[]> => {
    const byMembership = new Map<string, string>([
      ...Object.entries(fx.inA).map(([name, id]) => [id, name] as const),
      [fx.carolInB, 'carol@B'],
      [fx.bobInB, 'bob@B'],
    ]);
    const rows = await prisma.notification.findMany({
      where: { type: type as never },
      select: { activityId: true, recipientMembershipId: true },
      // So entries are listed in the order they were recorded.
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const entries = new Map<string, string[]>();

    for (const { activityId, recipientMembershipId } of rows) {
      entries.set(activityId as string, [
        ...(entries.get(activityId as string) ?? []),
        byMembership.get(recipientMembershipId) ?? recipientMembershipId,
      ]);
    }

    return [...entries].map(([activityId, recipients]) => ({
      activityId,
      recipients: recipients.sort(),
    }));
  };

  const seed = async (): Promise<Fixture> => {
    const organization = async (name: string, slug: string) =>
      (
        await prisma.organization.create({
          data: { name, slug },
          select: { id: true },
        })
      ).id;
    const user = async (name: string) =>
      (
        await prisma.user.create({
          data: { email: `${name}@example.com`, name },
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
    const team = async (organizationId: string, name: string) =>
      (
        await prisma.team.create({
          data: { organizationId, name, slug: name.toLowerCase() },
          select: { id: true },
        })
      ).id;
    const service = async (
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
            slug: name.toLowerCase().replace(/ /g, '-'),
          },
          select: { id: true },
        })
      ).id;

    const orgA = await organization('Acme Operations', 'acme-operations');
    const orgB = await organization('Bravo Reliability', 'bravo-reliability');
    const users = {
      alice: await user('alice'),
      gus: await user('gus'),
      ben: await user('ben'),
      cara: await user('cara'),
      dan: await user('dan'),
      eve: await user('eve'),
      carol: await user('carol'),
      bob: await user('bob'),
    };
    const inA = {
      alice: await grant(orgA, users.alice, 'ADMIN'),
      gus: await grant(orgA, users.gus, 'ADMIN'),
      ben: await grant(orgA, users.ben, 'MEMBER'),
      cara: await grant(orgA, users.cara, 'MEMBER'),
      dan: await grant(orgA, users.dan, 'MEMBER'),
      eve: await grant(orgA, users.eve, 'MEMBER'),
      carol: await grant(orgA, users.carol, 'MEMBER'),
    };
    const carolInB = await grant(orgB, users.carol, 'MEMBER');
    const bobInB = await grant(orgB, users.bob, 'ADMIN');
    const payments = await team(orgA, 'Payments');
    const platform = await team(orgA, 'Platform');
    const ledgerTeamB = await team(orgB, 'Ledger');

    await prisma.teamMembership.createMany({
      data: [
        ...(['ben', 'cara', 'dan', 'carol'] as const).map((name) => ({
          organizationId: orgA,
          teamId: payments,
          membershipId: inA[name],
        })),
        ...(['ben', 'eve'] as const).map((name) => ({
          organizationId: orgA,
          teamId: platform,
          membershipId: inA[name],
        })),
        { organizationId: orgB, teamId: ledgerTeamB, membershipId: carolInB },
      ],
    });

    return {
      orgA,
      orgB,
      users,
      inA,
      carolInB,
      bobInB,
      payments,
      platform,
      paymentApi: await service(orgA, payments, 'Payment API'),
      ledgerB: await service(orgB, ledgerTeamB, 'Ledger'),
    };
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('should tell the responsible team of a declaration, never the declarer, and only in its own organization', async () => {
    // Alice declares while on Payments herself.
    await prisma.teamMembership.create({
      data: {
        organizationId: fx.orgA,
        teamId: fx.payments,
        membershipId: fx.inA.alice,
      },
    });

    await declare();

    expect(await toldOf('INCIDENT_DECLARED')).toEqual([
      {
        activityId: expect.any(String),
        recipients: ['ben', 'cara', 'carol', 'dan'],
      },
    ]);
    // Carol's other membership is told nothing of A.
    expect(
      await prisma.notification.count({
        where: { recipientMembershipId: fx.carolInB },
      }),
    ).toBe(0);
  });

  describe('who may respond', () => {
    const choose = async (number: number, body: object) => {
      const response = await call(
        'put',
        `${fx.orgA}/incidents/${number}/response-access`,
        as('alice'),
        body,
      );

      expect(response.status).toBe(200);
    };
    const assign = (number: number, people: Person[]) =>
      choose(number, {
        mode: 'ASSIGNED',
        membershipIds: people.map((person) => fx.inA[person]),
      });

    it('should tell the responsible team once the Admin opens it to them', async () => {
      const number = await declare(fx.paymentApi, fx.orgA, 'PENDING');

      await choose(number, { mode: 'OPEN' });

      expect(await toldOf('INCIDENT_OPENED_TO_TEAM')).toEqual([
        {
          activityId: expect.any(String),
          recipients: ['ben', 'cara', 'carol', 'dan'],
        },
      ]);
      expect(await toldOf('INCIDENT_ASSIGNED')).toEqual([]);
    });

    it('should tell only the people just assigned, from any team, and nobody of a removal', async () => {
      const number = await declare(fx.paymentApi, fx.orgA, 'PENDING');

      // Eve is on Platform, not the responsible team.
      await assign(number, ['cara', 'eve']);
      await assign(number, ['cara', 'eve', 'ben']);
      await assign(number, ['ben']);

      expect(await toldOf('INCIDENT_ASSIGNED')).toEqual([
        { activityId: expect.any(String), recipients: ['cara', 'eve'] },
        { activityId: expect.any(String), recipients: ['ben'] },
      ]);
      expect(await toldOf('INCIDENT_OPENED_TO_TEAM')).toEqual([]);

      // Opened to the team after all: the team is told, Eve is not.
      await choose(number, { mode: 'OPEN' });

      expect(await toldOf('INCIDENT_OPENED_TO_TEAM')).toEqual([
        {
          activityId: expect.any(String),
          recipients: ['ben', 'cara', 'carol', 'dan'],
        },
      ]);
    });

    it('should not tell anyone when an open incident is chosen open again', async () => {
      const number = await declare();

      await choose(number, { mode: 'OPEN' });

      expect(
        await prisma.notification.count({
          where: { type: 'INCIDENT_OPENED_TO_TEAM' },
        }),
      ).toBe(0);
    });
  });

  it('should take each notification’s time from its timeline entry', async () => {
    const number = await declare();

    await respond('ben', number);
    await change(number, { severity: 'SEV1', teamId: fx.platform });
    await respond('ben', number, '/complete');

    const rows = await prisma.notification.findMany({
      select: {
        createdAt: true,
        activity: { select: { createdAt: true } },
      },
    });

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.createdAt.toISOString()).toBe(
        row.activity?.createdAt.toISOString(),
      );
    }
  });

  it('should tell of a team and a severity changed together as two events, each to its own recipients', async () => {
    const number = await declare();

    await respond('ben', number);
    await respond('cara', number);
    await respond('cara', number, '/complete');

    // Payments → Platform, SEV2 → SEV1, in one request.
    await change(number, { severity: 'SEV1', teamId: fx.platform });

    // Platform (Ben, Eve) and Ben still investigating. Not Cara, who
    // completed; not Dan or Carol, who never responded; not Alice.
    expect(await toldOf('INCIDENT_REASSIGNED')).toEqual([
      { activityId: expect.any(String), recipients: ['ben', 'eve'] },
    ]);
    expect(await toldOf('INCIDENT_SEVERITY_CHANGED')).toEqual([
      { activityId: expect.any(String), recipients: ['ben', 'eve'] },
    ]);

    // Ben is told of each once: two events, two notifications.
    const bens = await prisma.notification.findMany({
      where: {
        recipientMembershipId: fx.inA.ben,
        type: { in: ['INCIDENT_REASSIGNED', 'INCIDENT_SEVERITY_CHANGED'] },
      },
      select: { type: true, activityId: true },
    });

    expect(bens).toHaveLength(2);
    expect(new Set(bens.map(({ activityId }) => activityId)).size).toBe(2);
  });

  it('should tell the Admins, not the last responder, that an incident is ready to resolve', async () => {
    const number = await declare();

    await respond('ben', number);
    await respond('cara', number);
    await respond('cara', number, '/complete');

    // Ben is still investigating: nothing yet.
    expect(await toldOf('INCIDENT_READY_TO_RESOLVE')).toEqual([]);

    await respond('ben', number, '/complete');

    expect(await toldOf('INCIDENT_READY_TO_RESOLVE')).toEqual([
      { activityId: expect.any(String), recipients: ['alice', 'gus'] },
    ]);

    // Completing again records nothing and tells nobody again.
    await respond('ben', number, '/complete');

    expect(
      await prisma.notification.count({
        where: { type: 'INCIDENT_READY_TO_RESOLVE' },
      }),
    ).toBe(2);
  });

  it('should make one "ready to resolve" of two responses completing at once', async () => {
    const number = await declare();

    await respond('ben', number);
    await respond('cara', number);

    await Promise.all([
      respond('ben', number, '/complete'),
      respond('cara', number, '/complete'),
    ]);

    expect(await toldOf('INCIDENT_READY_TO_RESOLVE')).toEqual([
      { activityId: expect.any(String), recipients: ['alice', 'gus'] },
    ]);
  });

  it('should evaluate every entry of a request that changes severity, team, and resolves', async () => {
    const number = await declare();

    await respond('ben', number);
    await respond('ben', number, '/complete');
    await change(number, { teamId: fx.platform });
    await prisma.$executeRaw`
      UPDATE incidents SET response_access = 'OPEN'
      WHERE organization_id = ${fx.orgA}::uuid AND number = ${number}`;
    await respond('eve', number);
    await respond('eve', number, '/complete');

    const before = await prisma.notification.count();

    // Platform → Payments, SEV2 → SEV1, and resolved, in one request.
    await change(number, {
      severity: 'SEV1',
      teamId: fx.payments,
      status: 'RESOLVED',
      resolution: 'Rolled back the release.',
    });

    const [severity] = await toldOf('INCIDENT_SEVERITY_CHANGED');
    const reassigned = await toldOf('INCIDENT_REASSIGNED');
    const [resolved] = await toldOf('INCIDENT_RESOLVED');

    // Nobody is still investigating once it resolves, so the severity and
    // the team reach the responsible team — Payments again — alone.
    expect(severity.recipients).toEqual(['ben', 'cara', 'carol', 'dan']);
    expect(reassigned.at(-1)?.recipients).toEqual([
      'ben',
      'cara',
      'carol',
      'dan',
    ]);
    // The resolution reaches Payments and everyone who responded: Eve, of
    // Platform, too.
    expect(resolved.recipients).toEqual(['ben', 'cara', 'carol', 'dan', 'eve']);
    // Three entries, three distinct events, 4 + 4 + 5 notifications.
    expect(
      new Set([
        severity.activityId,
        reassigned.at(-1)?.activityId,
        resolved.activityId,
      ]).size,
    ).toBe(3);
    expect((await prisma.notification.count()) - before).toBe(13);
  });

  it('should tell nobody of a change that records nothing', async () => {
    const number = await declare();
    const before = await prisma.notification.count();

    await change(number, { severity: 'SEV2', teamId: fx.payments });
    await change(number, { title: 'Card payments failing at checkout' });
    await respond('ben', number);
    await respond('ben', number);

    expect(await prisma.notification.count()).toBe(before);
  });

  it('should tell no departed member, and still tell one yet to change a one-time password', async () => {
    await prisma.user.update({
      where: { id: as('dan') },
      data: { deletedAt: new Date() },
    });
    await prisma.user.update({
      where: { id: as('cara') },
      data: { passwordChangeRequired: true },
    });

    await declare();

    expect((await toldOf('INCIDENT_DECLARED'))[0].recipients).toEqual([
      'ben',
      'cara',
      'carol',
    ]);
  });

  it('should roll the whole change back when its notifications cannot be written', async () => {
    const number = await declare();
    const writer = app.get(NotificationsWriter);
    const before = {
      notifications: await prisma.notification.count(),
      entries: await prisma.incidentActivity.count(),
    };

    vi.spyOn(writer, 'incidentActivities').mockRejectedValueOnce(
      new Error('notifications unavailable'),
    );

    await change(number, { severity: 'SEV1' }, 500);

    const incident = await prisma.incident.findFirstOrThrow({
      where: { organizationId: fx.orgA, number },
      select: { severity: true },
    });

    expect(incident.severity).toBe('SEV2');
    expect(await prisma.incidentActivity.count()).toBe(before.entries);
    expect(await prisma.notification.count()).toBe(before.notifications);
  });

  it("should keep each organization's notifications within it", async () => {
    await declare();
    await declare(fx.ledgerB, fx.orgB);

    const inB = await prisma.notification.findMany({
      where: { organizationId: fx.orgB },
      select: { recipientMembershipId: true },
    });

    // Ledger is Carol's team in B; Bob declared.
    expect(inB).toEqual([{ recipientMembershipId: fx.carolInB }]);
    expect(
      await prisma.notification.count({
        where: { organizationId: fx.orgA, recipientMembershipId: fx.carolInB },
      }),
    ).toBe(0);
  });

  it("should leave a member's attention as it is when they read the notification", async () => {
    const number = await declare();
    const [notification] = (
      await call('get', `${fx.orgA}/notifications`, as('dan'))
    ).body.items;

    await call(
      'post',
      `${fx.orgA}/notifications/${notification.id}/read`,
      as('dan'),
    );

    const attention = await call(
      'get',
      `${fx.orgA}/incidents/attention`,
      as('dan'),
    );

    expect(
      attention.body.respond.needsYourTeam.map(
        (incident: { number: number }) => incident.number,
      ),
    ).toEqual([number]);
  });
});
