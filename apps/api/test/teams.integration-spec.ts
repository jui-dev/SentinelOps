import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from './../src/app.module.js';
import { TokenService } from './../src/auth/token.service.js';
import { foreignKeyViolationHint } from './../src/database/foreign-key-violation.js';
import { PrismaService } from './../src/database/prisma.service.js';
import { TeamsService } from './../src/teams/teams.service.js';
import { leakedKeys } from './leaks.js';
import { resolveTestDatabaseUrl, truncate } from './test-database.js';

/**
 * Teams against a real database.
 *
 * Two tenants. Alice owns A, Bob owns B, Carol is ADMIN in A and MEMBER in B
 * — one token, two capacities — and Dave is a plain MEMBER of A.
 *
 * What is proven here and nowhere else: that a team or membership from another
 * organization is indistinguishable from one that does not exist on every
 * route; that refused writes leave rows untouched; that the constraint mapping
 * holds against the real driver adapter, including the foreign-key violation
 * raised when a team disappears mid-insert; and that races resolve to 409 or
 * 404, never 500.
 */

interface Fixture {
  orgA: string;
  orgB: string;
  alice: string;
  bob: string;
  carol: string;
  dave: string;
  aliceInA: string;
  carolInA: string;
  daveInA: string;
  bobInB: string;
  carolInB: string;
}

type Role = 'ADMIN' | 'RESPONDER';

/**
 * A reader who may see every team there is. Tenant isolation is proven
 * against this one deliberately: the widest scope must still not reach
 * another organization, because the organization is a separate condition
 * from the reader's own.
 */
const OVERSIGHT = {
  membershipId: '0199a1b2-c3d4-7000-8000-0000000000ff',
  role: 'ADMIN' as const,
};

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

