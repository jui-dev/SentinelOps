import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from './../src/app.module.js';
import { TokenService } from './../src/auth/token.service.js';
import { getRequestOrganization } from './../src/common/request-context.js';
import { PrismaService } from './../src/database/prisma.service.js';
import { OrganizationsService } from './../src/organizations/organizations.service.js';
import { leakedKeys } from './leaks.js';
import { resolveTestDatabaseUrl } from './test-database.js';

/**
 * Tenant isolation against a real database.
 *
 * Two properties, tested separately because neither implies the other:
 *
 *   admission  — a caller reaches an organization only through a current
 *                membership of it;
 *   isolation  — a caller admitted to one organization still cannot reach a
 *                row that belongs to another, whatever id they put in the URL.
 *
 * The fixture is two tenants and a user who belongs to both, which is what
 * makes the isolation tests meaningful: Carol is legitimately admitted to A and
 * legitimately owns a membership id in B, and must still not be able to read
 * the one through the other.
 *
 * Access tokens are minted directly with TokenService. Login is covered by
 * auth.integration-spec.ts and adds nothing here but Argon2 time.
 */

interface Fixture {
  orgA: { id: string; name: string; slug: string };
  orgB: { id: string; name: string; slug: string };
  alice: { id: string; email: string; name: string };
  bob: { id: string; email: string; name: string };
  carol: { id: string; email: string; name: string };
  aliceInA: string;
  carolInA: string;
  bobInB: string;
  carolInB: string;
}

/** The parts of an error body that legitimately differ between two requests. */
const comparable = (body: Record<string, unknown>) => {
  const {
    requestId: _requestId,
    timestamp: _timestamp,
    path: _path,
    ...rest
  } = body;

  return rest;
};

