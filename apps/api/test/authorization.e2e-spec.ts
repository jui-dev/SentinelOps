import { Controller, Get } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from './../src/app.module.js';
import { Public } from './../src/auth/public.decorator.js';
import { TokenService } from './../src/auth/token.service.js';
import { Permission } from './../src/authorization/permissions.js';
import { RequirePermission } from './../src/authorization/require-permission.decorator.js';
import { PrismaService } from './../src/database/prisma.service.js';
import { Prisma } from './../src/generated/prisma/client.js';
import type { Role } from './../src/generated/prisma/enums.js';
import { OrganizationController } from './../src/tenancy/organization-controller.decorator.js';
import { TenancyModule } from './../src/tenancy/tenancy.module.js';

/**
 * Authorization wired through the real AppModule, with Prisma mocked.
 *
 * What this suite proves without a database: where authorization sits relative
 * to authentication, admission, and body validation; that a member is refused
 * with 403 while every non-admitted caller still receives admission's 404; that
 * nothing in the request can raise a role; and that every wiring mistake fails
 * closed. Role changes taking effect, and interleaved requests in two roles,
 * are proven against real rows in authorization.integration-spec.ts.
 *
 * The probe controllers are declared here rather than in src/, so no test-only
 * route ships.
 */
const USER_ID = '0199a1b2-c3d4-7000-8000-000000000001';
const ORG_ID = '0199a1b2-c3d4-7000-8000-00000000000a';
const OTHER_ORG_ID = '0199a1b2-c3d4-7000-8000-00000000000b';
const MEMBERSHIP_ID = '0199a1b2-c3d4-7000-8000-0000000000aa';
const CREATED = new Date('2026-09-01T12:00:00.000Z');

/** An organization handler that forgot to declare a permission. */
@OrganizationController('undeclared-probe')
class UndeclaredPermissionProbeController {
  @Get()
  read(): { status: string } {
    return { status: 'reached' };
  }
}

/** A permission declared on a controller that admits no organization. */
@Controller('unscoped-permission-probe')
class UnscopedPermissionProbeController {
  @Get()
  @RequirePermission(Permission.ORGANIZATION_READ)
  read(): { status: string } {
    return { status: 'reached' };
  }

  @Public()
  @Get('public')
  @RequirePermission(Permission.ORGANIZATION_READ)
  readPublic(): { status: string } {
    return { status: 'reached' };
  }
}

const ROLES: Role[] = ['ADMIN', 'RESPONDER'];

