import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from './../src/app.module.js';
import { TokenService } from './../src/auth/token.service.js';
import { PrismaService } from './../src/database/prisma.service.js';
import { NotificationsWriter } from './../src/notifications/notifications.writer.js';
import { resolveTestDatabaseUrl, truncate } from './test-database.js';

/**
 * The notifications a team placement writes, against a real database and
 * through the real routes.
 *
 * Organization A. Alice is the Admin who places people. Payments is Ben;
 * Fatima is a member on no team; Guild is an empty team nothing else
 * references, so it can be deleted. Payment API is Payments'. Carol is a
 * member of A and of B.
 *
 * What is proven here: that only the member placed or removed is told —
 * never their teammates or the Admins, and never someone who placed
 * themselves; that the notification is theirs through their organization
 * membership, so a removed member still reads it; that repeats notify once
 * and add, remove, add three times; that a failed notification rolls the
 * placement back; that deleting the team takes its notifications and
 * nothing else; and that a removal racing the team's deletion ends cleanly.
 */

describe('team notifications (integration)', () => {
  const prisma = new PrismaService({ url: resolveTestDatabaseUrl() });
  let app: INestApplication;
  let tokens: TokenService;
  let fx: {
    orgA: string;
    orgB: string;
    alice: string;
    ben: string;
    fatima: string;
    carol: string;
    aliceInA: string;
    benInA: string;
    fatimaInA: string;
    carolInA: string;
    carolInB: string;
    payments: string;
    guild: string;
    paymentApi: string;
  };

  const call = async (
    method: 'get' | 'post' | 'patch' | 'delete',
    path: string,
    userId: string,
    body?: object,
  ): Promise<request.Response> => {
    const pending = request(app.getHttpServer())
      [method](`/api/v1/organizations/${path}`)
      .set('Authorization', `Bearer ${await tokens.signAccessToken(userId)}`);

    return body === undefined ? pending : pending.send(body);
  };

  const place = (teamId: string, membershipId: string, by = fx.alice) =>
    call('post', `${fx.orgA}/teams/${teamId}/members`, by, { membershipId });

  const unplace = (teamId: string, membershipId: string, by = fx.alice) =>
    call('delete', `${fx.orgA}/teams/${teamId}/members/${membershipId}`, by);

  const teamNotifications = () =>
    prisma.notification.findMany({
      where: {
        type: { in: ['TEAM_MEMBERSHIP_ADDED', 'TEAM_MEMBERSHIP_REMOVED'] },
      },
      select: {
        type: true,
        recipientMembershipId: true,
        teamId: true,
        actorId: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

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
    await truncate(
      prisma,
      'TRUNCATE TABLE incidents, services, team_memberships, teams, invitations, refresh_tokens, memberships, users, organizations RESTART IDENTITY CASCADE',
    );

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
      role: 'ADMIN' | 'RESPONDER' = 'RESPONDER',
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

    const orgA = await organization('Acme Operations', 'acme-operations');
    const orgB = await organization('Bravo Reliability', 'bravo-reliability');
    const alice = await user('alice');
    const ben = await user('ben');
    const fatima = await user('fatima');
    const carol = await user('carol');
    const aliceInA = await grant(orgA, alice, 'ADMIN');
    const benInA = await grant(orgA, ben);
    const fatimaInA = await grant(orgA, fatima);
    const carolInA = await grant(orgA, carol);
    const carolInB = await grant(orgB, carol);
    const payments = await team(orgA, 'Payments');
    const guild = await team(orgA, 'Guild');

    await prisma.teamMembership.create({
      data: { organizationId: orgA, teamId: payments, membershipId: benInA },
    });

    const paymentApi = (
      await prisma.service.create({
        data: {
          organizationId: orgA,
          ownerTeamId: payments,
          name: 'Payment API',
          slug: 'payment-api',
        },
        select: { id: true },
      })
    ).id;

    fx = {
      orgA,
      orgB,
      alice,
      ben,
      fatima,
      carol,
      aliceInA,
      benInA,
      fatimaInA,
      carolInA,
      carolInB,
      payments,
      guild,
      paymentApi,
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('should tell only the member placed, at the placement’s time, and not their new teammates or the Admin', async () => {
    const response = await place(fx.payments, fx.fatimaInA);

    expect(response.status).toBe(201);

    const placement = await prisma.teamMembership.findFirstOrThrow({
      where: { teamId: fx.payments, membershipId: fx.fatimaInA },
      select: { createdAt: true },
    });

    expect(await teamNotifications()).toEqual([
      {
        type: 'TEAM_MEMBERSHIP_ADDED',
        recipientMembershipId: fx.fatimaInA,
        teamId: fx.payments,
        actorId: fx.alice,
        createdAt: placement.createdAt,
      },
    ]);
  });

  it('should tell only the member removed, who still reads it once off the team', async () => {
    await place(fx.payments, fx.fatimaInA);

    expect((await unplace(fx.payments, fx.fatimaInA)).status).toBe(204);

    const removed = (await teamNotifications()).filter(
      ({ type }) => type === 'TEAM_MEMBERSHIP_REMOVED',
    );

    expect(removed).toEqual([
      expect.objectContaining({
        recipientMembershipId: fx.fatimaInA,
        teamId: fx.payments,
        actorId: fx.alice,
      }),
    ]);

    // Theirs through their organization membership, not the team: off
    // Payments now, Fatima reads it through the API, with the team's name as
    // it stands — including after a rename.
    await call('patch', `${fx.orgA}/teams/${fx.payments}`, fx.alice, {
      name: 'Payments Core',
    });

    const inbox = await call('get', `${fx.orgA}/notifications`, fx.fatima);

    expect(inbox.status).toBe(200);
    expect(inbox.body.items).toEqual([
      expect.objectContaining({
        type: 'TEAM_MEMBERSHIP_REMOVED',
        actor: { id: fx.alice, name: 'alice' },
        incident: null,
        change: null,
        team: { id: fx.payments, name: 'Payments Core' },
      }),
      expect.objectContaining({
        type: 'TEAM_MEMBERSHIP_ADDED',
        team: { id: fx.payments, name: 'Payments Core' },
      }),
    ]);

    // Ben, still on Payments, was told nothing of either.
    const bens = await call('get', `${fx.orgA}/notifications`, fx.ben);

    expect(bens.body.items).toEqual([]);
  });

  it('should tell nobody when the Admin places or removes themselves', async () => {
    expect((await place(fx.payments, fx.aliceInA)).status).toBe(201);
    expect((await unplace(fx.payments, fx.aliceInA)).status).toBe(204);

    expect(await teamNotifications()).toEqual([]);
  });

  it('should tell once of a repeated placement or removal, and three times of add, remove, add', async () => {
    expect((await place(fx.payments, fx.fatimaInA)).status).toBe(201);
    expect((await place(fx.payments, fx.fatimaInA)).status).toBe(409);
    expect((await unplace(fx.payments, fx.fatimaInA)).status).toBe(204);
    expect((await unplace(fx.payments, fx.fatimaInA)).status).toBe(404);
    expect((await place(fx.payments, fx.fatimaInA)).status).toBe(201);

    expect((await teamNotifications()).map(({ type }) => type)).toEqual([
      'TEAM_MEMBERSHIP_ADDED',
      'TEAM_MEMBERSHIP_REMOVED',
      'TEAM_MEMBERSHIP_ADDED',
    ]);
  });

  it('should roll a placement back when its notification cannot be written', async () => {
    const writer = app.get(NotificationsWriter);

    vi.spyOn(writer, 'teamMembership').mockRejectedValueOnce(
      new Error('notifications unavailable'),
    );

    expect((await place(fx.payments, fx.fatimaInA)).status).toBe(500);
    expect(
      await prisma.teamMembership.count({
        where: { membershipId: fx.fatimaInA },
      }),
    ).toBe(0);
    expect(await teamNotifications()).toEqual([]);
  });

  it('should roll a removal back when its notification cannot be written', async () => {
    await place(fx.payments, fx.fatimaInA);

    const writer = app.get(NotificationsWriter);

    vi.spyOn(writer, 'teamMembership').mockRejectedValueOnce(
      new Error('notifications unavailable'),
    );

    expect((await unplace(fx.payments, fx.fatimaInA)).status).toBe(500);
    expect(
      await prisma.teamMembership.count({
        where: { teamId: fx.payments, membershipId: fx.fatimaInA },
      }),
    ).toBe(1);
    expect((await teamNotifications()).map(({ type }) => type)).toEqual([
      'TEAM_MEMBERSHIP_ADDED',
    ]);
  });

  it('should tell nobody of the teams a new member is added with', async () => {
    const response = await call('post', `${fx.orgA}/memberships`, fx.alice, {
      name: 'Gina',
      email: 'gina@example.com',
      temporaryPassword: 'a-temporary-password-1',
      teamIds: [fx.payments, fx.guild],
    });

    expect(response.status).toBe(201);
    expect(await prisma.notification.count()).toBe(0);
  });

  it("should take a deleted team's notifications with it, and nothing else", async () => {
    // Ben is told of a declaration on Payments' service.
    await call('post', `${fx.orgA}/incidents`, fx.alice, {
      title: 'Card payments failing',
      serviceId: fx.paymentApi,
      severity: 'SEV2',
    });
    await place(fx.guild, fx.fatimaInA);
    await unplace(fx.guild, fx.fatimaInA);
    await place(fx.guild, fx.benInA);

    expect(
      (await call('delete', `${fx.orgA}/teams/${fx.guild}`, fx.alice)).status,
    ).toBe(204);

    expect(await teamNotifications()).toEqual([]);
    expect(
      await prisma.notification.findMany({
        select: { type: true, recipientMembershipId: true },
      }),
    ).toEqual([
      { type: 'INCIDENT_DECLARED', recipientMembershipId: fx.benInA },
    ]);
  });

  it('should tell a member of two organizations only in the one whose team changed', async () => {
    await place(fx.payments, fx.carolInA);

    expect(await teamNotifications()).toEqual([
      expect.objectContaining({ recipientMembershipId: fx.carolInA }),
    ]);
    expect(
      (await call('get', `${fx.orgB}/notifications`, fx.carol)).body.items,
    ).toEqual([]);
  });

  it('should end a removal racing the team’s deletion cleanly, leaving nothing behind', async () => {
    for (let round = 0; round < 5; round += 1) {
      const team = (
        await prisma.team.create({
          data: {
            organizationId: fx.orgA,
            name: `Race ${round}`,
            slug: `race-${round}`,
          },
          select: { id: true },
        })
      ).id;

      await place(team, fx.fatimaInA);

      const [removal, deletion] = await Promise.all([
        unplace(team, fx.fatimaInA),
        call('delete', `${fx.orgA}/teams/${team}`, fx.alice),
      ]);

      // Whichever goes first, the other waits for it: never a deadlock, and
      // never a 500.
      expect([204, 404]).toContain(removal.status);
      expect(deletion.status).toBe(204);
      expect(await prisma.team.count({ where: { id: team } })).toBe(0);
      expect(await prisma.notification.count({ where: { teamId: team } })).toBe(
        0,
      );
    }
  });
});
