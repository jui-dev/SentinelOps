import { Controller, Get, Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from './../src/app.module.js';
import { Public } from './../src/auth/public.decorator.js';
import { TokenService } from './../src/auth/token.service.js';
import { Permission } from './../src/authorization/permissions.js';
import { RequirePermission } from './../src/authorization/require-permission.decorator.js';
import type { OrganizationContext } from './../src/common/request-context.js';
import { PrismaService } from './../src/database/prisma.service.js';
import { AppLogger } from './../src/logger/app.logger.js';
import { CurrentMembership } from './../src/tenancy/current-membership.decorator.js';
import { OrganizationController } from './../src/tenancy/organization-controller.decorator.js';
import { TenancyModule } from './../src/tenancy/tenancy.module.js';

/**
 * Tenant admission wired through the real AppModule, with Prisma mocked.
 *
 * What this suite can prove without a database: the order the guards run in,
 * the uniform 404, the refusal of malformed ids before any query, the
 * wiring-mistake failures, and log correlation. Everything that depends on real
 * rows — isolation between two tenants, revocation, soft-deletion — lives in
 * tenancy.integration-spec.ts.
 *
 * The probe controllers are declared here rather than in src/, so no test-only
 * route ships.
 */
const USER_ID = '0199a1b2-c3d4-7000-8000-000000000001';
const ORG_ID = '0199a1b2-c3d4-7000-8000-00000000000a';
const MEMBERSHIP_ID = '0199a1b2-c3d4-7000-8000-0000000000aa';
const CREATED = new Date('2026-09-01T12:00:00.000Z');

/** Declared with the real decorator, then wrongly opened with @Public(). */
@OrganizationController('public-probe')
class PublicOrganizationProbeController {
  @Public()
  @Get()
  @RequirePermission(Permission.ORGANIZATION_READ)
  open(): { status: string } {
    return { status: 'open' };
  }
}

/** Reads the membership on a route that was never admitted to one. */
@Controller('unscoped-membership-probe')
class UnscopedMembershipProbeController {
  @Get()
  read(@CurrentMembership() membership: OrganizationContext): unknown {
    return membership;
  }
}

/** Logs from a handler, the way a domain service would. */
@OrganizationController('log-probe')
class LoggingProbeController {
  private readonly logger = new Logger('TenancyProbe');

  @Get()
  @RequirePermission(Permission.ORGANIZATION_READ)
  log(@CurrentMembership() membership: OrganizationContext): unknown {
    this.logger.log('inside an organization');

    return membership;
  }
}

/** The organization-scoped routes this stage ships, relative to the org. */
const TENANT_ROUTES = ['', '/memberships', `/memberships/${MEMBERSHIP_ID}`];

describe('Tenancy (e2e)', () => {
  let app: INestApplication;
  let tokens: TokenService;
  let lines: Record<string, unknown>[];
  let stdout: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;

  const prisma = {
    $queryRaw: vi.fn(),
    membership: { findFirst: vi.fn(), findMany: vi.fn() },
    organization: { findFirst: vi.fn() },
  };

  /** The admission lookup is the membership findFirst whose where has userId. */
  const admissionCalls = () =>
    prisma.membership.findFirst.mock.calls.filter(
      ([args]) => (args as { where: object }).where && 'userId' in args.where,
    );

  const admit = () =>
    prisma.membership.findFirst.mockImplementation(
      (args: { where: Record<string, unknown> }) =>
        'userId' in args.where
          ? { id: MEMBERSHIP_ID, organizationId: ORG_ID, role: 'MEMBER' }
          : {
              id: MEMBERSHIP_ID,
              role: 'MEMBER',
              createdAt: CREATED,
              user: { id: USER_ID, name: 'Ada', email: 'ada@example.com' },
            },
    );

  const bearer = async () => `Bearer ${await tokens.signAccessToken(USER_ID)}`;

  const capture = (write: unknown) => {
    if (typeof write !== 'string') {
      return;
    }

    try {
      lines.push(JSON.parse(write) as Record<string, unknown>);
    } catch {
      // Not a log line.
    }
  };

  beforeEach(async () => {
    vi.stubEnv('LOG_FORMAT', 'json');
    vi.stubEnv('LOG_LEVEL', 'debug');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      // TenancyModule for the probes, exactly as a feature module declaring
      // organization-scoped controllers must import it.
      imports: [AppModule, TenancyModule],
      controllers: [
        PublicOrganizationProbeController,
        UnscopedMembershipProbeController,
        LoggingProbeController,
      ],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleFixture.createNestApplication({ bufferLogs: true });
    app.setGlobalPrefix('/api/v1');
    app.useLogger(app.get(AppLogger));

    lines = [];
    stdout = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((write) => (capture(write), true));
    stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((write) => (capture(write), true));

    await app.init();

    tokens = app.get(TokenService);

    prisma.membership.findFirst.mockResolvedValue(null);
    prisma.membership.findMany.mockResolvedValue([]);
    prisma.organization.findFirst.mockResolvedValue({
      id: ORG_ID,
      name: 'Acme Operations',
      slug: 'acme-operations',
      createdAt: CREATED,
    });
  });

  afterEach(async () => {
    stdout.mockRestore();
    stderr.mockRestore();
    vi.unstubAllEnvs();
    vi.resetAllMocks();
    await app.close();
  });

  describe.each(TENANT_ROUTES)(
    'GET /organizations/:organizationId%s',
    (suffix) => {
      const path = (organizationId = ORG_ID) =>
        `/api/v1/organizations/${organizationId}${suffix}`;

      it('should reject an unauthenticated caller before any admission query', async () => {
        const response = await request(app.getHttpServer())
          .get(path())
          .expect(401);

        expect(response.body.code).toBe('UNAUTHENTICATED');
        expect(prisma.membership.findFirst).not.toHaveBeenCalled();
      });

      it('should answer 404 to an authenticated non-member', async () => {
        const response = await request(app.getHttpServer())
          .get(path())
          .set('Authorization', await bearer())
          .expect(404);

        expect(response.body).toMatchObject({
          statusCode: 404,
          error: 'Not Found',
          message: 'Organization not found',
          code: 'ORGANIZATION_NOT_FOUND',
        });
        expect(JSON.stringify(response.body.message)).not.toContain(ORG_ID);
        expect(admissionCalls()).toHaveLength(1);
        expect(prisma.membership.findMany).not.toHaveBeenCalled();
        expect(prisma.organization.findFirst).not.toHaveBeenCalled();
      });

      it('should answer 404 to a malformed organization id without querying', async () => {
        const response = await request(app.getHttpServer())
          .get(path('acme-operations'))
          .set('Authorization', await bearer())
          .expect(404);

        expect(response.body.code).toBe('ORGANIZATION_NOT_FOUND');
        expect(prisma.membership.findFirst).not.toHaveBeenCalled();
      });

      it('should admit a member', async () => {
        admit();

        await request(app.getHttpServer())
          .get(path())
          .set('Authorization', await bearer())
          .expect(200);

        expect(admissionCalls()[0][0]).toMatchObject({
          where: { organizationId: ORG_ID, userId: USER_ID },
        });
      });
    },
  );

  describe('the shipped routes', () => {
    it('should serve the organization at its canonical path, without a trailing slash', async () => {
      admit();

      const response = await request(app.getHttpServer())
        .get(`/api/v1/organizations/${ORG_ID}`)
        .set('Authorization', await bearer())
        .expect(200);

      expect(response.body).toEqual({
        id: ORG_ID,
        name: 'Acme Operations',
        slug: 'acme-operations',
        createdAt: '2026-09-01T12:00:00.000Z',
        membership: { id: MEMBERSHIP_ID, role: 'MEMBER' },
      });
    });

    it('should answer a malformed membership id with 404 rather than 400', async () => {
      admit();

      const response = await request(app.getHttpServer())
        .get(`/api/v1/organizations/${ORG_ID}/memberships/not-a-uuid`)
        .set('Authorization', await bearer())
        .expect(404);

      expect(response.body.code).toBe('MEMBERSHIP_NOT_FOUND');
    });

    it('should pass the admitted organization, not a spoofed one, to the service', async () => {
      admit();
      const other = '0199a1b2-c3d4-7000-8000-00000000000b';

      await request(app.getHttpServer())
        .get(
          `/api/v1/organizations/${ORG_ID}/memberships?organizationId=${other}`,
        )
        .set('Authorization', await bearer())
        .set('X-Organization-Id', other)
        .expect(200);

      expect(admissionCalls()[0][0]).toMatchObject({
        where: { organizationId: ORG_ID },
      });
      expect(prisma.membership.findMany.mock.calls[0][0]).toMatchObject({
        where: { organizationId: ORG_ID },
      });
    });
  });

  describe('wiring mistakes', () => {
    it('should fail closed with a masked 500 on a @Public() organization route', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/organizations/${ORG_ID}/public-probe`)
        .expect(500);

      expect(response.body.message).toBe('Internal server error');
      expect(prisma.membership.findFirst).not.toHaveBeenCalled();
    });

    it('should fail closed when a membership is read on an unscoped route', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/unscoped-membership-probe')
        .set('Authorization', await bearer())
        .expect(500);

      expect(response.body.message).toBe('Internal server error');
    });
  });

  describe('log correlation', () => {
    it('should attach organizationId to lines logged after admission', async () => {
      admit();

      await request(app.getHttpServer())
        .get(`/api/v1/organizations/${ORG_ID}/log-probe`)
        .set('Authorization', await bearer())
        .expect(200);

      const line = lines.find((entry) => entry.context === 'TenancyProbe');

      expect(line).toMatchObject({
        message: 'inside an organization',
        userId: USER_ID,
        organizationId: ORG_ID,
      });
      expect(line).not.toHaveProperty('role');
      expect(line).not.toHaveProperty('membershipId');
    });

    it('should not attach organizationId when admission was refused', async () => {
      await request(app.getHttpServer())
        .get(`/api/v1/organizations/${ORG_ID}/log-probe`)
        .set('Authorization', await bearer())
        .expect(404);

      const filterLine = lines.find(
        (entry) => entry.context === 'AllExceptionsFilter',
      );

      expect(filterLine).toBeDefined();
      expect(filterLine).not.toHaveProperty('organizationId');
    });
  });
});
