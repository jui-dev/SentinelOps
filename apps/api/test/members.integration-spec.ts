import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from './../src/app.module.js';
import { PasswordService } from './../src/auth/password.service.js';
import { TokenService } from './../src/auth/token.service.js';
import { PrismaService } from './../src/database/prisma.service.js';
import { leakedKeys } from './leaks.js';
import { resolveTestDatabaseUrl } from './test-database.js';

/**
 * Adding a member with a one-time password, against a real database.
 *
 * Two tenants. Alice is ADMIN of A, Dave a RESPONDER of A, Bob ADMIN of B.
 *
 * What is proven here: that the account and membership are written together
 * and flagged for a password change; that the stored hash verifies the
 * one-time password and nothing stores it in the clear; that the new person
 * can sign in with it; that only an admin of the organization may do this;
 * that an address with an account anywhere is refused; that a role is
 * given and changed only by an admin, and the last Admin keeps theirs; and that a member's
 * record lists every team they are on — by name, empty when none, and only
 * from the organization being read.
 */

const ONE_TIME_PASSWORD = 'one-time-password-123';

describe('members (integration)', () => {
  const prisma = new PrismaService({ url: resolveTestDatabaseUrl() });
  let app: INestApplication;
  let tokens: TokenService;
  let passwords: PasswordService;
  let fx: {
    orgA: string;
    orgB: string;
    alice: string;
    dave: string;
    bob: string;
  };

  const addMember = async (
    organizationId: string,
    callerId: string,
    body: object,
  ): Promise<request.Response> => {
    const response = await request(app.getHttpServer())
      .post(`/api/v1/organizations/${organizationId}/memberships`)
      .set('Authorization', `Bearer ${await tokens.signAccessToken(callerId)}`)
      .send(body);

    expect(leakedKeys(response.body)).toEqual([]);

    return response;
  };

  const grace = {
    name: 'Grace Hopper',
    email: 'Grace@Acme.Example ',
    temporaryPassword: ONE_TIME_PASSWORD,
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
    passwords = app.get(PasswordService);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE incidents, services, team_memberships, teams, invitations, refresh_tokens, memberships, users, organizations RESTART IDENTITY CASCADE',
    );

    const organization = async (slug: string) =>
      (
        await prisma.organization.create({
          data: { name: slug, slug },
          select: { id: true },
        })
      ).id;
    const member = async (
      organizationId: string,
      email: string,
      role: 'ADMIN' | 'RESPONDER',
    ) => {
      const user = await prisma.user.create({
        data: { email, name: email },
        select: { id: true },
      });
      await prisma.membership.create({
        data: { organizationId, userId: user.id, role },
      });

      return user.id;
    };

    const orgA = await organization('acme');
    const orgB = await organization('bravo');

    fx = {
      orgA,
      orgB,
      alice: await member(orgA, 'alice@acme.example', 'ADMIN'),
      dave: await member(orgA, 'dave@acme.example', 'RESPONDER'),
      bob: await member(orgB, 'bob@bravo.example', 'ADMIN'),
    };
  });

  afterAll(async () => {
    await app.close();
  });

  it('should create the account and membership, flagged for a password change', async () => {
    const response = await addMember(fx.orgA, fx.alice, grace);

    expect(response.status).toBe(201);
    expect(response.body).toEqual({
      id: expect.any(String),
      role: 'RESPONDER',
      createdAt: expect.any(String),
      user: {
        id: expect.any(String),
        name: 'Grace Hopper',
        email: 'grace@acme.example',
        passwordChangeRequired: true,
      },
      teams: [],
    });

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: 'grace@acme.example' },
      include: { memberships: true },
    });

    expect(user.passwordChangeRequired).toBe(true);
    expect(user.memberships).toEqual([
      expect.objectContaining({
        id: response.body.id,
        organizationId: fx.orgA,
        role: 'RESPONDER',
      }),
    ]);
    expect(user.passwordHash).not.toContain(ONE_TIME_PASSWORD);
    expect(
      await passwords.verify(user.passwordHash as string, ONE_TIME_PASSWORD),
    ).toBe(true);
  });

  it.each(['ADMIN', 'INCIDENT_MANAGER', 'REPORTER', 'RESPONDER'] as const)(
    'should add a person in the role the body names (%s)',
    async (role) => {
      const response = await addMember(fx.orgA, fx.alice, { ...grace, role });

      expect(response.status).toBe(201);
      expect(response.body.role).toBe(role);
      expect(
        await prisma.membership.findUniqueOrThrow({
          where: { id: response.body.id },
          select: { role: true },
        }),
      ).toEqual({ role });
    },
  );

  it.each(['OWNER', 'MEMBER', 'admin', ''])(
    'should refuse a role that does not exist (%j) with 400 and add nobody',
    async (role) => {
      const response = await addMember(fx.orgA, fx.alice, { ...grace, role });

      expect(response.status).toBe(400);
      expect(await prisma.user.count()).toBe(3);
    },
  );

  describe('changing a role', () => {
    const changeRole = async (
      callerId: string,
      membershipId: string,
      body: object,
      organizationId = fx.orgA,
    ): Promise<request.Response> => {
      const response = await request(app.getHttpServer())
        .put(
          `/api/v1/organizations/${organizationId}/memberships/${membershipId}/role`,
        )
        .set(
          'Authorization',
          `Bearer ${await tokens.signAccessToken(callerId)}`,
        )
        .send(body);

      expect(leakedKeys(response.body)).toEqual([]);

      return response;
    };

    const membershipOf = async (userId: string, organizationId = fx.orgA) =>
      prisma.membership.findFirstOrThrow({
        where: { userId, organizationId },
        select: { id: true, role: true },
      });

    it('should give a member the new role, answering with the member', async () => {
      const dave = await membershipOf(fx.dave);

      const response = await changeRole(fx.alice, dave.id, {
        role: 'INCIDENT_MANAGER',
      });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(
        expect.objectContaining({ id: dave.id, role: 'INCIDENT_MANAGER' }),
      );
      expect((await membershipOf(fx.dave)).role).toBe('INCIDENT_MANAGER');
    });

    it('should change nothing when the role is the one they hold', async () => {
      const dave = await membershipOf(fx.dave);

      const response = await changeRole(fx.alice, dave.id, {
        role: 'RESPONDER',
      });

      expect(response.status).toBe(200);
      expect(response.body.role).toBe('RESPONDER');
    });

    it('should keep the only Admin an Admin with 409 LAST_ADMIN', async () => {
      const alice = await membershipOf(fx.alice);

      const response = await changeRole(fx.alice, alice.id, {
        role: 'RESPONDER',
      });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('LAST_ADMIN');
      expect((await membershipOf(fx.alice)).role).toBe('ADMIN');
    });

    it('should let an Admin step down once there is another', async () => {
      const dave = await membershipOf(fx.dave);
      const alice = await membershipOf(fx.alice);

      await changeRole(fx.alice, dave.id, { role: 'ADMIN' }).then((r) =>
        expect(r.status).toBe(200),
      );

      const response = await changeRole(fx.alice, alice.id, {
        role: 'REPORTER',
      });

      expect(response.status).toBe(200);
      expect((await membershipOf(fx.alice)).role).toBe('REPORTER');
    });

    it('should leave one Admin when the last two are demoted at once', async () => {
      const dave = await membershipOf(fx.dave);
      const alice = await membershipOf(fx.alice);
      await prisma.membership.update({
        where: { id: dave.id },
        data: { role: 'ADMIN' },
      });

      const results = await Promise.all([
        changeRole(fx.alice, alice.id, { role: 'RESPONDER' }),
        changeRole(fx.dave, dave.id, { role: 'RESPONDER' }),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(
        await prisma.membership.count({
          where: { organizationId: fx.orgA, role: 'ADMIN' },
        }),
      ).toBe(1);
    });

    it('should refuse anyone who does not manage members with 403', async () => {
      const alice = await membershipOf(fx.alice);

      const response = await changeRole(fx.dave, alice.id, {
        role: 'RESPONDER',
      });

      expect(response.status).toBe(403);
      expect((await membershipOf(fx.alice)).role).toBe('ADMIN');
    });

    it('should answer a member of another organization as not found', async () => {
      const bob = await membershipOf(fx.bob, fx.orgB);

      const response = await changeRole(fx.alice, bob.id, {
        role: 'RESPONDER',
      });

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('MEMBERSHIP_NOT_FOUND');
      expect((await membershipOf(fx.bob, fx.orgB)).role).toBe('ADMIN');
    });

    it.each(['OWNER', 'MEMBER', ''])(
      'should refuse a role that does not exist (%j) with 400',
      async (role) => {
        const dave = await membershipOf(fx.dave);

        const response = await changeRole(fx.alice, dave.id, { role });

        expect(response.status).toBe(400);
      },
    );
  });

  it('should list the new member, still awaiting their first sign-in', async () => {
    await addMember(fx.orgA, fx.alice, grace);

    // Read as the admin: account setup is theirs to follow.
    const list = await request(app.getHttpServer())
      .get(`/api/v1/organizations/${fx.orgA}/memberships`)
      .set('Authorization', `Bearer ${await tokens.signAccessToken(fx.alice)}`)
      .expect(200);

    expect(
      list.body.map(
        (membership: {
          user: { email: string; passwordChangeRequired: boolean };
        }) => [membership.user.email, membership.user.passwordChangeRequired],
      ),
    ).toEqual([
      ['alice@acme.example', false],
      ['dave@acme.example', false],
      ['grace@acme.example', true],
    ]);
  });

  it('should let the new member sign in with the one-time password', async () => {
    await addMember(fx.orgA, fx.alice, grace);

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'grace@acme.example', password: ONE_TIME_PASSWORD })
      .expect(200);

    expect(login.body.user).toMatchObject({
      email: 'grace@acme.example',
      name: 'Grace Hopper',
    });
  });

  it('should refuse a MEMBER with 403 and write nothing', async () => {
    const response = await addMember(fx.orgA, fx.dave, grace);

    expect(response.status).toBe(403);
    expect(response.body.code).toBe('PERMISSION_DENIED');
    expect(await prisma.user.count()).toBe(3);
  });

  it("should answer another organization's admin with the admission 404", async () => {
    const response = await addMember(fx.orgA, fx.bob, grace);

    expect(response.status).toBe(404);
    expect(response.body.code).toBe('ORGANIZATION_NOT_FOUND');
    expect(await prisma.user.count()).toBe(3);
  });

  it.each([
    ['in this organization', 'dave@acme.example'],
    ['in another organization', 'bob@bravo.example'],
  ])(
    'should refuse an email that already has an account %s with 409',
    async (_where, email) => {
      const response = await addMember(fx.orgA, fx.alice, { ...grace, email });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('EMAIL_ALREADY_REGISTERED');
      expect(await prisma.membership.count()).toBe(3);
    },
  );

  it.each([
    { temporaryPassword: 'too-short' },
    { email: 'not-an-email' },
    { name: '   ' },
  ])('should refuse the invalid field in %o with 400', async (override) => {
    const response = await addMember(fx.orgA, fx.alice, {
      ...grace,
      ...override,
    });

    expect(response.status).toBe(400);
    expect(await prisma.user.count()).toBe(3);
  });

  it.each([
    { organizationId: 'x' },
    { passwordChangeRequired: false },
    { passwordHash: 'x' },
    { userId: 'x' },
  ])('should refuse the extra key in %o with 400', async (extra) => {
    const response = await addMember(fx.orgA, fx.alice, {
      ...grace,
      ...extra,
    });

    expect(response.status).toBe(400);
    expect(await prisma.user.count()).toBe(3);
  });

  describe("a member's teams", () => {
    const aTeam = (organizationId: string, name: string) =>
      prisma.team.create({
        data: { organizationId, name, slug: name.toLowerCase() },
        select: { id: true, name: true, slug: true },
      });
    const membershipOf = async (organizationId: string, userId: string) =>
      (
        await prisma.membership.findUniqueOrThrow({
          where: { organizationId_userId: { organizationId, userId } },
          select: { id: true },
        })
      ).id;
    const place = (
      organizationId: string,
      teamId: string,
      membershipId: string,
    ) =>
      prisma.teamMembership.create({
        data: { organizationId, teamId, membershipId },
      });
    const read = async (path: string, callerId: string) =>
      request(app.getHttpServer())
        .get(`/api/v1/organizations/${path}`)
        .set(
          'Authorization',
          `Bearer ${await tokens.signAccessToken(callerId)}`,
        )
        .expect(200);

    it('should list every team a member is on, by name, and an empty list for one on none', async () => {
      const platform = await aTeam(fx.orgA, 'Platform');
      const payments = await aTeam(fx.orgA, 'Payments');
      const daveInA = await membershipOf(fx.orgA, fx.dave);
      // Placed in the opposite order to the one expected back.
      await place(fx.orgA, platform.id, daveInA);
      await place(fx.orgA, payments.id, daveInA);

      const list = await read(`${fx.orgA}/memberships`, fx.dave);

      expect(leakedKeys(list.body)).toEqual([]);
      expect(
        list.body.map((m: { user: { email: string }; teams: unknown }) => [
          m.user.email,
          m.teams,
        ]),
      ).toEqual([
        ['alice@acme.example', []],
        ['dave@acme.example', [payments, platform]],
      ]);

      const one = await read(`${fx.orgA}/memberships/${daveInA}`, fx.alice);

      expect(one.body.teams).toEqual([payments, platform]);
    });

    it('should never show a team from another organization, even for someone in both', async () => {
      const platform = await aTeam(fx.orgA, 'Platform');
      const bravoOps = await aTeam(fx.orgB, 'Operations');
      const daveInA = await membershipOf(fx.orgA, fx.dave);
      const daveInB = (
        await prisma.membership.create({
          data: { organizationId: fx.orgB, userId: fx.dave, role: 'RESPONDER' },
          select: { id: true },
        })
      ).id;
      await place(fx.orgA, platform.id, daveInA);
      await place(fx.orgB, bravoOps.id, daveInB);

      const inA = await read(`${fx.orgA}/memberships/${daveInA}`, fx.dave);
      const inB = await read(`${fx.orgB}/memberships/${daveInB}`, fx.dave);

      expect(inA.body.teams).toEqual([platform]);
      expect(inB.body.teams).toEqual([bravoOps]);
      expect(JSON.stringify(inA.body)).not.toContain(bravoOps.id);
    });

    it('should drop a team from the list once the member is taken off it', async () => {
      const platform = await aTeam(fx.orgA, 'Platform');
      const daveInA = await membershipOf(fx.orgA, fx.dave);
      await place(fx.orgA, platform.id, daveInA);

      await request(app.getHttpServer())
        .delete(
          `/api/v1/organizations/${fx.orgA}/teams/${platform.id}/members/${daveInA}`,
        )
        .set(
          'Authorization',
          `Bearer ${await tokens.signAccessToken(fx.alice)}`,
        )
        .expect(204);

      const one = await read(`${fx.orgA}/memberships/${daveInA}`, fx.alice);

      expect(one.body.teams).toEqual([]);
    });
  });

  describe('who a member may see', () => {
    const person = async (name: string) => {
      const user = await prisma.user.create({
        data: { email: `${name.toLowerCase()}@acme.example`, name },
        select: { id: true },
      });
      const membership = await prisma.membership.create({
        data: { organizationId: fx.orgA, userId: user.id, role: 'RESPONDER' },
        select: { id: true },
      });

      return { userId: user.id, membershipId: membership.id };
    };
    const membershipOf = async (userId: string) =>
      (
        await prisma.membership.findUniqueOrThrow({
          where: { organizationId_userId: { organizationId: fx.orgA, userId } },
          select: { id: true },
        })
      ).id;
    const team = async (name: string, membershipIds: string[]) => {
      const created = await prisma.team.create({
        data: { organizationId: fx.orgA, name, slug: name.toLowerCase() },
        select: { id: true },
      });

      await prisma.teamMembership.createMany({
        data: membershipIds.map((membershipId) => ({
          organizationId: fx.orgA,
          teamId: created.id,
          membershipId,
        })),
      });
    };
    const get = async (path: string, callerId: string) =>
      request(app.getHttpServer())
        .get(`/api/v1/organizations/${fx.orgA}/${path}`)
        .set(
          'Authorization',
          `Bearer ${await tokens.signAccessToken(callerId)}`,
        );
    const emails = (body: { user: { email: string } }[]) =>
      body.map(({ user }) => user.email).sort();

    it('should show a member themselves, their teammates, and the admin, and no one else', async () => {
      const dave = await membershipOf(fx.dave);
      const erin = await person('Erin');
      const frank = await person('Frank');
      const gina = await person('Gina');
      // Dave and Erin share Platform; Frank is on Payments; Gina is on none.
      await team('Platform', [dave, erin.membershipId]);
      await team('Payments', [frank.membershipId]);

      const list = await get('memberships', fx.dave);

      expect(list.status).toBe(200);
      expect(emails(list.body)).toEqual([
        'alice@acme.example',
        'dave@acme.example',
        'erin@acme.example',
      ]);

      // A teammate opens; anyone else is not found, as if they were not there.
      expect(
        (await get(`memberships/${erin.membershipId}`, fx.dave)).status,
      ).toBe(200);
      expect(
        (await get(`memberships/${frank.membershipId}`, fx.dave)).status,
      ).toBe(404);
      expect(
        (await get(`memberships/${gina.membershipId}`, fx.dave)).status,
      ).toBe(404);

      // On no team, Gina sees herself and the admin.
      expect(emails((await get('memberships', gina.userId)).body)).toEqual([
        'alice@acme.example',
        'gina@acme.example',
      ]);

      // The admin sees everyone.
      expect(emails((await get('memberships', fx.alice)).body)).toEqual([
        'alice@acme.example',
        'dave@acme.example',
        'erin@acme.example',
        'frank@acme.example',
        'gina@acme.example',
      ]);
    });

    it('should tell only whoever sets accounts up how far each account is', async () => {
      const dave = await membershipOf(fx.dave);
      const erin = await person('Erin');
      await team('Platform', [dave, erin.membershipId]);

      const asMember = await get(`memberships/${erin.membershipId}`, fx.dave);
      const asAdmin = await get(`memberships/${erin.membershipId}`, fx.alice);

      expect(asMember.body.user).toEqual({
        id: erin.userId,
        name: 'Erin',
        email: 'erin@acme.example',
      });
      expect(asAdmin.body.user.passwordChangeRequired).toBe(false);
      expect(
        (await get('memberships', fx.dave)).body.every(
          ({ user }: { user: object }) => !('passwordChangeRequired' in user),
        ),
      ).toBe(true);
    });
  });

  describe('placing a new member on teams', () => {
    const aTeam = (organizationId: string, name: string) =>
      prisma.team.create({
        data: { organizationId, name, slug: name.toLowerCase() },
        select: { id: true, name: true, slug: true },
      });
    const counts = async () => ({
      users: await prisma.user.count(),
      memberships: await prisma.membership.count(),
      teamMemberships: await prisma.teamMembership.count(),
    });
    const before = { users: 3, memberships: 3, teamMemberships: 0 };

    it('should add a member on no team when the list is empty', async () => {
      await aTeam(fx.orgA, 'Payments');

      const response = await addMember(fx.orgA, fx.alice, {
        ...grace,
        teamIds: [],
      });

      expect(response.status).toBe(201);
      expect(response.body.teams).toEqual([]);
      expect(await prisma.teamMembership.count()).toBe(0);
    });

    it('should place the member on one team', async () => {
      const payments = await aTeam(fx.orgA, 'Payments');

      const response = await addMember(fx.orgA, fx.alice, {
        ...grace,
        teamIds: [payments.id],
      });

      expect(response.status).toBe(201);
      expect(response.body.teams).toEqual([payments]);
    });

    it('should place the member on several teams, answer them by name, and show them on each team', async () => {
      const platform = await aTeam(fx.orgA, 'Platform');
      const payments = await aTeam(fx.orgA, 'Payments');
      await aTeam(fx.orgA, 'Infrastructure');

      const response = await addMember(fx.orgA, fx.alice, {
        ...grace,
        teamIds: [platform.id, payments.id],
      });

      expect(response.status).toBe(201);
      expect(response.body.teams).toEqual([payments, platform]);

      const onPlatform = await request(app.getHttpServer())
        .get(`/api/v1/organizations/${fx.orgA}/teams/${platform.id}/members`)
        // The admin: a member reads only the teams they are on.
        .set(
          'Authorization',
          `Bearer ${await tokens.signAccessToken(fx.alice)}`,
        )
        .expect(200);

      expect(
        onPlatform.body.map((m: { membershipId: string }) => m.membershipId),
      ).toEqual([response.body.id]);
    });

    it('should place the member once on a team named twice', async () => {
      const payments = await aTeam(fx.orgA, 'Payments');

      const response = await addMember(fx.orgA, fx.alice, {
        ...grace,
        teamIds: [payments.id, payments.id, payments.id.toUpperCase()],
      });

      expect(response.status).toBe(201);
      expect(response.body.teams).toEqual([payments]);
      expect(await prisma.teamMembership.count()).toBe(1);
    });

    it.each([
      [
        'a team that does not exist',
        async () => '0199a1b2-c3d4-7000-8000-0000000000ff',
      ],
      [
        "another organization's team",
        async () => (await aTeam(fx.orgB, 'Operations')).id,
      ],
    ])(
      'should refuse %s with 404 TEAM_NOT_FOUND and create nothing at all',
      async (_what, teamIdOf) => {
        const payments = await aTeam(fx.orgA, 'Payments');
        const foreign = await teamIdOf();

        const response = await addMember(fx.orgA, fx.alice, {
          ...grace,
          // A valid team first, so a partial placement would be visible.
          teamIds: [payments.id, foreign],
        });

        expect(response.status).toBe(404);
        expect(response.body.code).toBe('TEAM_NOT_FOUND');
        // The account, the membership, and the valid placement all rolled
        // back together.
        expect(await counts()).toEqual(before);
        expect(
          await prisma.user.findUnique({
            where: { email: 'grace@acme.example' },
          }),
        ).toBeNull();
      },
    );

    it('should refuse a malformed team id with 400 before writing anything', async () => {
      const response = await addMember(fx.orgA, fx.alice, {
        ...grace,
        teamIds: ['not-a-uuid'],
      });

      expect(response.status).toBe(400);
      expect(await counts()).toEqual(before);
    });

    it('should still require the one-time password to be replaced before anything else', async () => {
      const payments = await aTeam(fx.orgA, 'Payments');
      await addMember(fx.orgA, fx.alice, { ...grace, teamIds: [payments.id] });

      const signedIn = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'grace@acme.example', password: ONE_TIME_PASSWORD })
        .expect(200);
      const bearer = `Bearer ${signedIn.body.accessToken}`;

      expect(signedIn.body.user.passwordChangeRequired).toBe(true);

      const refused = await request(app.getHttpServer())
        .get(`/api/v1/organizations/${fx.orgA}/teams/${payments.id}/members`)
        .set('Authorization', bearer)
        .expect(403);

      expect(refused.body.code).toBe('PASSWORD_CHANGE_REQUIRED');

      const changed = await request(app.getHttpServer())
        .post('/api/v1/auth/password')
        .set('Authorization', bearer)
        .send({
          currentPassword: ONE_TIME_PASSWORD,
          newPassword: 'graces-own-passphrase',
        })
        .expect(200);

      await request(app.getHttpServer())
        .get(`/api/v1/organizations/${fx.orgA}/teams/${payments.id}/members`)
        .set('Authorization', `Bearer ${changed.body.accessToken}`)
        .expect(200);
    });
  });
});