describe('tenancy (integration)', () => {
  const prisma = new PrismaService({ url: resolveTestDatabaseUrl() });
  let app: INestApplication;
  let tokens: TokenService;
  let fx: Fixture;

  /**
   * A GET as the given user. Every response this suite receives — success or
   * error — is walked for persistence internals on the way past.
   */
  const get = async (
    path: string,
    userId: string,
    headers: Record<string, string> = {},
  ): Promise<request.Response> => {
    let pending = request(app.getHttpServer())
      .get(`/api/v1${path}`)
      .set('Authorization', `Bearer ${await tokens.signAccessToken(userId)}`);

    for (const [name, value] of Object.entries(headers)) {
      pending = pending.set(name, value);
    }

    const response = await pending;

    expect(leakedKeys(response.body)).toEqual([]);

    return response;
  };

  const seed = async (): Promise<Fixture> => {
    const orgA = await prisma.organization.create({
      data: { name: 'Acme Operations', slug: 'acme-operations' },
      select: { id: true, name: true, slug: true },
    });
    const orgB = await prisma.organization.create({
      data: { name: 'Bravo Reliability', slug: 'bravo-reliability' },
      select: { id: true, name: true, slug: true },
    });

    const user = (email: string, name: string) =>
      prisma.user.create({
        data: { email, name },
        select: { id: true, email: true, name: true },
      });

    const alice = await user('alice@acme.example', 'Alice Anders');
    const bob = await user('bob@bravo.example', 'Bob Brandt');
    const carol = await user('carol@both.example', 'Carol Chen');

    // Created one at a time, so createdAt ordering is deterministic.
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

    const aliceInA = await grant(orgA.id, alice.id, 'ADMIN');
    const bobInB = await grant(orgB.id, bob.id, 'ADMIN');
    const carolInA = await grant(orgA.id, carol.id, 'ADMIN');
    const carolInB = await grant(orgB.id, carol.id, 'MEMBER');

    return {
      orgA,
      orgB,
      alice,
      bob,
      carol,
      aliceInA,
      carolInA,
      bobInB,
      carolInB,
    };
  };

  /** Every identifying value of tenant B that must never surface in A. */
  const tenantBMarkers = () => [
    fx.orgB.id,
    fx.orgB.name,
    fx.orgB.slug,
    fx.bob.id,
    fx.bob.email,
    fx.bob.name,
    fx.bobInB,
    fx.carolInB,
  ];

  const expectNoTenantB = (body: unknown) => {
    const serialized = JSON.stringify(body);

    for (const marker of tenantBMarkers()) {
      expect(serialized).not.toContain(marker);
    }
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

  describe('admission', () => {
    it('should admit a member to their organization', async () => {
      const response = await get(`/organizations/${fx.orgA.id}`, fx.alice.id);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        id: fx.orgA.id,
        name: 'Acme Operations',
        slug: 'acme-operations',
        createdAt: expect.any(String),
        membership: {
          id: fx.aliceInA,
          role: 'ADMIN',
          permissions: [
            'incidents:manage',
            'incidents:read',
            'incidents:respond',
            'invitations:manage',
            'invitations:read',
            'members:manage',
            'memberships:read',
            'organization:read',
            'organization:update',
            'services:manage',
            'services:read',
            'teams:manage',
            'teams:read',
          ],
        },
      });
    });

    it.each(['', '/memberships'])(
      'should answer 404 to a non-member on /organizations/:organizationId%s',
      async (suffix) => {
        const response = await get(
          `/organizations/${fx.orgB.id}${suffix}`,
          fx.alice.id,
        );

        expect(response.status).toBe(404);
        expect(response.body.code).toBe('ORGANIZATION_NOT_FOUND');
        expectNoTenantB(comparable(response.body));
      },
    );

    it("should answer 404 to a non-member on another tenant's membership route", async () => {
      const response = await get(
        `/organizations/${fx.orgB.id}/memberships/${fx.bobInB}`,
        fx.alice.id,
      );

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('ORGANIZATION_NOT_FOUND');
    });

    it('should answer an existing foreign organization exactly as a nonexistent one', async () => {
      // A 403, or any difference at all, would confirm that B exists.
      const foreign = await get(`/organizations/${fx.orgB.id}`, fx.alice.id);
      const missing = await get(`/organizations/${randomUUID()}`, fx.alice.id);

      expect(foreign.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(comparable(foreign.body)).toEqual(comparable(missing.body));
    });

    it('should answer a malformed organization id with the same 404, not a 500', async () => {
      const malformed = await get('/organizations/not-a-uuid', fx.alice.id);
      const foreign = await get(`/organizations/${fx.orgB.id}`, fx.alice.id);

      expect(malformed.status).toBe(404);
      expect(comparable(malformed.body)).toEqual(comparable(foreign.body));
    });

    it('should give a user in two organizations the right role in each', async () => {
      const inA = await get(`/organizations/${fx.orgA.id}`, fx.carol.id);
      const inB = await get(`/organizations/${fx.orgB.id}`, fx.carol.id);

      expect(inA.body.membership).toMatchObject({
        id: fx.carolInA,
        role: 'ADMIN',
      });
      expect(inB.body.membership).toMatchObject({
        id: fx.carolInB,
        role: 'MEMBER',
      });
    });
  });

  describe('resource isolation', () => {
    it("should not serve another tenant's membership to a caller admitted to this one", async () => {
      // Carol passes admission to A, and owns this membership id in B. The
      // lookup must still scope by A and find nothing.
      const response = await get(
        `/organizations/${fx.orgA.id}/memberships/${fx.carolInB}`,
        fx.carol.id,
      );

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('MEMBERSHIP_NOT_FOUND');
      // `path` echoes the URL the caller sent, id included; that discloses
      // nothing they did not already supply. Everything else must be silent.
      expectNoTenantB(comparable(response.body));
    });

    it("should not serve a stranger's foreign membership either", async () => {
      const response = await get(
        `/organizations/${fx.orgA.id}/memberships/${fx.bobInB}`,
        fx.alice.id,
      );

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('MEMBERSHIP_NOT_FOUND');
    });

    it('should answer a foreign membership id exactly as a nonexistent one', async () => {
      const foreign = await get(
        `/organizations/${fx.orgA.id}/memberships/${fx.bobInB}`,
        fx.alice.id,
      );
      const missing = await get(
        `/organizations/${fx.orgA.id}/memberships/${randomUUID()}`,
        fx.alice.id,
      );
      const malformed = await get(
        `/organizations/${fx.orgA.id}/memberships/not-a-uuid`,
        fx.alice.id,
      );

      expect(comparable(foreign.body)).toEqual(comparable(missing.body));
      expect(comparable(malformed.body)).toEqual(comparable(missing.body));
    });

    it('should serve a membership that does belong to the organization', async () => {
      const response = await get(
        `/organizations/${fx.orgA.id}/memberships/${fx.carolInA}`,
        fx.alice.id,
      );

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        id: fx.carolInA,
        role: 'ADMIN',
        createdAt: expect.any(String),
        user: {
          id: fx.carol.id,
          name: 'Carol Chen',
          email: 'carol@both.example',
          passwordChangeRequired: false,
        },
        teams: [],
      });
    });

    it("should list only the organization's own memberships, oldest first", async () => {
      const response = await get(
        `/organizations/${fx.orgA.id}/memberships`,
        fx.alice.id,
      );

      expect(response.status).toBe(200);
      expect(response.body.map((m: { id: string }) => m.id)).toEqual([
        fx.aliceInA,
        fx.carolInA,
      ]);
      expect(response.body.map((m: { role: string }) => m.role)).toEqual([
        'ADMIN',
        'ADMIN',
      ]);
    });

    it("should not reveal a shared member's other organizations", async () => {
      const response = await get(
        `/organizations/${fx.orgA.id}/memberships`,
        fx.alice.id,
      );

      expectNoTenantB(response.body);
      expect(Object.keys(response.body[1].user).sort()).toEqual([
        'email',
        'id',
        'name',
        'passwordChangeRequired',
      ]);
    });

    it('should isolate in the service itself, with no guard and no request context', async () => {
      // Admission never ran here. If isolation depended on it — or on the
      // ambient context — these calls would leak.
      const organizations = app.get(OrganizationsService);

      expect(getRequestOrganization()).toBeUndefined();

      const listed = await organizations.listMemberships(fx.orgA.id);

      expect(listed.map((m) => m.id)).toEqual([fx.aliceInA, fx.carolInA]);
      expectNoTenantB(listed);

      await expect(
        organizations.getMembership(fx.orgA.id, fx.carolInB),
      ).rejects.toMatchObject({ errorCode: 'MEMBERSHIP_NOT_FOUND' });

      // The row exists: scoping, not absence, is what refused it.
      await expect(
        organizations.getMembership(fx.orgB.id, fx.carolInB),
      ).resolves.toMatchObject({ id: fx.carolInB, role: 'MEMBER' });
    });
  });

  describe('tenant identity comes only from the route', () => {
    it('should ignore an organization named in the query string or a header', async () => {
      const response = await get(
        `/organizations/${fx.orgA.id}/memberships?organizationId=${fx.orgB.id}`,
        fx.alice.id,
        { 'X-Organization-Id': fx.orgB.id },
      );

      expect(response.status).toBe(200);
      expect(response.body.map((m: { id: string }) => m.id)).toEqual([
        fx.aliceInA,
        fx.carolInA,
      ]);
      expectNoTenantB(response.body);
    });

    it('should not let a spoofed organization grant admission', async () => {
      // Bob is a member of B only. Naming B everywhere except the path does not
      // get him into A.
      const response = await get(
        `/organizations/${fx.orgA.id}?organizationId=${fx.orgB.id}`,
        fx.bob.id,
        { 'X-Organization-Id': fx.orgB.id },
      );

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('ORGANIZATION_NOT_FOUND');
    });
  });

  describe('revocation', () => {
    it('should refuse the very next request once a membership is removed, with the same token', async () => {
      const token = await tokens.signAccessToken(fx.alice.id);
      const read = () =>
        request(app.getHttpServer())
          .get(`/api/v1/organizations/${fx.orgA.id}`)
          .set('Authorization', `Bearer ${token}`);

      await read().expect(200);

      await prisma.membership.delete({ where: { id: fx.aliceInA } });

      const response = await read().expect(404);

      expect(response.body.code).toBe('ORGANIZATION_NOT_FOUND');
    });

    it('should leave access to other organizations untouched', async () => {
      await prisma.membership.delete({ where: { id: fx.carolInA } });

      expect(
        (await get(`/organizations/${fx.orgA.id}`, fx.carol.id)).status,
      ).toBe(404);
      expect(
        (await get(`/organizations/${fx.orgB.id}`, fx.carol.id)).status,
      ).toBe(200);
    });
  });

  describe('soft deletion', () => {
    it('should refuse every route of a soft-deleted organization', async () => {
      await prisma.organization.update({
        where: { id: fx.orgA.id },
        data: { deletedAt: new Date() },
      });

      for (const suffix of [
        '',
        '/memberships',
        `/memberships/${fx.carolInA}`,
      ]) {
        const response = await get(
          `/organizations/${fx.orgA.id}${suffix}`,
          fx.alice.id,
        );

        expect(response.status).toBe(404);
        expect(response.body.code).toBe('ORGANIZATION_NOT_FOUND');
      }
    });

    it('should refuse a soft-deleted user on organization routes', async () => {
      // The JWT guard reads no database, so the token still verifies. Admission
      // is where the deleted account is caught.
      await prisma.user.update({
        where: { id: fx.alice.id },
        data: { deletedAt: new Date() },
      });

      const response = await get(`/organizations/${fx.orgA.id}`, fx.alice.id);

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('ORGANIZATION_NOT_FOUND');
    });

    it('should omit a soft-deleted member from listings and lookups', async () => {
      await prisma.user.update({
        where: { id: fx.alice.id },
        data: { deletedAt: new Date() },
      });

      const listed = await get(
        `/organizations/${fx.orgA.id}/memberships`,
        fx.carol.id,
      );

      expect(listed.body.map((m: { id: string }) => m.id)).toEqual([
        fx.carolInA,
      ]);

      const single = await get(
        `/organizations/${fx.orgA.id}/memberships/${fx.aliceInA}`,
        fx.carol.id,
      );

      expect(single.status).toBe(404);
      expect(single.body.code).toBe('MEMBERSHIP_NOT_FOUND');
    });
  });

  describe('concurrency', () => {
    it('should keep interleaved requests from two tenants in their own tenant', async () => {
      const aliceIds = [fx.aliceInA, fx.carolInA];
      const bobIds = [fx.bobInB, fx.carolInB];

      const responses = await Promise.all(
        Array.from({ length: 20 }, (_, index) =>
          index % 2 === 0
            ? get(`/organizations/${fx.orgA.id}/memberships`, fx.alice.id).then(
                (response) => ({ expected: aliceIds, response }),
              )
            : get(`/organizations/${fx.orgB.id}/memberships`, fx.bob.id).then(
                (response) => ({ expected: bobIds, response }),
              ),
        ),
      );

      for (const { expected, response } of responses) {
        expect(response.status).toBe(200);
        expect(response.body.map((m: { id: string }) => m.id)).toEqual(
          expected,
        );
      }
    });
  });
});
