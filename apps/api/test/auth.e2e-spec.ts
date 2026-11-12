import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from './../src/app.module.js';
import { CurrentUserId } from './../src/auth/current-user.decorator.js';
import { Public } from './../src/auth/public.decorator.js';
import { TokenService } from './../src/auth/token.service.js';
import { PrismaService } from './../src/database/prisma.service.js';

// Registration is off by default; this suite proves how it works when on.
// Hoisted, so it is set before configuration is read.
vi.hoisted(() => {
  process.env.REGISTRATION_ENABLED = 'true';
});

/**
 * The guard, the decorators, and the error contract, wired through the real
 * AppModule but with no database.
 *
 * That combination is exactly what the guard's database-free design buys: a
 * token can be minted and verified, and a protected route can identify its
 * caller, without a single query. Everything that does need a database -- the
 * whole registration, login, refresh, and logout lifecycle -- is covered by
 * auth.integration-spec.ts instead.
 *
 * The controllers below are declared here rather than in `src/`, so no
 * test-only route ships, while the guard under test is the real global one.
 */
const USER_ID = '0199a1b2-c3d4-7000-8000-000000000001';

@Controller('protected-probe')
class ProtectedProbeController {
  /** Protected by nothing more than the absence of @Public(). */
  @Get()
  whoAmI(@CurrentUserId() userId: string): { userId: string } {
    return { userId };
  }
}

@Controller('public-probe')
class PublicProbeController {
  @Public()
  @Get()
  open(): { status: string } {
    return { status: 'open' };
  }
}

describe('Authentication (e2e)', () => {
  let app: INestApplication;
  let tokens: TokenService;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [ProtectedProbeController, PublicProbeController],
    })
      .overrideProvider(PrismaService)
      .useValue({ $queryRaw: vi.fn() })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('/api/v1');
    await app.init();

    tokens = app.get(TokenService);
  });

  afterEach(async () => {
    await app.close();
    vi.resetAllMocks();
  });

  describe('the global guard', () => {
    it('should protect a route that opts out of nothing', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/protected-probe')
        .expect(401);
    });

    it('should admit a caller holding a valid token', async () => {
      const token = await tokens.signAccessToken(USER_ID);

      await request(app.getHttpServer())
        .get('/api/v1/protected-probe')
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .expect({ userId: USER_ID });
    });

    it('should identify the caller without touching the database', async () => {
      // PrismaService here is a stub with only $queryRaw. That the route
      // resolves proves the guard reads no row to authenticate.
      const token = await tokens.signAccessToken(USER_ID);

      const response = await request(app.getHttpServer())
        .get('/api/v1/protected-probe')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(response.body.userId).toBe(USER_ID);
    });

    it('should reject an expired token', async () => {
      const { JwtService } = await import('@nestjs/jwt');
      const { TokenService: Service } =
        await import('./../src/auth/token.service.js');
      const expired = new Service(
        new JwtService({ secret: process.env.JWT_SECRET }),
        {
          jwtSecret: process.env.JWT_SECRET as string,
          jwtIssuer: 'sentinelops',
          accessTtlSeconds: -60,
          refreshTtlDays: 30,
          cookieSecure: false,
          cookiePath: '/api/v1/auth',
        },
      );

      await request(app.getHttpServer())
        .get('/api/v1/protected-probe')
        .set(
          'Authorization',
          `Bearer ${await expired.signAccessToken(USER_ID)}`,
        )
        .expect(401);
    });

    it.each([
      ['Bearer not-a-jwt', 'a malformed token'],
      ['Basic dXNlcjpwYXNz', 'the wrong scheme'],
      ['', 'an empty header'],
    ])('should reject %j: %s', async (authorization) => {
      await request(app.getHttpServer())
        .get('/api/v1/protected-probe')
        .set('Authorization', authorization)
        .expect(401);
    });
  });

  describe('@Public()', () => {
    it('should let an unauthenticated caller through', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/public-probe')
        .expect(200)
        .expect({ status: 'open' });
    });

    it('should keep the liveness probe reachable', async () => {
      // A load balancer's probe carries no credentials.
      await request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(200)
        .expect({ status: 'ok' });
    });

    it('should keep the readiness probe reachable', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/health/ready')
        .expect(200);
    });

    it('should keep the login route reachable', async () => {
      // 400 rather than 401: the request reached validation, which is the
      // point. A 401 here would mean logging in required being logged in.
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({})
        .expect(400);
    });

    it('should keep the register route reachable', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({})
        .expect(400);
    });

    it('should keep the refresh route reachable', async () => {
      // 401 because no cookie was sent, not because the route is guarded.
      const response = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .expect(401);

      expect(response.body.code).toBe('INVALID_REFRESH_TOKEN');
    });

    it('should log out a caller with no cookie at all', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .expect(204);
    });
  });

  describe('the 401 contract', () => {
    it('should return the standard error envelope', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .expect(401);

      expect(response.body).toMatchObject({
        statusCode: 401,
        error: 'Unauthorized',
        message: 'Authentication required',
        code: 'UNAUTHENTICATED',
        path: '/api/v1/auth/me',
      });
      expect(response.body.requestId).toEqual(expect.any(String));
      expect(response.body.timestamp).toEqual(expect.any(String));
    });

    it('should carry the correlation id in the header as well as the body', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('X-Request-Id', 'probe-401')
        .expect(401);

      expect(response.headers['x-request-id']).toBe('probe-401');
      expect(response.body.requestId).toBe('probe-401');
    });

    it('should not disclose which half of the token failed', async () => {
      const malformed = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer not-a-jwt')
        .expect(401);

      expect(malformed.body.message).toBe('Invalid or expired access token');
    });

    it('should never echo the presented token back', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer super-secret-token-value')
        .expect(401);

      expect(JSON.stringify(response.body)).not.toContain(
        'super-secret-token-value',
      );
    });
  });
});