describe('teams (integration)', () => {
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

  /** A team created directly, for tests about something other than creating. */
  const aTeam = (organizationId: string, name: string) =>
    prisma.team.create({
      data: {
        organizationId,
        name,
        slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
      },
      select: { id: true },
    });

  const place = (
    organizationId: string,
    teamId: string,
    membershipId: string,
  ) =>
    prisma.teamMembership.create({
      data: { organizationId, teamId, membershipId },
    });

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

    return {
      orgA,
      orgB,
      alice,
      bob,
      carol,
      dave,
      aliceInA: await grant(orgA, alice, 'ADMIN'),
      bobInB: await grant(orgB, bob, 'ADMIN'),
      carolInA: await grant(orgA, carol, 'ADMIN'),
      carolInB: await grant(orgB, carol, 'RESPONDER'),
      daveInA: await grant(orgA, dave, 'RESPONDER'),
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
  });

  describe('lifecycle', () => {
    it('should create, read, rename, and delete a team', async () => {
      const created = await call('post', `${fx.orgA}/teams`, fx.carol, {
        name: '  Payments & Risk ',
        description: '  Card processing.  ',
      });

      expect(created.status).toBe(201);
      expect(created.body).toEqual({
        id: expect.any(String),
        name: 'Payments & Risk',
        slug: 'payments-risk',
        description: 'Card processing.',
        memberCount: 0,
        serviceCount: 0,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });

      const id = created.body.id as string;

      expect(
        (await call('get', `${fx.orgA}/teams/${id}`, fx.alice)).body,
      ).toEqual(created.body);

      const renamed = await call('patch', `${fx.orgA}/teams/${id}`, fx.alice, {
        name: 'Payments',
        description: null,
      });

      expect(renamed.status).toBe(200);
      expect(renamed.body).toMatchObject({
        name: 'Payments',
        slug: 'payments-risk',
        description: null,
      });

      expect(
        (await call('delete', `${fx.orgA}/teams/${id}`, fx.alice)).status,
      ).toBe(204);
      expectCode(
        await call('get', `${fx.orgA}/teams/${id}`, fx.alice),
        404,
        'TEAM_NOT_FOUND',
      );
    });

    it('should list only the organization’s own teams, by name', async () => {
      await aTeam(fx.orgA, 'Platform');
      await aTeam(fx.orgA, 'Checkout');
      await aTeam(fx.orgB, 'Bravo Only');

      const list = await call('get', `${fx.orgA}/teams`, fx.alice);

      expect(list.status).toBe(200);
      expect(list.body.map((team: { name: string }) => team.name)).toEqual([
        'Checkout',
        'Platform',
      ]);
    });

    it('should give a name with no sluggable characters an opaque slug', async () => {
      const created = await call('post', `${fx.orgA}/teams`, fx.alice, {
        name: '決済',
      });

      expect(created.status).toBe(201);
      expect(created.body.slug).toMatch(/^team-[0-9a-f]{8}$/);
    });

    it('should refuse a name that differs from an existing one only by case or punctuation', async () => {
      await call('post', `${fx.orgA}/teams`, fx.alice, { name: 'Platform' });

      for (const name of ['Platform', 'platform!', 'PLATFORM']) {
        expectCode(
          await call('post', `${fx.orgA}/teams`, fx.alice, { name }),
          409,
          'TEAM_NAME_TAKEN',
        );
      }

      expect(
        await prisma.team.count({ where: { organizationId: fx.orgA } }),
      ).toBe(1);
    });

    it('should refuse a rename to an existing name', async () => {
      await aTeam(fx.orgA, 'Platform');
      const { id } = await aTeam(fx.orgA, 'Checkout');

      expectCode(
        await call('patch', `${fx.orgA}/teams/${id}`, fx.alice, {
          name: 'Platform',
        }),
        409,
        'TEAM_NAME_TAKEN',
      );
    });

    it('should allow the same name in another organization', async () => {
      await aTeam(fx.orgB, 'Platform');

      expect(
        (await call('post', `${fx.orgA}/teams`, fx.alice, { name: 'Platform' }))
          .status,
      ).toBe(201);
    });

    it.each([{ slug: 'chosen' }, { organizationId: randomUUID() }])(
      'should refuse %o in a create body',
      async (extra) => {
        const response = await call('post', `${fx.orgA}/teams`, fx.alice, {
          name: 'Platform',
          ...extra,
        });

        expect(response.status).toBe(400);
        expect(await prisma.team.count()).toBe(0);
      },
    );
  });

  describe('members', () => {
    it('should add, list, count, and remove members', async () => {
      const { id } = await aTeam(fx.orgA, 'Platform');
      const path = `${fx.orgA}/teams/${id}/members`;

      const added = await call('post', path, fx.carol, {
        membershipId: fx.daveInA,
      });

      expect(added.status).toBe(201);
      expect(added.body).toEqual({
        membershipId: fx.daveInA,
        addedAt: expect.any(String),
        user: { id: fx.dave, name: 'Dave Duarte', email: 'dave@acme.example' },
      });

      await call('post', path, fx.carol, { membershipId: fx.aliceInA });

      const list = await call('get', path, fx.dave);

      expect(
        list.body.map((m: { membershipId: string }) => m.membershipId),
      ).toEqual([fx.aliceInA, fx.daveInA]);
      expect(
        (await call('get', `${fx.orgA}/teams/${id}`, fx.dave)).body.memberCount,
      ).toBe(2);

      expect(
        (await call('delete', `${path}/${fx.daveInA}`, fx.alice)).status,
      ).toBe(204);
      expectCode(
        await call('delete', `${path}/${fx.daveInA}`, fx.alice),
        404,
        'TEAM_MEMBER_NOT_FOUND',
      );
      expect(await prisma.membership.count({ where: { id: fx.daveInA } })).toBe(
        1,
      );
    });

    it('should let a member be on several teams, and a team be empty', async () => {
      const platform = await aTeam(fx.orgA, 'Platform');
      const checkout = await aTeam(fx.orgA, 'Checkout');
      await aTeam(fx.orgA, 'Empty');

      for (const team of [platform, checkout]) {
        expect(
          (
            await call(
              'post',
              `${fx.orgA}/teams/${team.id}/members`,
              fx.alice,
              {
                membershipId: fx.daveInA,
              },
            )
          ).status,
        ).toBe(201);
      }

      const counts = (await call('get', `${fx.orgA}/teams`, fx.alice)).body.map(
        (team: { name: string; memberCount: number }) => [
          team.name,
          team.memberCount,
        ],
      );

      expect(counts).toEqual([
        ['Checkout', 1],
        ['Empty', 0],
        ['Platform', 1],
      ]);
    });

    it('should refuse the same member twice', async () => {
      const { id } = await aTeam(fx.orgA, 'Platform');
      const path = `${fx.orgA}/teams/${id}/members`;

      await call('post', path, fx.alice, { membershipId: fx.daveInA });

      expectCode(
        await call('post', path, fx.alice, { membershipId: fx.daveInA }),
        409,
        'ALREADY_A_TEAM_MEMBER',
      );
    });

    it('should delete the team’s placements, and only those, with the team', async () => {
      const { id } = await aTeam(fx.orgA, 'Platform');
      await place(fx.orgA, id, fx.daveInA);

      await call('delete', `${fx.orgA}/teams/${id}`, fx.alice);

      expect(await prisma.teamMembership.count()).toBe(0);
      expect(await prisma.membership.count({ where: { id: fx.daveInA } })).toBe(
        1,
      );
    });
  });

  describe('services', () => {
    const aService = (
      organizationId: string,
      ownerTeamId: string,
      name: string,
    ) =>
      prisma.service.create({
        data: {
          organizationId,
          ownerTeamId,
          name,
          slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        },
      });

    it('should count the services a team owns', async () => {
      const payments = await aTeam(fx.orgA, 'Payments');
      const platform = await aTeam(fx.orgA, 'Platform');
      await aService(fx.orgA, payments.id, 'Payment API');
      await aService(fx.orgA, payments.id, 'Settlement');

      const counts = (await call('get', `${fx.orgA}/teams`, fx.alice)).body.map(
        (team: { name: string; serviceCount: number }) => [
          team.name,
          team.serviceCount,
        ],
      );

      expect(counts).toEqual([
        ['Payments', 2],
        ['Platform', 0],
      ]);
      expect(
        (await call('get', `${fx.orgA}/teams/${platform.id}`, fx.alice)).body
          .serviceCount,
      ).toBe(0);
    });

    it('should refuse to delete a team that owns services with 409, deleting nothing', async () => {
      const payments = await aTeam(fx.orgA, 'Payments');
      const platform = await aTeam(fx.orgA, 'Platform');
      const service = await aService(fx.orgA, payments.id, 'Payment API');
      await place(fx.orgA, payments.id, fx.daveInA);

      expectCode(
        await call('delete', `${fx.orgA}/teams/${payments.id}`, fx.alice),
        409,
        'TEAM_OWNS_SERVICES',
      );
      expect(await prisma.team.count({ where: { id: payments.id } })).toBe(1);
      expect(await prisma.teamMembership.count()).toBe(1);
      expect(await prisma.service.count()).toBe(1);

      // Reassigned, the team can go — and the service stays.
      await prisma.service.update({
        where: { id: service.id },
        data: { ownerTeamId: platform.id },
      });

      expect(
        (await call('delete', `${fx.orgA}/teams/${payments.id}`, fx.alice))
          .status,
      ).toBe(204);
      expect(await prisma.service.count()).toBe(1);
    });
  });

  describe('authorization', () => {
    it('should let a MEMBER read the teams they are on', async () => {
      const { id } = await aTeam(fx.orgA, 'Platform');
      await place(fx.orgA, id, fx.daveInA);

      for (const path of [
        `${fx.orgA}/teams`,
        `${fx.orgA}/teams/${id}`,
        `${fx.orgA}/teams/${id}/members`,
      ]) {
        expect((await call('get', path, fx.dave)).status).toBe(200);
      }
    });

    it('should refuse every MEMBER write with 403 and change nothing', async () => {
      const { id } = await aTeam(fx.orgA, 'Platform');
      await place(fx.orgA, id, fx.aliceInA);
      const before = await prisma.team.findUniqueOrThrow({ where: { id } });

      const attempts: [
        'post' | 'patch' | 'delete',
        string,
        object | undefined,
      ][] = [
        ['post', `${fx.orgA}/teams`, { name: 'Sneaky' }],
        ['patch', `${fx.orgA}/teams/${id}`, { name: 'Renamed' }],
        ['delete', `${fx.orgA}/teams/${id}`, undefined],
        [
          'post',
          `${fx.orgA}/teams/${id}/members`,
          { membershipId: fx.daveInA },
        ],
        ['delete', `${fx.orgA}/teams/${id}/members/${fx.aliceInA}`, undefined],
      ];

      for (const [method, path, body] of attempts) {
        expectCode(
          await call(method, path, fx.dave, body),
          403,
          'PERMISSION_DENIED',
        );
      }

      expect(await prisma.team.findUniqueOrThrow({ where: { id } })).toEqual(
        before,
      );
      expect(await prisma.team.count()).toBe(1);
      expect(await prisma.teamMembership.count()).toBe(1);
    });

    it('should judge one token by the role it holds in each organization', async () => {
      expect(
        (await call('post', `${fx.orgA}/teams`, fx.carol, { name: 'Platform' }))
          .status,
      ).toBe(201);
      expectCode(
        await call('post', `${fx.orgB}/teams`, fx.carol, { name: 'Platform' }),
        403,
        'PERMISSION_DENIED',
      );
    });

    it('should answer a non-member with admission’s 404', async () => {
      expectCode(
        await call('get', `${fx.orgA}/teams`, fx.bob),
        404,
        'ORGANIZATION_NOT_FOUND',
      );
    });
  });

  describe('member visibility', () => {
    /**
     * A team Dave is on, one he is not, and an incident against the second
     * that he responded to and has since left behind. The state Boundary
     * #3.2 exists to keep apart: the incident stays his to read, the team
     * does not become his to see.
     */
    const aPastResponse = async () => {
      const platform = await aTeam(fx.orgA, 'Platform');
      const payments = await aTeam(fx.orgA, 'Payments');
      await place(fx.orgA, platform.id, fx.daveInA);

      const service = await prisma.service.create({
        data: {
          organizationId: fx.orgA,
          name: 'Checkout',
          slug: 'checkout',
          ownerTeamId: payments.id,
        },
        select: { id: true },
      });
      const incident = await prisma.incident.create({
        data: {
          organizationId: fx.orgA,
          number: 142,
          title: 'Checkout failing',
          serviceId: service.id,
          teamId: payments.id,
          severity: 'SEV2',
          createdById: fx.alice,
        },
        select: { id: true, number: true },
      });
      await prisma.incidentResponder.create({
        data: {
          organizationId: fx.orgA,
          incidentId: incident.id,
          membershipId: fx.daveInA,
          status: 'COMPLETED',
          completedAt: new Date(),
        },
      });

      return { platform, payments, incident };
    };

    it('should list only the teams the member is on', async () => {
      const platform = await aTeam(fx.orgA, 'Platform');
      await aTeam(fx.orgA, 'Payments');
      await place(fx.orgA, platform.id, fx.daveInA);

      const response = await call('get', `${fx.orgA}/teams`, fx.dave);

      expect(response.status).toBe(200);
      expect(response.body).toEqual([
        expect.objectContaining({ id: platform.id, name: 'Platform' }),
      ]);
    });

    it('should list nothing for a member on no team', async () => {
      await aTeam(fx.orgA, 'Platform');

      const response = await call('get', `${fx.orgA}/teams`, fx.dave);

      expect(response.status).toBe(200);
      expect(response.body).toEqual([]);
    });

    it('should let a member read their own team and its roster', async () => {
      const { id } = await aTeam(fx.orgA, 'Platform');
      await place(fx.orgA, id, fx.daveInA);
      await place(fx.orgA, id, fx.carolInA);

      const team = await call('get', `${fx.orgA}/teams/${id}`, fx.dave);
      const roster = await call(
        'get',
        `${fx.orgA}/teams/${id}/members`,
        fx.dave,
      );

      expect(team.body).toEqual(
        expect.objectContaining({ id, name: 'Platform', memberCount: 2 }),
      );
      // A teammate, identity only — the projection B3.2 leaves untouched.
      expect(roster.body).toEqual(
        expect.arrayContaining([
          {
            membershipId: fx.carolInA,
            addedAt: expect.any(String),
            user: {
              id: fx.carol,
              name: 'Carol Chen',
              email: 'carol@both.example',
            },
          },
        ]),
      );
    });

    it('should answer an unrelated team exactly as a nonexistent one', async () => {
      const platform = await aTeam(fx.orgA, 'Platform');
      const payments = await aTeam(fx.orgA, 'Payments');
      await place(fx.orgA, platform.id, fx.daveInA);

      const unrelated = await call(
        'get',
        `${fx.orgA}/teams/${payments.id}`,
        fx.dave,
      );
      const missing = await call(
        'get',
        `${fx.orgA}/teams/${randomUUID()}`,
        fx.dave,
      );
      const malformed = await call(
        'get',
        `${fx.orgA}/teams/not-a-uuid`,
        fx.dave,
      );

      expectCode(unrelated, 404, 'TEAM_NOT_FOUND');
      // Byte for byte the same answer: the status cannot be asked which
      // uuids name real teams in this organization.
      expect(comparable(unrelated.body)).toEqual(comparable(missing.body));
      expect(comparable(unrelated.body)).toEqual(comparable(malformed.body));
    });

    it("should refuse an unrelated team's roster before reading placements", async () => {
      const platform = await aTeam(fx.orgA, 'Platform');
      const payments = await aTeam(fx.orgA, 'Payments');
      await place(fx.orgA, platform.id, fx.daveInA);
      // Payments has members. An empty roster, or TEAM_MEMBER_NOT_FOUND,
      // would each say the team exists.
      await place(fx.orgA, payments.id, fx.carolInA);

      const populated = await call(
        'get',
        `${fx.orgA}/teams/${payments.id}/members`,
        fx.dave,
      );
      const missing = await call(
        'get',
        `${fx.orgA}/teams/${randomUUID()}/members`,
        fx.dave,
      );

      expectCode(populated, 404, 'TEAM_NOT_FOUND');
      expect(comparable(populated.body)).toEqual(comparable(missing.body));
    });

    it('should keep a past response from widening team visibility', async () => {
      const { payments, incident } = await aPastResponse();

      // The incident is still Dave's to read: he responded to it.
      expect(
        (await call('get', `${fx.orgA}/incidents/${incident.number}`, fx.dave))
          .status,
      ).toBe(200);

      // The team now responsible for it is not.
      expectCode(
        await call('get', `${fx.orgA}/teams/${payments.id}`, fx.dave),
        404,
        'TEAM_NOT_FOUND',
      );
      expectCode(
        await call('get', `${fx.orgA}/teams/${payments.id}/members`, fx.dave),
        404,
        'TEAM_NOT_FOUND',
      );
      expect((await call('get', `${fx.orgA}/teams`, fx.dave)).body).toEqual([
        expect.objectContaining({ name: 'Platform' }),
      ]);
    });

    it('should not preserve visibility of a team the member has left', async () => {
      const { id } = await aTeam(fx.orgA, 'Platform');
      await place(fx.orgA, id, fx.daveInA);
      expect(
        (await call('get', `${fx.orgA}/teams`, fx.dave)).body,
      ).toHaveLength(1);

      await prisma.teamMembership.deleteMany({
        where: { teamId: id, membershipId: fx.daveInA },
      });

      expect((await call('get', `${fx.orgA}/teams`, fx.dave)).body).toEqual([]);
      expectCode(
        await call('get', `${fx.orgA}/teams/${id}`, fx.dave),
        404,
        'TEAM_NOT_FOUND',
      );
      expectCode(
        await call('get', `${fx.orgA}/teams/${id}/members`, fx.dave),
        404,
        'TEAM_NOT_FOUND',
      );
    });

    it('should leave oversight organization-wide', async () => {
      const platform = await aTeam(fx.orgA, 'Platform');
      const payments = await aTeam(fx.orgA, 'Payments');
      await place(fx.orgA, payments.id, fx.daveInA);

      // Alice is on neither team and sees both, with every roster.
      const list = await call('get', `${fx.orgA}/teams`, fx.alice);

      expect(list.body).toEqual([
        expect.objectContaining({ id: payments.id }),
        expect.objectContaining({ id: platform.id }),
      ]);

      for (const { id } of [platform, payments]) {
        expect(
          (await call('get', `${fx.orgA}/teams/${id}`, fx.alice)).status,
        ).toBe(200);
        expect(
          (await call('get', `${fx.orgA}/teams/${id}/members`, fx.alice))
            .status,
        ).toBe(200);
      }
    });
  });

  describe('tenant isolation', () => {
    it('should answer a foreign team exactly as a nonexistent one, on every route', async () => {
      const foreign = await aTeam(fx.orgB, 'Bravo Platform');
      await place(fx.orgB, foreign.id, fx.bobInB);
      const before = await prisma.team.findUniqueOrThrow({
        where: { id: foreign.id },
      });
      const missing = randomUUID();

      const routes: [
        'get' | 'patch' | 'delete' | 'post',
        (teamId: string) => string,
        object | undefined,
      ][] = [
        ['get', (t) => `${fx.orgA}/teams/${t}`, undefined],
        ['patch', (t) => `${fx.orgA}/teams/${t}`, { name: 'Hijacked' }],
        ['get', (t) => `${fx.orgA}/teams/${t}/members`, undefined],
        [
          'post',
          (t) => `${fx.orgA}/teams/${t}/members`,
          { membershipId: fx.daveInA },
        ],
        [
          'delete',
          (t) => `${fx.orgA}/teams/${t}/members/${fx.bobInB}`,
          undefined,
        ],
        ['delete', (t) => `${fx.orgA}/teams/${t}`, undefined],
      ];

      for (const [method, path, body] of routes) {
        const toForeign = await call(method, path(foreign.id), fx.alice, body);
        const toMissing = await call(method, path(missing), fx.alice, body);

        expectCode(toForeign, 404, 'TEAM_NOT_FOUND');
        expect(comparable(toForeign.body)).toEqual(comparable(toMissing.body));
      }

      // Carol is a member of B too, but was admitted to A for these requests.
      expectCode(
        await call('get', `${fx.orgA}/teams/${foreign.id}`, fx.carol),
        404,
        'TEAM_NOT_FOUND',
      );

      expect(
        await prisma.team.findUniqueOrThrow({ where: { id: foreign.id } }),
      ).toEqual(before);
      expect(await prisma.teamMembership.count()).toBe(1);
    });

    it("should refuse another organization's membership, answering it as nonexistent", async () => {
      const { id } = await aTeam(fx.orgA, 'Platform');
      const path = `${fx.orgA}/teams/${id}/members`;

      // Carol's B membership: a real membership, of a real member of A — but
      // not A's grant.
      for (const membershipId of [fx.bobInB, fx.carolInB, randomUUID()]) {
        expectCode(
          await call('post', path, fx.alice, { membershipId }),
          404,
          'MEMBERSHIP_NOT_FOUND',
        );
      }

      expect(await prisma.teamMembership.count()).toBe(0);
    });

    it('should isolate in the service itself, with no guard in front of it', async () => {
      const teams = app.get(TeamsService);
      const foreign = await aTeam(fx.orgB, 'Bravo Platform');

      for (const attempt of [
        () => teams.get(fx.orgA, OVERSIGHT, foreign.id),
        () => teams.listMembers(fx.orgA, OVERSIGHT, foreign.id),
        () => teams.update(fx.orgA, foreign.id, { name: 'Hijacked' }, fx.alice),
        () => teams.delete(fx.orgA, foreign.id, fx.alice),
        () =>
          teams.addMember(
            fx.orgA,
            foreign.id,
            { membershipId: fx.daveInA },
            { membershipId: fx.aliceInA },
          ),
      ]) {
        await expect(attempt()).rejects.toBeInstanceOf(HttpException);
      }

      expect(await prisma.team.count({ where: { id: foreign.id } })).toBe(1);
    });

    it('should answer malformed ids with 404, never 500', async () => {
      const { id } = await aTeam(fx.orgA, 'Platform');

      expectCode(
        await call('get', `${fx.orgA}/teams/not-a-uuid`, fx.alice),
        404,
        'TEAM_NOT_FOUND',
      );
      expectCode(
        await call(
          'delete',
          `${fx.orgA}/teams/${id}/members/not-a-uuid`,
          fx.alice,
        ),
        404,
        'TEAM_MEMBER_NOT_FOUND',
      );
    });
  });

  describe('soft deletion', () => {
    it('should hide a soft-deleted member and refuse to add them', async () => {
      const { id } = await aTeam(fx.orgA, 'Platform');
      await place(fx.orgA, id, fx.daveInA);
      await prisma.user.update({
        where: { id: fx.dave },
        data: { deletedAt: new Date() },
      });

      expect(
        (await call('get', `${fx.orgA}/teams/${id}/members`, fx.alice)).body,
      ).toEqual([]);
      expect(
        (await call('get', `${fx.orgA}/teams/${id}`, fx.alice)).body
          .memberCount,
      ).toBe(0);

      const other = await aTeam(fx.orgA, 'Checkout');

      expectCode(
        await call('post', `${fx.orgA}/teams/${other.id}/members`, fx.alice, {
          membershipId: fx.daveInA,
        }),
        404,
        'MEMBERSHIP_NOT_FOUND',
      );
    });

    it('should make every team route of a soft-deleted organization unreachable', async () => {
      const { id } = await aTeam(fx.orgA, 'Platform');
      await prisma.organization.update({
        where: { id: fx.orgA },
        data: { deletedAt: new Date() },
      });

      expectCode(
        await call('get', `${fx.orgA}/teams/${id}`, fx.alice),
        404,
        'ORGANIZATION_NOT_FOUND',
      );
      expect(await prisma.team.count()).toBe(1);
    });
  });

  describe('constraint mapping against the real driver adapter', () => {
    it('should name the composite key a refused placement violated', async () => {
      const { id } = await aTeam(fx.orgA, 'Platform');
      const failure = (promise: Promise<unknown>) =>
        promise.then(
          () => undefined,
          (error: unknown) => error,
        );

      // The team does not exist: the team key.
      expect(
        foreignKeyViolationHint(
          await failure(place(fx.orgA, randomUUID(), fx.daveInA)),
        ),
      ).toContain('team_id');
      // The membership is B's: the membership key.
      expect(
        foreignKeyViolationHint(await failure(place(fx.orgA, id, fx.bobInB))),
      ).toContain('membership_id');
    });
  });

  describe('concurrency', () => {
    it('should let exactly one of two concurrent identical adds succeed', async () => {
      const { id } = await aTeam(fx.orgA, 'Platform');
      const path = `${fx.orgA}/teams/${id}/members`;

      const statuses = (
        await Promise.all(
          Array.from({ length: 4 }, () =>
            call('post', path, fx.alice, { membershipId: fx.daveInA }),
          ),
        )
      )
        .map((response) => response.status)
        .sort();

      expect(statuses).toEqual([201, 409, 409, 409]);
      expect(await prisma.teamMembership.count()).toBe(1);
    });

    it('should let exactly one of several concurrent creates of one name succeed', async () => {
      const statuses = (
        await Promise.all(
          ['Platform', 'platform', 'Platform!', 'PLATFORM'].map((name) =>
            call('post', `${fx.orgA}/teams`, fx.alice, { name }),
          ),
        )
      )
        .map((response) => response.status)
        .sort();

      expect(statuses).toEqual([201, 409, 409, 409]);
      expect(await prisma.team.count()).toBe(1);
    });

    it('should answer an add racing the team’s deletion with 201 or 404, never 500', async () => {
      for (let round = 0; round < 5; round += 1) {
        const { id } = await aTeam(fx.orgA, `Platform ${round}`);

        const [added, deleted] = await Promise.all([
          call('post', `${fx.orgA}/teams/${id}/members`, fx.alice, {
            membershipId: fx.daveInA,
          }),
          call('delete', `${fx.orgA}/teams/${id}`, fx.carol),
        ]);

        expect(deleted.status).toBe(204);
        expect([201, 404]).toContain(added.status);

        if (added.status === 404) {
          expect(added.body.code).toBe('TEAM_NOT_FOUND');
        }
      }

      expect(await prisma.teamMembership.count()).toBe(0);
    });
  });
});
