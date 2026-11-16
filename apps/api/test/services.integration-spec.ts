import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { HttpException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from './../src/app.module.js';
import { TokenService } from './../src/auth/token.service.js';
import { foreignKeyViolationHint } from './../src/database/foreign-key-violation.js';
import { PrismaService } from './../src/database/prisma.service.js';
import { ServicesService } from './../src/services/services.service.js';
import { leakedKeys } from './leaks.js';
import { resolveTestDatabaseUrl, truncate } from './test-database.js';

/**
 * Services against a real database.
 *
 * Two tenants. Alice owns A, Bob owns B, Carol is ADMIN in A and MEMBER in B
 * — one token, two capacities — and Dave is a plain MEMBER of A. A has two
 * teams, Payments and Platform; B has its own Payments.
 *
 * What is proven here and nowhere else: that a service or owning team from
 * another organization is indistinguishable from one that does not exist on
 * every route; that refused writes leave rows untouched; that the owner key's
 * violation is recognised through the real driver adapter; and that races
 * between services and their teams resolve to 2xx, 404, or 409 — never 500,
 * and never a service without an owner.
 */

interface Fixture {
  orgA: string;
  orgB: string;
  alice: string;
  bob: string;
  carol: string;
  dave: string;
  paymentsA: string;
  platformA: string;
  paymentsB: string;
}

type Role = 'ADMIN' | 'RESPONDER';

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

describe('services (integration)', () => {
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

  /** A service created directly, for tests about something other than creating. */
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
      select: { id: true },
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
    const grant = (organizationId: string, userId: string, role: Role) =>
      prisma.membership.create({ data: { organizationId, userId, role } });

    const orgA = await organization('Acme Operations', 'acme-operations');
    const orgB = await organization('Bravo Reliability', 'bravo-reliability');
    const alice = await user('alice@acme.example', 'Alice Anders');
    const bob = await user('bob@bravo.example', 'Bob Brandt');
    const carol = await user('carol@both.example', 'Carol Chen');
    const dave = await user('dave@acme.example', 'Dave Duarte');

    await grant(orgA, alice, 'ADMIN');
    await grant(orgB, bob, 'ADMIN');
    await grant(orgA, carol, 'ADMIN');
    await grant(orgB, carol, 'RESPONDER');
    await grant(orgA, dave, 'RESPONDER');

    return {
      orgA,
      orgB,
      alice,
      bob,
      carol,
      dave,
      paymentsA: await aTeam(orgA, 'Payments'),
      platformA: await aTeam(orgA, 'Platform'),
      paymentsB: await aTeam(orgB, 'Payments'),
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

  describe('lifecycle', () => {
    it('should create, read, change, reassign, and delete a service', async () => {
      const created = await call('post', `${fx.orgA}/services`, fx.carol, {
        name: '  Payment API ',
        description: '  Takes card payments.  ',
        ownerTeamId: fx.paymentsA,
        criticality: 'CRITICAL',
      });

      expect(created.status).toBe(201);
      expect(created.body).toEqual({
        id: expect.any(String),
        name: 'Payment API',
        slug: 'payment-api',
        description: 'Takes card payments.',
        criticality: 'CRITICAL',
        ownerTeam: { id: fx.paymentsA, name: 'Payments', slug: 'payments' },
        archivedAt: null,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });

      const id = created.body.id as string;

      expect(
        (await call('get', `${fx.orgA}/services/${id}`, fx.dave)).body,
      ).toEqual(created.body);

      const changed = await call(
        'patch',
        `${fx.orgA}/services/${id}`,
        fx.alice,
        {
          name: 'Payments API',
          description: null,
          criticality: 'HIGH',
          ownerTeamId: fx.platformA,
        },
      );

      expect(changed.status).toBe(200);
      expect(changed.body).toMatchObject({
        name: 'Payments API',
        slug: 'payment-api',
        description: null,
        criticality: 'HIGH',
        ownerTeam: { id: fx.platformA, name: 'Platform', slug: 'platform' },
      });

      expect(
        (await call('delete', `${fx.orgA}/services/${id}`, fx.alice)).status,
      ).toBe(204);
      expectCode(
        await call('get', `${fx.orgA}/services/${id}`, fx.alice),
        404,
        'SERVICE_NOT_FOUND',
      );
      // Deleting a service takes nothing else with it.
      expect(await prisma.team.count()).toBe(3);
    });

    it('should default criticality to NORMAL', async () => {
      const created = await call('post', `${fx.orgA}/services`, fx.alice, {
        name: 'Storefront',
        ownerTeamId: fx.platformA,
      });

      expect(created.body.criticality).toBe('NORMAL');
    });

    it('should list only the organization’s own services, by name', async () => {
      await aService(fx.orgA, fx.platformA, 'Storefront');
      await aService(fx.orgA, fx.paymentsA, 'Checkout');
      await aService(fx.orgB, fx.paymentsB, 'Bravo Ledger');

      const names = (
        await call('get', `${fx.orgA}/services`, fx.dave)
      ).body.map(({ name }: { name: string }) => name);

      expect(names).toEqual(['Checkout', 'Storefront']);
    });

    it('should show a team’s new name on the services it owns', async () => {
      const { id } = await aService(fx.orgA, fx.paymentsA, 'Payment API');

      await call('patch', `${fx.orgA}/teams/${fx.paymentsA}`, fx.alice, {
        name: 'Payments & Risk',
      });

      expect(
        (await call('get', `${fx.orgA}/services/${id}`, fx.alice)).body
          .ownerTeam,
      ).toEqual({
        id: fx.paymentsA,
        name: 'Payments & Risk',
        slug: 'payments',
      });
    });

    it('should give a name with no sluggable characters an opaque slug', async () => {
      const created = await call('post', `${fx.orgA}/services`, fx.alice, {
        name: '決済サービス',
        ownerTeamId: fx.paymentsA,
      });

      expect(created.status).toBe(201);
      expect(created.body.slug).toMatch(/^service-[0-9a-f]{8}$/);
    });

    it('should refuse a name that differs from an existing one only by case or punctuation', async () => {
      await call('post', `${fx.orgA}/services`, fx.alice, {
        name: 'Payment API',
        ownerTeamId: fx.paymentsA,
      });

      expectCode(
        await call('post', `${fx.orgA}/services`, fx.alice, {
          name: 'payment-api!',
          ownerTeamId: fx.platformA,
        }),
        409,
        'SERVICE_NAME_TAKEN',
      );
      expect(await prisma.service.count()).toBe(1);
    });

    it('should refuse a rename to an existing name', async () => {
      await aService(fx.orgA, fx.paymentsA, 'Payment API');
      const { id } = await aService(fx.orgA, fx.paymentsA, 'Settlement');

      expectCode(
        await call('patch', `${fx.orgA}/services/${id}`, fx.alice, {
          name: 'Payment API',
        }),
        409,
        'SERVICE_NAME_TAKEN',
      );
    });

    it('should allow the same name in another organization', async () => {
      await aService(fx.orgB, fx.paymentsB, 'Payment API');

      expect(
        (
          await call('post', `${fx.orgA}/services`, fx.alice, {
            name: 'Payment API',
            ownerTeamId: fx.paymentsA,
          })
        ).status,
      ).toBe(201);
    });
  });

  describe('authorization', () => {
    it('should let a MEMBER read services', async () => {
      const { id } = await aService(fx.orgA, fx.paymentsA, 'Payment API');

      for (const path of [`${fx.orgA}/services`, `${fx.orgA}/services/${id}`]) {
        expect((await call('get', path, fx.dave)).status).toBe(200);
      }
    });

    it('should refuse every MEMBER write with 403 and change nothing', async () => {
      const { id } = await aService(fx.orgA, fx.paymentsA, 'Payment API');
      const before = await prisma.service.findUniqueOrThrow({ where: { id } });

      const attempts: [
        'post' | 'patch' | 'delete',
        string,
        object | undefined,
      ][] = [
        [
          'post',
          `${fx.orgA}/services`,
          { name: 'Sneaky', ownerTeamId: fx.paymentsA },
        ],
        [
          'patch',
          `${fx.orgA}/services/${id}`,
          { ownerTeamId: fx.platformA, criticality: 'LOW' },
        ],
        ['delete', `${fx.orgA}/services/${id}`, undefined],
      ];

      for (const [method, path, body] of attempts) {
        expectCode(
          await call(method, path, fx.dave, body),
          403,
          'PERMISSION_DENIED',
        );
      }

      expect(await prisma.service.findUniqueOrThrow({ where: { id } })).toEqual(
        before,
      );
      expect(await prisma.service.count()).toBe(1);
    });

    it('should grant a member of the owning team nothing', async () => {
      // Dave is on Payments; Payments owns the service; Dave is a MEMBER.
      await prisma.teamMembership.create({
        data: {
          organizationId: fx.orgA,
          teamId: fx.paymentsA,
          membershipId: (
            await prisma.membership.findFirstOrThrow({
              where: { organizationId: fx.orgA, userId: fx.dave },
            })
          ).id,
        },
      });
      const { id } = await aService(fx.orgA, fx.paymentsA, 'Payment API');

      expectCode(
        await call('patch', `${fx.orgA}/services/${id}`, fx.dave, {
          criticality: 'LOW',
        }),
        403,
        'PERMISSION_DENIED',
      );
    });

    it('should judge one token by the role it holds in each organization', async () => {
      expect(
        (
          await call('post', `${fx.orgA}/services`, fx.carol, {
            name: 'Payment API',
            ownerTeamId: fx.paymentsA,
          })
        ).status,
      ).toBe(201);
      expectCode(
        await call('post', `${fx.orgB}/services`, fx.carol, {
          name: 'Payment API',
          ownerTeamId: fx.paymentsB,
        }),
        403,
        'PERMISSION_DENIED',
      );
    });

    it('should answer a non-member with admission’s 404', async () => {
      expectCode(
        await call('get', `${fx.orgA}/services`, fx.bob),
        404,
        'ORGANIZATION_NOT_FOUND',
      );
    });
  });

  describe('tenant isolation', () => {
    it('should answer a foreign service exactly as a nonexistent one, on every route', async () => {
      const foreign = await aService(fx.orgB, fx.paymentsB, 'Bravo Ledger');
      const before = await prisma.service.findUniqueOrThrow({
        where: { id: foreign.id },
      });
      const missing = randomUUID();

      const routes: ['get' | 'patch' | 'delete', object | undefined][] = [
        ['get', undefined],
        ['patch', { name: 'Hijacked' }],
        ['patch', { ownerTeamId: fx.paymentsA }],
        ['delete', undefined],
      ];

      for (const [method, body] of routes) {
        const toForeign = await call(
          method,
          `${fx.orgA}/services/${foreign.id}`,
          fx.alice,
          body,
        );
        const toMissing = await call(
          method,
          `${fx.orgA}/services/${missing}`,
          fx.alice,
          body,
        );

        expectCode(toForeign, 404, 'SERVICE_NOT_FOUND');
        expect(comparable(toForeign.body)).toEqual(comparable(toMissing.body));
      }

      // Carol is a member of B too, but was admitted to A for this request.
      expectCode(
        await call('get', `${fx.orgA}/services/${foreign.id}`, fx.carol),
        404,
        'SERVICE_NOT_FOUND',
      );

      expect(
        await prisma.service.findUniqueOrThrow({ where: { id: foreign.id } }),
      ).toEqual(before);
    });

    it('should answer a foreign owning team exactly as a nonexistent one, on create and on reassign', async () => {
      const { id } = await aService(fx.orgA, fx.paymentsA, 'Payment API');
      const missing = randomUUID();

      for (const [method, path, body] of [
        ['post', `${fx.orgA}/services`, { name: 'Ledger' }],
        ['patch', `${fx.orgA}/services/${id}`, {}],
      ] as const) {
        const toForeign = await call(method, path, fx.alice, {
          ...body,
          ownerTeamId: fx.paymentsB,
        });
        const toMissing = await call(method, path, fx.alice, {
          ...body,
          ownerTeamId: missing,
        });

        expectCode(toForeign, 404, 'TEAM_NOT_FOUND');
        expect(comparable(toForeign.body)).toEqual(comparable(toMissing.body));
      }

      expect(await prisma.service.count()).toBe(1);
      expect(
        (await prisma.service.findUniqueOrThrow({ where: { id } })).ownerTeamId,
      ).toBe(fx.paymentsA);
    });

    it('should refuse a body that names an organization, slug, or id', async () => {
      for (const extra of [
        { organizationId: fx.orgB },
        { slug: 'chosen' },
        { id: randomUUID() },
      ]) {
        expect(
          (
            await call('post', `${fx.orgA}/services`, fx.alice, {
              name: 'Payment API',
              ownerTeamId: fx.paymentsA,
              ...extra,
            })
          ).status,
        ).toBe(400);
      }

      expect(await prisma.service.count()).toBe(0);
    });

    it('should isolate in the service itself, with no guard in front of it', async () => {
      const services = app.get(ServicesService);
      const foreign = await aService(fx.orgB, fx.paymentsB, 'Bravo Ledger');
      const own = await aService(fx.orgA, fx.paymentsA, 'Payment API');

      for (const attempt of [
        () => services.get(fx.orgA, foreign.id),
        () =>
          services.update(fx.orgA, foreign.id, { name: 'Hijacked' }, fx.alice),
        () => services.delete(fx.orgA, foreign.id, fx.alice),
        () =>
          services.create(
            fx.orgA,
            {
              name: 'Ledger',
              ownerTeamId: fx.paymentsB,
            },
            fx.alice,
          ),
        () =>
          services.update(
            fx.orgA,
            own.id,
            { ownerTeamId: fx.paymentsB },
            fx.alice,
          ),
      ]) {
        await expect(attempt()).rejects.toBeInstanceOf(HttpException);
      }

      expect(await prisma.service.count()).toBe(2);
      expect(
        (await prisma.service.findUniqueOrThrow({ where: { id: own.id } }))
          .ownerTeamId,
      ).toBe(fx.paymentsA);
    });

    it('should answer malformed ids with 404 in a path and 400 in a body, never 500', async () => {
      expectCode(
        await call('get', `${fx.orgA}/services/not-a-uuid`, fx.alice),
        404,
        'SERVICE_NOT_FOUND',
      );
      expect(
        (
          await call('post', `${fx.orgA}/services`, fx.alice, {
            name: 'Payment API',
            ownerTeamId: 'not-a-uuid',
          })
        ).status,
      ).toBe(400);
    });
  });

  describe('soft deletion', () => {
    it('should make every service route of a soft-deleted organization unreachable', async () => {
      const { id } = await aService(fx.orgA, fx.paymentsA, 'Payment API');
      await prisma.organization.update({
        where: { id: fx.orgA },
        data: { deletedAt: new Date() },
      });

      expectCode(
        await call('get', `${fx.orgA}/services/${id}`, fx.alice),
        404,
        'ORGANIZATION_NOT_FOUND',
      );
      expect(await prisma.service.count()).toBe(1);
    });
  });

  describe('constraint mapping against the real driver adapter', () => {
    it('should name the owner key when it refuses a row', async () => {
      const failure = (promise: Promise<unknown>) =>
        promise.then(
          () => undefined,
          (error: unknown) => error,
        );

      expect(
        foreignKeyViolationHint(
          await failure(aService(fx.orgA, fx.paymentsB, 'Payment API')),
        ),
      ).toContain('owner_team');

      await aService(fx.orgA, fx.paymentsA, 'Payment API');

      expect(
        foreignKeyViolationHint(
          await failure(
            prisma.team.deleteMany({ where: { id: fx.paymentsA } }),
          ),
        ),
      ).toContain('owner_team');
    });
  });

  describe('concurrency', () => {
    it('should let exactly one of several concurrent creates of one name succeed', async () => {
      const statuses = (
        await Promise.all(
          ['Payment API', 'payment api', 'Payment-API!', 'PAYMENT API'].map(
            (name) =>
              call('post', `${fx.orgA}/services`, fx.alice, {
                name,
                ownerTeamId: fx.paymentsA,
              }),
          ),
        )
      )
        .map((response) => response.status)
        .sort();

      expect(statuses).toEqual([201, 409, 409, 409]);
      expect(await prisma.service.count()).toBe(1);
    });

    it('should resolve a create racing its team’s deletion without a 500 or an orphan', async () => {
      for (let round = 0; round < 5; round += 1) {
        const teamId = await aTeam(fx.orgA, `Checkout ${round}`);

        const [created, deleted] = await Promise.all([
          call('post', `${fx.orgA}/services`, fx.alice, {
            name: `Checkout ${round}`,
            ownerTeamId: teamId,
          }),
          call('delete', `${fx.orgA}/teams/${teamId}`, fx.carol),
        ]);

        // Either the service lands first and the team is refused, or the
        // team goes first and the service is refused.
        expect([
          [201, 409],
          [404, 204],
        ]).toContainEqual([created.status, deleted.status]);

        if (created.status === 404) {
          expect(created.body.code).toBe('TEAM_NOT_FOUND');
        } else {
          expect(deleted.body.code).toBe('TEAM_OWNS_SERVICES');
        }
      }

      // Every surviving service still has an owner in its own organization.
      const orphans = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
        `SELECT count(*) FROM services s
         LEFT JOIN teams t
           ON t.id = s.owner_team_id AND t.organization_id = s.organization_id
         WHERE t.id IS NULL`,
      );

      expect(Number(orphans[0].count)).toBe(0);
    });

    it('should resolve a reassignment racing the new team’s deletion without a 500', async () => {
      const { id } = await aService(fx.orgA, fx.paymentsA, 'Payment API');

      for (let round = 0; round < 5; round += 1) {
        const teamId = await aTeam(fx.orgA, `Target ${round}`);

        const [moved, deleted] = await Promise.all([
          call('patch', `${fx.orgA}/services/${id}`, fx.alice, {
            ownerTeamId: teamId,
          }),
          call('delete', `${fx.orgA}/teams/${teamId}`, fx.carol),
        ]);

        expect([
          [200, 409],
          [404, 204],
        ]).toContainEqual([moved.status, deleted.status]);

        if (moved.status === 200) {
          // Put it back so the next round starts from the same place.
          await prisma.service.update({
            where: { id },
            data: { ownerTeamId: fx.paymentsA },
          });
        }
      }
    });
  });
});
