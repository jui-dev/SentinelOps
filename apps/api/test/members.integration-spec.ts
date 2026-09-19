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
 * Two tenants. Alice is ADMIN of A, Dave a MEMBER of A, Bob ADMIN of B.
 *
 * What is proven here: that the account and membership are written together
 * and flagged for a password change; that the stored hash verifies the
 * one-time password and nothing stores it in the clear; that the new person
 * can sign in with it; that only an admin of the organization may do this;
 * that an address with an account anywhere is refused; and that a member's
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
      role: 'ADMIN' | 'MEMBER',
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
      dave: await member(orgA, 'dave@acme.example', 'MEMBER'),
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
      role: 'MEMBER',
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
        role: 'MEMBER',
      }),
    ]);
    expect(user.passwordHash).not.toContain(ONE_TIME_PASSWORD);
    expect(
      await passwords.verify(user.passwordHash as string, ONE_TIME_PASSWORD),
    ).toBe(true);
  });

  it.each(['ADMIN', 'MEMBER', 'OWNER'])(
    'should refuse a body naming a role (%s) with 400: everyone added is a MEMBER',
    async (role) => {
      const response = await addMember(fx.orgA, fx.alice, { ...grace, role });

      expect(response.status).toBe(400);
      expect(await prisma.user.count()).toBe(3);
      expect(
        await prisma.membership.count({
          where: { organizationId: fx.orgA, role: 'ADMIN' },
        }),
      ).toBe(1);
    },
  );

  it('should list the new member, still awaiting their first sign-in', async () => {
    await addMember(fx.orgA, fx.alice, grace);

    const list = await request(app.getHttpServer())
      .get(`/api/v1/organizations/${fx.orgA}/memberships`)
      .set('Authorization', `Bearer ${await tokens.signAccessToken(fx.dave)}`)
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
          data: { organizationId: fx.orgB, userId: fx.dave, role: 'MEMBER' },
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
});
