import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from './../src/app.module.js';
import { TokenService } from './../src/auth/token.service.js';
import { PrismaService } from './../src/database/prisma.service.js';
import { leakedKeys } from './leaks.js';
import { resolveTestDatabaseUrl, truncate } from './test-database.js';

/**
 * Removing someone from the organization, and restoring them, against a real
 * database.
 *
 * Two tenants. In A: Alice the ADMIN, Dave and Erin RESPONDERS on Payments.
 * In B: Bob the ADMIN.
 *
 * What is proven here: that removal ends access on the next request and
 * hides the organization from them; that it takes them off their teams and
 * assignments but keeps their history; that only the Admin sees them
 * afterwards, and they are counted nowhere; that it is refused for oneself,
 * for someone removed already, and for someone with open work; that a
 * removed person cannot be given a role, a password, a team, or added again
 * by email; that restoring brings them back in the role named, on no team;
 * and that a response started while a removal commits never outlives it.
 */
describe('member removal (integration)', () => {
  const prisma = new PrismaService({ url: resolveTestDatabaseUrl() });
  let app: INestApplication;
  let tokens: TokenService;
  let fx: {
    orgA: string;
    orgB: string;
    alice: string;
    dave: string;
    erin: string;
    bob: string;
    aliceMembership: string;
    daveMembership: string;
    bobMembership: string;
    team: string;
    service: string;
  };

  const call = async (
    method: 'get' | 'post' | 'put' | 'delete',
    path: string,
    callerId: string,
    body?: object,
  ): Promise<request.Response> => {
    const pending = request(app.getHttpServer())
      [method](`/api/v1${path}`)
      .set('Authorization', `Bearer ${await tokens.signAccessToken(callerId)}`);
    const response = await (body ? pending.send(body) : pending);

    expect(leakedKeys(response.body)).toEqual([]);

    return response;
  };

  const remove = (membershipId: string, callerId = fx.alice) =>
    call(
      'delete',
      `/organizations/${fx.orgA}/memberships/${membershipId}`,
      callerId,
    );

  const restore = (membershipId: string, role: string, callerId = fx.alice) =>
    call(
      'post',
      `/organizations/${fx.orgA}/memberships/${membershipId}/restore`,
      callerId,
      { role },
    );

  let nextNumber = 1;

  const incident = async (
    status: 'INVESTIGATING' | 'RESOLVED' = 'INVESTIGATING',
  ) =>
    prisma.incident.create({
      data: {
        organizationId: fx.orgA,
        number: nextNumber++,
        title: `Incident ${nextNumber}`,
        serviceId: fx.service,
        teamId: fx.team,
        severity: 'SEV2',
        status,
        createdById: fx.alice,
        ...(status === 'RESOLVED' && {
          resolvedAt: new Date(),
          resolution: 'Fixed.',
        }),
      },
      select: { id: true, number: true },
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
    // Every other table refers to one of these two, and goes with them.
    await truncate(
      prisma,
      'TRUNCATE TABLE organizations, users RESTART IDENTITY CASCADE',
    );
    nextNumber = 1;

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
        data: { email, name: email.split('@')[0] },
        select: { id: true },
      });
      const membership = await prisma.membership.create({
        data: { organizationId, userId: user.id, role },
        select: { id: true },
      });

      return { user: user.id, membership: membership.id };
    };

    const orgA = await organization('acme');
    const orgB = await organization('bravo');
    const alice = await member(orgA, 'alice@acme.example', 'ADMIN');
    const dave = await member(orgA, 'dave@acme.example', 'RESPONDER');
    const erin = await member(orgA, 'erin@acme.example', 'RESPONDER');
    const bob = await member(orgB, 'bob@bravo.example', 'ADMIN');

    const team = await prisma.team.create({
      data: { organizationId: orgA, name: 'Payments', slug: 'payments' },
      select: { id: true },
    });

    await prisma.teamMembership.createMany({
      data: [dave, erin].map(({ membership }) => ({
        organizationId: orgA,
        teamId: team.id,
        membershipId: membership,
      })),
    });

    const service = await prisma.service.create({
      data: {
        organizationId: orgA,
        name: 'Checkout',
        slug: 'checkout',
        ownerTeamId: team.id,
      },
      select: { id: true },
    });

    fx = {
      orgA,
      orgB,
      alice: alice.user,
      dave: dave.user,
      erin: erin.user,
      bob: bob.user,
      aliceMembership: alice.membership,
      daveMembership: dave.membership,
      bobMembership: bob.membership,
      team: team.id,
      service: service.id,
    };
  });

  afterAll(async () => {
    await app.close();
  });

  describe('removing someone', () => {
    it('should end their access at once, and take the organization off their account', async () => {
      expect(
        (await call('get', `/organizations/${fx.orgA}`, fx.dave)).status,
      ).toBe(200);

      const response = await remove(fx.daveMembership);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: fx.daveMembership,
        role: 'RESPONDER',
        teams: [],
        removal: {
          removedAt: expect.any(String),
          removedBy: { id: fx.alice, name: 'alice' },
        },
        openWork: [],
      });

      // The admission 404, as for someone who never belonged.
      const after = await call('get', `/organizations/${fx.orgA}`, fx.dave);

      expect(after.status).toBe(404);

      const me = await call('get', '/auth/me', fx.dave);

      expect(me.status).toBe(200);
      expect(me.body.memberships).toEqual([]);
    });

    it('should take them off their teams and assignments, and keep what they did', async () => {
      const done = await incident('RESOLVED');
      const waiting = await incident();

      await prisma.incidentResponder.create({
        data: {
          organizationId: fx.orgA,
          incidentId: done.id,
          membershipId: fx.daveMembership,
          status: 'COMPLETED',
          completedAt: new Date(),
        },
      });
      await prisma.incidentAssignee.create({
        data: {
          organizationId: fx.orgA,
          incidentId: waiting.id,
          membershipId: fx.daveMembership,
        },
      });

      expect((await remove(fx.daveMembership)).status).toBe(200);

      expect(
        await prisma.teamMembership.count({
          where: { membershipId: fx.daveMembership },
        }),
      ).toBe(0);
      expect(
        await prisma.incidentAssignee.count({
          where: { membershipId: fx.daveMembership },
        }),
      ).toBe(0);
      expect(
        await prisma.incidentResponder.count({
          where: { membershipId: fx.daveMembership },
        }),
      ).toBe(1);

      const entry = await prisma.activityEntry.findFirstOrThrow({
        where: { organizationId: fx.orgA, action: 'MEMBER_REMOVED' },
      });

      expect(entry).toMatchObject({
        actorId: fx.alice,
        subjectId: fx.daveMembership,
      });
    });

    it('should show them to the Admin only, and count them nowhere', async () => {
      await remove(fx.daveMembership);

      const forAdmin = await call(
        'get',
        `/organizations/${fx.orgA}/memberships`,
        fx.alice,
      );
      const removed = forAdmin.body.find(
        ({ id }: { id: string }) => id === fx.daveMembership,
      );

      expect(removed.removal).toMatchObject({ removedBy: { name: 'alice' } });

      const forTeammate = await call(
        'get',
        `/organizations/${fx.orgA}/memberships`,
        fx.erin,
      );

      expect(
        forTeammate.body.map(({ id }: { id: string }) => id),
      ).not.toContain(fx.daveMembership);
      expect(
        (
          await call(
            'get',
            `/organizations/${fx.orgA}/memberships/${fx.daveMembership}`,
            fx.erin,
          )
        ).status,
      ).toBe(404);

      const roles = await call(
        'get',
        `/organizations/${fx.orgA}/roles`,
        fx.alice,
      );
      const responders = roles.body.find(
        ({ role }: { role: string }) => role === 'RESPONDER',
      );

      expect(responders.memberCount).toBe(1);

      const team = await call(
        'get',
        `/organizations/${fx.orgA}/teams/${fx.team}/members`,
        fx.alice,
      );

      expect(
        team.body.map(({ user }: { user: { id: string } }) => user.id),
      ).toEqual([fx.erin]);
    });

    it("should refuse the Admin's own membership with 409 CANNOT_REMOVE_SELF", async () => {
      const response = await remove(fx.aliceMembership);

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('CANNOT_REMOVE_SELF');
    });

    it('should refuse someone removed already with 409 MEMBER_REMOVED', async () => {
      await remove(fx.daveMembership);

      const again = await remove(fx.daveMembership);

      expect(again.status).toBe(409);
      expect(again.body.code).toBe('MEMBER_REMOVED');
    });

    it('should refuse someone still investigating, naming the incident, and change nothing', async () => {
      const open = await incident();

      await prisma.incidentResponder.create({
        data: {
          organizationId: fx.orgA,
          incidentId: open.id,
          membershipId: fx.daveMembership,
        },
      });

      const listed = await call(
        'get',
        `/organizations/${fx.orgA}/memberships/${fx.daveMembership}`,
        fx.alice,
      );

      expect(listed.body.openWork).toEqual([
        {
          kind: 'INVESTIGATING',
          incident: { number: open.number, title: expect.any(String) },
        },
      ]);

      const response = await remove(fx.daveMembership);

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('MEMBER_HAS_OPEN_WORK');
      expect(
        await prisma.teamMembership.count({
          where: { membershipId: fx.daveMembership },
        }),
      ).toBe(1);
    });

    it('should refuse the owner of a draft analysis, and allow the owner of a published one', async () => {
      const resolved = await incident('RESOLVED');
      const analysis = await prisma.incidentAnalysis.create({
        data: {
          organizationId: fx.orgA,
          incidentId: resolved.id,
          ownerMembershipId: fx.daveMembership,
          createdById: fx.alice,
        },
        select: { id: true },
      });

      const refused = await remove(fx.daveMembership);

      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('MEMBER_HAS_OPEN_WORK');

      await prisma.incidentAnalysis.update({
        where: { id: analysis.id },
        data: {
          status: 'PUBLISHED',
          summary: 'What happened.',
          publishedAt: new Date(),
          publishedById: fx.alice,
        },
      });

      expect((await remove(fx.daveMembership)).status).toBe(200);
    });

    it('should refuse anyone who does not manage members with 403', async () => {
      const response = await remove(fx.daveMembership, fx.erin);

      expect(response.status).toBe(403);
    });

    it('should answer a member of another organization as not found', async () => {
      const response = await remove(fx.bobMembership);

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('MEMBERSHIP_NOT_FOUND');
    });
  });

  describe('what they did, after they are removed', () => {
    it('should keep their name everywhere, marked former, with no role', async () => {
      const open = await incident();
      const responders = `/organizations/${fx.orgA}/incidents/${open.number}/responders/me`;

      // Dave works the incident through the API, so the timeline has him.
      expect((await call('post', responders, fx.dave)).status).toBeLessThan(
        300,
      );
      expect(
        (await call('post', `${responders}/complete`, fx.dave)).status,
      ).toBeLessThan(300);

      await prisma.activityEntry.create({
        data: {
          organizationId: fx.orgA,
          action: 'SIGNED_IN',
          area: 'SECURITY',
          actorId: fx.dave,
          actorName: 'dave',
        },
      });

      expect((await remove(fx.daveMembership)).status).toBe(200);

      const detail = await call(
        'get',
        `/organizations/${fx.orgA}/incidents/${open.number}`,
        fx.alice,
      );

      expect(detail.body.responders).toEqual([
        expect.objectContaining({ name: 'dave', former: true }),
      ]);

      const timeline = await call(
        'get',
        `/organizations/${fx.orgA}/incidents/${open.number}/timeline`,
        fx.alice,
      );
      const his = timeline.body.filter(
        ({ actor }: { actor: { id: string } }) => actor.id === fx.dave,
      );

      expect(his.length).toBeGreaterThan(0);
      for (const entry of his) {
        expect(entry.actor).toEqual({ id: fx.dave, name: 'dave', role: null });
      }

      const log = await call(
        'get',
        `/organizations/${fx.orgA}/activity?view=security`,
        fx.alice,
      );

      expect(log.body.entries[0].actor).toEqual({
        id: fx.dave,
        name: 'dave',
        former: true,
      });

      // Restored, he is himself again.
      await restore(fx.daveMembership, 'RESPONDER');

      const again = await call(
        'get',
        `/organizations/${fx.orgA}/incidents/${open.number}`,
        fx.alice,
      );

      expect(again.body.responders[0].former).toBe(false);
    });
  });

  describe('a removed person', () => {
    beforeEach(async () => {
      await remove(fx.daveMembership);
    });

    it('should not be given a role or a new password', async () => {
      const role = await call(
        'put',
        `/organizations/${fx.orgA}/memberships/${fx.daveMembership}/role`,
        fx.alice,
        { role: 'REPORTER' },
      );
      const password = await call(
        'put',
        `/organizations/${fx.orgA}/memberships/${fx.daveMembership}/password`,
        fx.alice,
        { temporaryPassword: 'one-time-password-123' },
      );

      expect([role.status, role.body.code]).toEqual([409, 'MEMBER_REMOVED']);
      expect([password.status, password.body.code]).toEqual([
        409,
        'MEMBER_REMOVED',
      ]);
    });

    it('should not be placed on a team', async () => {
      const response = await call(
        'post',
        `/organizations/${fx.orgA}/teams/${fx.team}/members`,
        fx.alice,
        { membershipId: fx.daveMembership },
      );

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('MEMBERSHIP_NOT_FOUND');
    });

    it('should be offered for restoring when added again by email', async () => {
      const response = await call(
        'post',
        `/organizations/${fx.orgA}/memberships`,
        fx.alice,
        {
          name: 'Dave again',
          email: 'DAVE@acme.example',
          temporaryPassword: 'one-time-password-123',
        },
      );

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('MEMBER_REMOVED');
    });
  });

  describe('restoring someone', () => {
    it('should bring them back in the role named, on no team, with access again', async () => {
      await remove(fx.daveMembership);

      const response = await restore(fx.daveMembership, 'REPORTER');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: fx.daveMembership,
        role: 'REPORTER',
        teams: [],
        removal: null,
      });
      expect(
        (await call('get', `/organizations/${fx.orgA}`, fx.dave)).status,
      ).toBe(200);

      const entry = await prisma.activityEntry.findFirstOrThrow({
        where: { organizationId: fx.orgA, action: 'MEMBER_RESTORED' },
      });

      expect(entry.subjectId).toBe(fx.daveMembership);
    });

    it('should refuse someone who belongs already with 409 MEMBER_NOT_REMOVED', async () => {
      const response = await restore(fx.daveMembership, 'RESPONDER');

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('MEMBER_NOT_REMOVED');
    });

    it('should require a role', async () => {
      await remove(fx.daveMembership);

      const response = await call(
        'post',
        `/organizations/${fx.orgA}/memberships/${fx.daveMembership}/restore`,
        fx.alice,
        {},
      );

      expect(response.status).toBe(400);
    });

    it('should refuse anyone who does not manage members with 403', async () => {
      await remove(fx.daveMembership);

      expect(
        (await restore(fx.daveMembership, 'RESPONDER', fx.erin)).status,
      ).toBe(403);
    });
  });

  it('should never leave a removed person investigating, however a start and a removal race', async () => {
    for (let round = 0; round < 5; round++) {
      const open = await incident();

      await Promise.all([
        call(
          'post',
          `/organizations/${fx.orgA}/incidents/${open.number}/responders/me`,
          fx.dave,
        ),
        remove(fx.daveMembership),
      ]);

      const dave = await prisma.membership.findUniqueOrThrow({
        where: { id: fx.daveMembership },
        select: { removedAt: true },
      });
      const investigating = await prisma.incidentResponder.count({
        where: { membershipId: fx.daveMembership, status: 'INVESTIGATING' },
      });

      // One or the other won; never both.
      expect(dave.removedAt !== null && investigating > 0).toBe(false);

      // Back to the start: restored, on the team, with no response.
      await prisma.incidentResponder.deleteMany({
        where: { membershipId: fx.daveMembership },
      });
      await prisma.membership.update({
        where: { id: fx.daveMembership },
        data: { removedAt: null, removedById: null },
      });
      await prisma.teamMembership.upsert({
        where: {
          teamId_membershipId: {
            teamId: fx.team,
            membershipId: fx.daveMembership,
          },
        },
        create: {
          organizationId: fx.orgA,
          teamId: fx.team,
          membershipId: fx.daveMembership,
        },
        update: {},
      });
    }
  });
});
