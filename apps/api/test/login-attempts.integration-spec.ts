import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from './../src/app.module.js';
import { PasswordService } from './../src/auth/password.service.js';
import { applyTrustProxy } from './../src/common/trust-proxy.js';
import { TokenService } from './../src/auth/token.service.js';
import { PrismaService } from './../src/database/prisma.service.js';
import { resolveTestDatabaseUrl } from './test-database.js';

/**
 * Guessing a password is limited, against a real database: five wrong
 * passwords for one email address in fifteen minutes stop that address —
 * whether or not an account has it — and the right password is not even
 * checked until the window passes. A right password clears the count.
 * Changing one's own password is limited the same way.
 *
 * Every test uses its own addresses: the limiter lives as long as the app.
 */
const PASSWORD = 'a-sufficiently-long-passphrase';

describe('login attempts (integration)', () => {
  const prisma = new PrismaService({ url: resolveTestDatabaseUrl() });
  let app: INestApplication;
  let tokens: TokenService;
  let passwords: PasswordService;

  const http = () => request(app.getHttpServer());

  const login = (email: string, password: string) =>
    http().post('/api/v1/auth/login').send({ email, password });

  const anAccount = async (email: string) =>
    prisma.user.create({
      data: {
        email,
        name: email,
        passwordHash: await passwords.hash(PASSWORD),
      },
      select: { id: true },
    });

  const wrongTimes = async (email: string, times: number) => {
    for (let i = 0; i < times; i++) {
      expect((await login(email, `wrong-password-${i}`)).status).toBe(401);
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
    passwords = app.get(PasswordService);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE incidents, services, team_memberships, teams, invitations, refresh_tokens, memberships, users, organizations RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('should stop an address after five wrong passwords, even for the right one, saying how long', async () => {
    await anAccount('ada@example.com');
    await wrongTimes('ada@example.com', 5);

    const blocked = await login('ada@example.com', PASSWORD);

    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('TOO_MANY_ATTEMPTS');
    expect(blocked.body.message).toBe(
      'Too many attempts. Try again in 15 minutes.',
    );
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(890);
    expect(Number(blocked.headers['retry-after'])).toBeLessThanOrEqual(900);
    expect(blocked.headers['set-cookie']).toBeUndefined();
  });

  it('should stop an address that has no account the same way, revealing nothing', async () => {
    await wrongTimes('nobody@example.com', 5);

    const blocked = await login('nobody@example.com', PASSWORD);

    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('TOO_MANY_ATTEMPTS');
  });

  it('should clear the count when the right password is given', async () => {
    await anAccount('grace@example.com');
    await wrongTimes('grace@example.com', 4);

    expect((await login('grace@example.com', PASSWORD)).status).toBe(200);

    // Four more wrong ones are four again, not nine.
    await wrongTimes('grace@example.com', 4);
    expect((await login('grace@example.com', PASSWORD)).status).toBe(200);
  });

  it('should leave other addresses alone', async () => {
    await anAccount('linus@example.com');
    await wrongTimes('someone-else@example.com', 5);

    expect((await login('linus@example.com', PASSWORD)).status).toBe(200);
  });

  it("should limit guessing one's own current password", async () => {
    const { id } = await anAccount('alan@example.com');
    const bearer = `Bearer ${await tokens.signAccessToken(id)}`;
    const change = (currentPassword: string) =>
      http()
        .post('/api/v1/auth/password')
        .set('Authorization', bearer)
        .send({ currentPassword, newPassword: 'another-long-passphrase' });

    for (let i = 0; i < 5; i++) {
      expect((await change(`wrong-password-${i}`)).status).toBe(400);
    }

    const blocked = await change(PASSWORD);

    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('TOO_MANY_ATTEMPTS');
    // Nothing changed: the old password still signs in.
    expect((await login('alan@example.com', PASSWORD)).status).toBe(200);
  });

  /**
   * The per-address limit (50 failures in 15 minutes, across every email)
   * keys on the client address, which depends on how many proxies are
   * trusted. Each test gets an app of its own, so its counts start at zero.
   */
  describe('the client address', () => {
    let proxied: NestExpressApplication | undefined;

    const appTrusting = async (hops: number) => {
      const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PrismaService)
        .useValue(prisma)
        .compile();

      proxied = moduleRef.createNestApplication<NestExpressApplication>();
      proxied.setGlobalPrefix('/api/v1');
      applyTrustProxy(proxied, hops);
      await proxied.init();

      return (email: string, forwardedFor: string) =>
        request(proxied!.getHttpServer())
          .post('/api/v1/auth/login')
          .set('X-Forwarded-For', forwardedFor)
          .send({ email, password: 'wrong-password' });
    };

    afterEach(async () => {
      await proxied?.close();
      proxied = undefined;
    });

    it('should count each client behind a trusted proxy by its own address', async () => {
      const loginFrom = await appTrusting(1);

      // A different email each time, so only the address limit can trip.
      for (let i = 0; i < 50; i++) {
        expect(
          (await loginFrom(`guess-${i}@example.com`, '203.0.113.7')).status,
        ).toBe(401);
      }

      expect(
        (await loginFrom('one-more@example.com', '203.0.113.7')).status,
      ).toBe(429);
      // Another client behind the same proxy is not caught by the first one's limit.
      expect(
        (await loginFrom('one-more@example.com', '203.0.113.8')).status,
      ).toBe(401);
    }, 120_000);

    it('should ignore a forged X-Forwarded-For when no proxy is trusted', async () => {
      const loginFrom = await appTrusting(0);

      // Naming a new address each time does not reset the count.
      for (let i = 0; i < 50; i++) {
        expect(
          (await loginFrom(`guess-${i}@example.com`, `198.51.100.${i}`)).status,
        ).toBe(401);
      }

      expect(
        (await loginFrom('one-more@example.com', '198.51.100.200')).status,
      ).toBe(429);
    }, 120_000);
  });
});
