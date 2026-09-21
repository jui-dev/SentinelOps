import { randomUUID } from 'node:crypto';
import { INestApplication, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from './../src/app.module.js';
import { TokenService } from './../src/auth/token.service.js';
import { PrismaService } from './../src/database/prisma.service.js';
import { OrganizationsService } from './../src/organizations/organizations.service.js';
import { TenancyErrorCode } from './../src/tenancy/tenancy.errors.js';
import { leakedKeys } from './leaks.js';
import { resolveTestDatabaseUrl } from './test-database.js';

/**
 * Authorization against a real database.
 *
 * Three layers, each proven here to hold on its own terms:
 *
 *   admission      — a caller outside the organization gets 404, never 403;
 *   authorization  — an admitted member whose role lacks the permission gets
 *                    403, and the row is untouched;
 *   isolation      — the rename reaches only the organization in the path,
 *                    even when the service is called with no guard at all.
 *
 * The fixture reuses the tenancy suite's shape — two tenants, and Carol, who
 * is ADMIN in A and MEMBER in B — so one access token carries a caller who is
 * allowed in one organization and refused in the other. Dave is a plain
 * MEMBER of A.
 */

interface Fixture {
  orgA: { id: string };
  orgB: { id: string };
  alice: { id: string };
  bob: { id: string };
  carol: { id: string };
  dave: { id: string };
  aliceInA: string;
  carolInA: string;
  daveInA: string;
  bobInB: string;
  carolInB: string;
}

type Role = 'ADMIN' | 'MEMBER';

const comparable = (body: Record<string, unknown>) => {
  const {
    requestId: _requestId,
    timestamp: _timestamp,
    path: _path,
    ...rest
  } = body;

  return rest;
};

/** What the role-to-permission table grants, as the API reports it: sorted. */
const FULL_PERMISSIONS: readonly string[] = [
  'incidents:manage',
  'incidents:read',
  'incidents:respond',
  'invitations:manage',
  'invitations:read',
  'members:manage',
  'memberships:read',
  'notifications:read',
  'organization:read',
  'organization:update',
  'services:manage',
  'services:read',
  'teams:manage',
  'teams:read',
];
/** What a MEMBER holds: every read, incident response, and its own notifications. */
const MEMBER_PERMISSIONS: readonly string[] = [
  'incidents:read',
  'incidents:respond',
  'memberships:read',
  'notifications:read',
  'organization:read',
  'services:read',
  'teams:read',
];

describe('authorization (integration)', () => {
  const prisma = new PrismaService({ url: resolveTestDatabaseUrl() });
  let app: INestApplication;
  let tokens: TokenService;
  let fx: Fixture;

  /** Every response this suite receives is walked for persistence internals. */
  const checked = (response: request.Response): request.Response => {
    expect(leakedKeys(response.body)).toEqual([]);

    return response;
  };

  const tokenFor = (userId: string) => tokens.signAccessToken(userId);

  const rename = async (
    organizationId: string,
    userId: string,
    body: unknown = { name: 'Renamed Operations' },
    token?: string,
  ): Promise<request.Response> =>
    checked(
      await request(app.getHttpServer())
        .patch(`/api/v1/organizations/${organizationId}`)
        .set('Authorization', `Bearer ${token ?? (await tokenFor(userId))}`)
        .send(body as object),
    );

  const read = async (
    organizationId: string,
    token: string,
  ): Promise<request.Response> =>
    checked(
      await request(app.getHttpServer())
        .get(`/api/v1/organizations/${organizationId}`)
        .set('Authorization', `Bearer ${token}`),
    );

  /** The persisted columns a refused or failed rename must leave alone. */
  const stateOf = (organizationId: string) =>
    prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { name: true, slug: true, updatedAt: true, deletedAt: true },
    });

  const setRole = (membershipId: string, role: Role) =>
    prisma.membership.update({ where: { id: membershipId }, data: { role } });

  const expectDenied = (response: request.Response) => {
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      statusCode: 403,
      code: 'PERMISSION_DENIED',
      message: 'You do not have permission to perform this action',
    });
  };

  const seed = async (): Promise<Fixture> => {
    const organization = (name: string, slug: string) =>
      prisma.organization.create({
        data: { name, slug },
        select: { id: true },
      });
    const user = (email: string, name: string) =>
      prisma.user.create({ data: { email, name }, select: { id: true } });
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
      aliceInA: await grant(orgA.id, alice.id, 'ADMIN'),
      bobInB: await grant(orgB.id, bob.id, 'ADMIN'),
      carolInA: await grant(orgA.id, carol.id, 'ADMIN'),
      carolInB: await grant(orgB.id, carol.id, 'MEMBER'),
      daveInA: await grant(orgA.id, dave.id, 'MEMBER'),
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

  afterAll(async () => {
    await app.close();
  });

  describe('permitted roles', () => {
    it('should let an ADMIN rename the organization', async () => {
      const before = await stateOf(fx.orgA.id);
      const response = await rename(fx.orgA.id, fx.alice.id, {
        name: '  Acme Incident Response  ',
      });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        id: fx.orgA.id,
        name: 'Acme Incident Response',
        slug: 'acme-operations',
        createdAt: expect.any(String),
      });

      const after = await stateOf(fx.orgA.id);

      expect(after.name).toBe('Acme Incident Response');
      expect(after.slug).toBe('acme-operations');
      expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(
        before.updatedAt.getTime(),
      );
    });

    it('should let an ADMIN rename the organization', async () => {
      const response = await rename(fx.orgA.id, fx.carol.id);

      expect(response.status).toBe(200);
      expect((await stateOf(fx.orgA.id)).name).toBe('Renamed Operations');
    });
  });

  describe('refused roles', () => {
    it('should refuse a MEMBER with 403 and leave the row untouched', async () => {
      const before = await stateOf(fx.orgA.id);

      expectDenied(await rename(fx.orgA.id, fx.dave.id));
      expect(await stateOf(fx.orgA.id)).toEqual(before);
    });

    it('should judge one token by the role it holds in each organization', async () => {
      // Carol: ADMIN in A, MEMBER in B. Same token for both requests — the
      // role is not in it.
      const token = await tokenFor(fx.carol.id);
      const bBefore = await stateOf(fx.orgB.id);

      expect(
        (await rename(fx.orgA.id, fx.carol.id, undefined, token)).status,
      ).toBe(200);
      expectDenied(await rename(fx.orgB.id, fx.carol.id, undefined, token));
      expect(await stateOf(fx.orgB.id)).toEqual(bBefore);
    });

    it('should not be talked into a better role by the request', async () => {
      const before = await stateOf(fx.orgA.id);

      const response = checked(
        await request(app.getHttpServer())
          .patch(`/api/v1/organizations/${fx.orgA.id}?role=ADMIN`)
          .set('Authorization', `Bearer ${await tokenFor(fx.dave.id)}`)
          .set('X-Role', 'ADMIN')
          .send({ name: 'Renamed', role: 'ADMIN' }),
      );

      expectDenied(response);
      expect(await stateOf(fx.orgA.id)).toEqual(before);
    });
  });

  describe('admission still answers first', () => {
    it("should answer another tenant's ADMIN with 404, not 403", async () => {
      const before = await stateOf(fx.orgA.id);
      const foreign = await rename(fx.orgA.id, fx.bob.id);
      const missing = await rename(randomUUID(), fx.bob.id);

      expect(foreign.status).toBe(404);
      expect(foreign.body.code).toBe('ORGANIZATION_NOT_FOUND');
      expect(comparable(foreign.body)).toEqual(comparable(missing.body));
      expect(await stateOf(fx.orgA.id)).toEqual(before);
    });

    it('should answer 404 once the membership is revoked, with the same token', async () => {
      const token = await tokenFor(fx.carol.id);

      await prisma.membership.delete({ where: { id: fx.carolInA } });

      const response = await rename(fx.orgA.id, fx.carol.id, undefined, token);

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('ORGANIZATION_NOT_FOUND');
    });

    it('should answer 404 for a soft-deleted organization, even to its ADMIN', async () => {
      await prisma.organization.update({
        where: { id: fx.orgA.id },
        data: { deletedAt: new Date() },
      });
      const before = await stateOf(fx.orgA.id);

      const response = await rename(fx.orgA.id, fx.alice.id);

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('ORGANIZATION_NOT_FOUND');
      expect(await stateOf(fx.orgA.id)).toEqual(before);
    });
  });

  describe('role changes', () => {
    it('should apply a demotion on the very next request, with the same token', async () => {
      const token = await tokenFor(fx.carol.id);

      expect(
        (await rename(fx.orgA.id, fx.carol.id, { name: 'First' }, token))
          .status,
      ).toBe(200);

      await setRole(fx.carolInA, 'MEMBER');

      expectDenied(
        await rename(fx.orgA.id, fx.carol.id, { name: 'Second' }, token),
      );
      expect((await stateOf(fx.orgA.id)).name).toBe('First');
    });

    it('should apply a promotion on the very next request, with the same token', async () => {
      const token = await tokenFor(fx.dave.id);

      expectDenied(await rename(fx.orgA.id, fx.dave.id, undefined, token));

      await setRole(fx.daveInA, 'ADMIN');

      expect(
        (await rename(fx.orgA.id, fx.dave.id, undefined, token)).status,
      ).toBe(200);
    });

    it('should report the permissions of the current role on the next read', async () => {
      const token = await tokenFor(fx.dave.id);

      const before = await read(fx.orgA.id, token);

      expect(before.status).toBe(200);
      expect(before.body.membership.permissions).toEqual(MEMBER_PERMISSIONS);

      await setRole(fx.daveInA, 'ADMIN');

      const after = await read(fx.orgA.id, token);

      expect(after.status).toBe(200);
      expect(after.body.membership).toEqual({
        id: fx.daveInA,
        role: 'ADMIN',
        permissions: FULL_PERMISSIONS,
      });
    });
  });

  describe('advertised permissions', () => {
    it.each([
      ['ADMIN', 'carol', FULL_PERMISSIONS],
      ['MEMBER', 'dave', MEMBER_PERMISSIONS],
    ] as const)(
      'should tell an %s what the API will let them do',
      async (_role, who, expected) => {
        const token = await tokenFor(fx[who].id);
        const response = await read(fx.orgA.id, token);

        expect(response.status).toBe(200);
        expect(response.body.membership.permissions).toEqual(expected);

        // The advice and the enforcement agree.
        const renamed = await rename(fx.orgA.id, fx[who].id, undefined, token);

        expect(renamed.status).toBe(
          expected.includes('organization:update') ? 200 : 403,
        );
      },
    );
  });

  describe('the request body', () => {
    it('should refuse a body that tries to change more than the name', async () => {
      const before = await stateOf(fx.orgA.id);

      for (const extra of [
        { slug: 'hijacked' },
        { organizationId: fx.orgB.id },
        { deletedAt: new Date().toISOString() },
      ]) {
        const response = await rename(fx.orgA.id, fx.alice.id, {
          name: 'Renamed',
          ...extra,
        });

        expect(response.status).toBe(400);
      }

      expect(await stateOf(fx.orgA.id)).toEqual(before);
      expect((await stateOf(fx.orgB.id)).deletedAt).toBeNull();
    });
  });

  describe('the update itself, with no guard in front of it', () => {
    // These call the service directly. They prove isolation does not depend
    // on authorization, and they prove the Prisma update-miss mapping against
    // the real driver adapter rather than a mock.
    const service = () => app.get(OrganizationsService);

    const notFound = async (promise: Promise<unknown>) => {
      const error = await promise.then(
        () => undefined,
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).errorCode).toBe(
        TenancyErrorCode.ORGANIZATION_NOT_FOUND,
      );
    };

    it('should rename only the organization it is given', async () => {
      const bBefore = await stateOf(fx.orgB.id);

      await service().updateOrganization(fx.orgA.id, { name: 'Only A' });

      expect((await stateOf(fx.orgA.id)).name).toBe('Only A');
      expect(await stateOf(fx.orgB.id)).toEqual(bBefore);
    });

    it('should answer the organization 404 for a soft-deleted organization and write nothing', async () => {
      await prisma.organization.update({
        where: { id: fx.orgA.id },
        data: { deletedAt: new Date() },
      });
      const before = await stateOf(fx.orgA.id);

      await notFound(
        service().updateOrganization(fx.orgA.id, { name: 'Resurrected' }),
      );

      expect(await stateOf(fx.orgA.id)).toEqual(before);
    });

    it('should answer the organization 404 for an id that names nothing', async () => {
      await notFound(
        service().updateOrganization(randomUUID(), { name: 'Nobody' }),
      );

      expect(await prisma.organization.count()).toBe(2);
    });
  });

  describe('concurrency', () => {
    it('should keep one caller allowed in one organization and refused in the other when interleaved', async () => {
      const token = await tokenFor(fx.carol.id);
      const bBefore = await stateOf(fx.orgB.id);
      const names = Array.from({ length: 20 }, (_, index) => `Acme ${index}`);

      const results = await Promise.all(
        names.map((name, index) =>
          index % 2 === 0
            ? rename(fx.orgA.id, fx.carol.id, { name }, token).then(
                (response) => ({ organization: 'A', response }),
              )
            : rename(fx.orgB.id, fx.carol.id, { name }, token).then(
                (response) => ({ organization: 'B', response }),
              ),
        ),
      );

      for (const { organization, response } of results) {
        if (organization === 'A') {
          expect(response.status).toBe(200);
          expect(response.body.id).toBe(fx.orgA.id);
        } else {
          expectDenied(response);
        }
      }

      expect(await stateOf(fx.orgB.id)).toEqual(bBefore);
      expect(names.filter((_, index) => index % 2 === 0)).toContain(
        (await stateOf(fx.orgA.id)).name,
      );
    });

    it('should keep two roles in the same organization apart when interleaved', async () => {
      const [owner, member] = await Promise.all([
        tokenFor(fx.alice.id),
        tokenFor(fx.dave.id),
      ]);

      const results = await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          index % 2 === 0
            ? rename(
                fx.orgA.id,
                fx.alice.id,
                { name: `Owner ${index}` },
                owner,
              ).then((response) => ({ allowed: true, response }))
            : rename(
                fx.orgA.id,
                fx.dave.id,
                { name: `Member ${index}` },
                member,
              ).then((response) => ({ allowed: false, response })),
        ),
      );

      for (const { allowed, response } of results) {
        if (allowed) {
          expect(response.status).toBe(200);
        } else {
          expectDenied(response);
        }
      }

      expect((await stateOf(fx.orgA.id)).name).toMatch(/^Owner \d+$/);
    });

    it('should report each organization with its own role when reads interleave', async () => {
      const token = await tokenFor(fx.carol.id);

      const results = await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          index % 2 === 0
            ? read(fx.orgA.id, token).then((response) => ({
                expected: {
                  id: fx.carolInA,
                  role: 'ADMIN',
                  permissions: FULL_PERMISSIONS,
                },
                response,
              }))
            : read(fx.orgB.id, token).then((response) => ({
                expected: {
                  id: fx.carolInB,
                  role: 'MEMBER',
                  permissions: MEMBER_PERMISSIONS,
                },
                response,
              })),
        ),
      );

      for (const { expected, response } of results) {
        expect(response.status).toBe(200);
        expect(response.body.membership).toEqual(expected);
      }
    });
  });
});