describe('Authorization (e2e)', () => {
  let app: INestApplication;
  let tokens: TokenService;

  const prisma = {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    membership: { findFirst: vi.fn(), findMany: vi.fn() },
    organization: { findFirst: vi.fn(), update: vi.fn() },
    // The activity log: the actor's name, then the entry.
    user: { findUniqueOrThrow: vi.fn(async () => ({ name: 'Ada' })) },
    activityEntry: { create: vi.fn() },
  };

  /** Admission resolves the caller as `role` in ORG_ID, and nowhere else. */
  const admitAs = (role: Role) =>
    prisma.membership.findFirst.mockImplementation(
      (args: { where: Record<string, unknown> }) => {
        if (!('userId' in args.where)) {
          return {
            id: MEMBERSHIP_ID,
            role,
            createdAt: CREATED,
            user: { id: USER_ID, name: 'Ada', email: 'ada@example.com' },
            teamMemberships: [],
          };
        }

        return args.where.organizationId === ORG_ID
          ? {
              id: MEMBERSHIP_ID,
              organizationId: ORG_ID,
              role,
              user: { passwordChangeRequired: false },
            }
          : null;
      },
    );

  const bearer = async () => `Bearer ${await tokens.signAccessToken(USER_ID)}`;

  const patch = async (
    body: unknown = { name: 'Renamed Operations' },
    organizationId = ORG_ID,
  ) =>
    request(app.getHttpServer())
      .patch(`/api/v1/organizations/${organizationId}`)
      .set('Authorization', await bearer())
      .send(body as object);

  const expectDenied = (response: request.Response) => {
    expect(response.status).toBe(403);
    expect(response.body).toMatchObject({
      statusCode: 403,
      error: 'Forbidden',
      message: 'You do not have permission to perform this action',
      code: 'PERMISSION_DENIED',
    });
    expect(response.body).not.toHaveProperty('details');

    // `path` echoes the request, query string included; the rest is ours.
    const { path: _path, ...rest } = response.body as Record<string, unknown>;

    expect(JSON.stringify(rest)).not.toMatch(
      /organization:update|OWNER|ADMIN|MEMBER/,
    );
  };

  beforeEach(async () => {
    // A rename and its activity log entry share one transaction.
    prisma.$transaction.mockImplementation((work: (tx: unknown) => unknown) =>
      work(prisma),
    );

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule, TenancyModule],
      controllers: [
        UndeclaredPermissionProbeController,
        UnscopedPermissionProbeController,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('/api/v1');
    await app.init();

    tokens = app.get(TokenService);

    prisma.membership.findFirst.mockResolvedValue(null);
    prisma.membership.findMany.mockResolvedValue([]);
    prisma.organization.findFirst.mockResolvedValue({
      id: ORG_ID,
      name: 'Acme Operations',
      slug: 'acme-operations',
      createdAt: CREATED,
      isDemo: false,
    });
    prisma.organization.update.mockImplementation(
      (args: { data: { name: string } }) => ({
        id: ORG_ID,
        name: args.data.name,
        slug: 'acme-operations',
        createdAt: CREATED,
        isDemo: false,
      }),
    );
  });

  afterEach(async () => {
    vi.resetAllMocks();
    await app.close();
  });

  describe('PATCH /organizations/:organizationId', () => {
    describe.each<Role>(['ADMIN'])('as %s', (role) => {
      it('should rename the organization', async () => {
        admitAs(role);

        const response = await patch({ name: '  Renamed Operations  ' });

        expect(response.status).toBe(200);
        expect(response.body).toEqual({
          id: ORG_ID,
          name: 'Renamed Operations',
          slug: 'acme-operations',
          createdAt: '2026-09-01T12:00:00.000Z',
          demo: false,
        });
        expect(prisma.organization.update).toHaveBeenCalledExactlyOnceWith({
          where: { id: ORG_ID, deletedAt: null },
          data: { name: 'Renamed Operations' },
          select: {
            id: true,
            name: true,
            slug: true,
            createdAt: true,
            isDemo: true,
          },
        });
      });

      it('should answer 400 to a body with keys beyond name', async () => {
        admitAs(role);

        for (const extra of [
          { slug: 'hijacked' },
          { organizationId: OTHER_ORG_ID },
          { role: 'OWNER' },
          { deletedAt: null },
        ]) {
          const response = await patch({ name: 'Renamed', ...extra });

          expect(response.status).toBe(400);
        }

        expect(prisma.organization.update).not.toHaveBeenCalled();
      });

      it('should answer 400 to an invalid name', async () => {
        admitAs(role);

        const response = await patch({ name: '' });

        expect(response.status).toBe(400);
        expect(prisma.organization.update).not.toHaveBeenCalled();
      });

      it('should answer 404 when the organization vanished after admission', async () => {
        admitAs(role);
        prisma.organization.update.mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError('No record', {
            code: 'P2025',
            clientVersion: 'test',
          }),
        );

        const response = await patch();

        expect(response.status).toBe(404);
        expect(response.body.code).toBe('ORGANIZATION_NOT_FOUND');
      });
    });

    describe('as MEMBER', () => {
      it('should refuse with 403 PERMISSION_DENIED and write nothing', async () => {
        admitAs('RESPONDER');

        expectDenied(await patch());
        expect(prisma.organization.update).not.toHaveBeenCalled();
      });

      it('should admit before refusing, with exactly one membership lookup', async () => {
        admitAs('RESPONDER');

        await patch();

        const admissions = prisma.membership.findFirst.mock.calls.filter(
          ([args]) => 'userId' in (args as { where: object }).where,
        );

        expect(admissions).toHaveLength(1);
        expect(prisma.membership.findFirst).toHaveBeenCalledTimes(1);
        expect(prisma.organization.findFirst).not.toHaveBeenCalled();
      });

      it('should refuse before validating the body', async () => {
        // Guards run before pipes: an unauthorized caller learns nothing about
        // what a valid body would look like.
        admitAs('RESPONDER');

        for (const body of [{}, { name: '' }, { name: 'x', slug: 'y' }]) {
          expectDenied(await patch(body));
        }
      });

      it('should not be raised to a better role by anything in the request', async () => {
        admitAs('RESPONDER');

        const response = await request(app.getHttpServer())
          .patch(`/api/v1/organizations/${ORG_ID}?role=ADMIN&membershipId=x`)
          .set('Authorization', await bearer())
          .set('X-Role', 'ADMIN')
          .set('X-Organization-Role', 'ADMIN')
          .send({ name: 'Renamed', role: 'ADMIN' });

        expectDenied(response);
        expect(prisma.organization.update).not.toHaveBeenCalled();
      });
    });

    it('should reject an unauthenticated caller before admission or authorization', async () => {
      admitAs('ADMIN');

      const response = await request(app.getHttpServer())
        .patch(`/api/v1/organizations/${ORG_ID}`)
        .send({ name: 'Renamed' })
        .expect(401);

      expect(response.body.code).toBe('UNAUTHENTICATED');
      expect(prisma.membership.findFirst).not.toHaveBeenCalled();
      expect(prisma.organization.update).not.toHaveBeenCalled();
    });

    it('should answer a non-member with 404, not 403', async () => {
      // Admitted as ADMIN of ORG_ID only; the target is another organization.
      admitAs('ADMIN');

      const response = await patch(undefined, OTHER_ORG_ID);

      expect(response.status).toBe(404);
      expect(response.body).toMatchObject({
        message: 'Organization not found',
        code: 'ORGANIZATION_NOT_FOUND',
      });
      expect(prisma.organization.update).not.toHaveBeenCalled();
    });

    it('should answer a malformed organization id with 404 and no query', async () => {
      const response = await patch(undefined, 'acme-operations');

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('ORGANIZATION_NOT_FOUND');
      expect(prisma.membership.findFirst).not.toHaveBeenCalled();
    });

    it('should update the organization in the path, not one named elsewhere', async () => {
      admitAs('ADMIN');

      await request(app.getHttpServer())
        .patch(`/api/v1/organizations/${ORG_ID}?organizationId=${OTHER_ORG_ID}`)
        .set('Authorization', await bearer())
        .set('X-Organization-Id', OTHER_ORG_ID)
        .send({ name: 'Renamed' })
        .expect(200);

      const [args] = prisma.organization.update.mock.calls[0];

      expect(args.where).toEqual({ id: ORG_ID, deletedAt: null });
    });
  });

  describe.each(ROLES)('read routes as %s', (role) => {
    it.each(['', '/memberships', `/memberships/${MEMBERSHIP_ID}`])(
      'should serve GET /organizations/:organizationId%s',
      async (suffix) => {
        admitAs(role);

        await request(app.getHttpServer())
          .get(`/api/v1/organizations/${ORG_ID}${suffix}`)
          .set('Authorization', await bearer())
          .expect(200);
      },
    );
  });

  describe('wiring mistakes fail closed', () => {
    it('should refuse an organization handler that declares no permission, before any query', async () => {
      admitAs('ADMIN');

      const response = await request(app.getHttpServer())
        .get(`/api/v1/organizations/${ORG_ID}/undeclared-probe`)
        .set('Authorization', await bearer())
        .expect(500);

      expect(response.body.message).toBe('Internal server error');
      expect(response.body).not.toHaveProperty('status');
      expect(prisma.membership.findFirst).not.toHaveBeenCalled();
    });

    it('should refuse a permission declared outside an organization controller', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/unscoped-permission-probe')
        .set('Authorization', await bearer())
        .expect(500);

      expect(response.body.message).toBe('Internal server error');
      expect(response.body).not.toHaveProperty('status');
    });

    it('should refuse a public route that declares a permission', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/unscoped-permission-probe/public')
        .expect(500);

      expect(response.body.message).toBe('Internal server error');
      expect(response.body).not.toHaveProperty('status');
    });
  });
});
