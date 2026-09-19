import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from './../src/app.module.js';
import { TokenService } from './../src/auth/token.service.js';
import { PrismaService } from './../src/database/prisma.service.js';
import { leakedKeys } from './leaks.js';
import { resolveTestDatabaseUrl } from './test-database.js';

/**
 * The whole authentication lifecycle against a real database: registration's
 * transaction, login's soft-delete filtering, refresh rotation and reuse
 * detection, and logout.
 *
 * None of it can be covered by the e2e suite, which runs without a database by
 * design. What can be covered there -- the guard, the decorators, and the 401
 * contract -- lives in auth.e2e-spec.ts and is not repeated here.
 *
 * The application is booted with PrismaService pointed at TEST_DATABASE_URL, so
 * DATABASE_URL is never consulted in this file.
 */

const PASSWORD = 'a-sufficiently-long-passphrase';

const registration = (overrides: Record<string, unknown> = {}) => ({
  email: 'ada@example.com',
  password: PASSWORD,
  name: 'Ada Lovelace',
  organizationName: 'Acme Operations',
  ...overrides,
});

/** The refresh cookie's value from a response's Set-Cookie header. */
const refreshCookieOf = (response: request.Response): string | undefined => {
  const header = response.headers['set-cookie'];
  const cookies = Array.isArray(header) ? header : header ? [header] : [];
  const cookie = cookies.find((entry) => entry.startsWith('sops_rt='));

  if (!cookie) {
    return undefined;
  }

  const value = cookie.slice('sops_rt='.length).split(';')[0];

  return value.length > 0 ? value : undefined;
};

const setCookieOf = (response: request.Response): string => {
  const header = response.headers['set-cookie'];
  const cookies = Array.isArray(header) ? header : header ? [header] : [];

  return cookies.find((entry) => entry.startsWith('sops_rt=')) ?? '';
};

describe('authentication (integration)', () => {
  const prisma = new PrismaService({ url: resolveTestDatabaseUrl() });
  let app: INestApplication;
  let tokens: TokenService;

  const http = () => request(app.getHttpServer());

  const register = (overrides: Record<string, unknown> = {}) =>
    http().post('/api/v1/auth/register').send(registration(overrides));

  const login = (email = 'ada@example.com', password = PASSWORD) =>
    http().post('/api/v1/auth/login').send({ email, password });

  const refreshWith = (cookie: string) =>
    http().post('/api/v1/auth/refresh').set('Cookie', `sops_rt=${cookie}`);

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
  });

  afterAll(async () => {
    await app.close();
  });

  describe('registration', () => {
    it('should create an organization, a user, and an admin membership', async () => {
      const response = await register().expect(201);

      const membership = await prisma.membership.findFirstOrThrow({
        include: { organization: true, user: true },
      });

      expect(membership.role).toBe('ADMIN');
      expect(membership.user.email).toBe('ada@example.com');
      expect(membership.organization.slug).toBe('acme-operations');
      expect(response.body.user.id).toBe(membership.userId);
    });

    it('should return a usable access token', async () => {
      const response = await register().expect(201);

      await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${response.body.accessToken}`)
        .expect(200);
    });

    it('should set an httpOnly, lax, path-scoped refresh cookie', async () => {
      const cookie = setCookieOf(await register().expect(201));

      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toContain('Path=/api/v1/auth');
      // NODE_ENV is 'test' here, so Secure is correctly absent.
      expect(cookie).not.toContain('Secure');
    });

    it('should store the password only as an argon2 hash', async () => {
      await register().expect(201);

      const user = await prisma.user.findFirstOrThrow();

      expect(user.passwordHash).not.toBe(PASSWORD);
      expect(user.passwordHash?.startsWith('$argon2id$')).toBe(true);
    });

    it('should store the refresh token only as a hash', async () => {
      const response = await register().expect(201);
      const cookie = refreshCookieOf(response) as string;

      const stored = await prisma.refreshToken.findFirstOrThrow();

      expect(stored.tokenHash).not.toBe(cookie);
      expect(stored.tokenHash).toBe(tokens.hashRefreshToken(cookie));
    });

    it('should normalise the email before storing it', async () => {
      await register({ email: '  ADA@Example.COM  ' }).expect(201);

      const user = await prisma.user.findFirstOrThrow();

      expect(user.email).toBe('ada@example.com');
      // And the normalised address is the one that logs in.
      await login('ada@example.com').expect(200);
    });

    it('should accept an explicit slug', async () => {
      await register({ organizationSlug: 'acme-ops' }).expect(201);

      const organization = await prisma.organization.findFirstOrThrow();

      expect(organization.slug).toBe('acme-ops');
    });

    it('should reject an organization name with no derivable slug', async () => {
      const response = await register({ organizationName: '!!!' }).expect(400);

      expect(response.body.details).toEqual([
        { field: 'organizationSlug', message: expect.any(String) },
      ]);
    });

    it('should reject a duplicate email with a coded 409', async () => {
      await register().expect(201);

      const response = await register({
        organizationName: 'Another Company',
      }).expect(409);

      expect(response.body.code).toBe('EMAIL_ALREADY_REGISTERED');
    });

    it('should reject a duplicate slug with a coded 409', async () => {
      await register().expect(201);

      const response = await register({
        email: 'grace@example.com',
      }).expect(409);

      expect(response.body.code).toBe('ORGANIZATION_SLUG_TAKEN');
    });

    it('should leave no orphan rows when the slug collides', async () => {
      // The transaction's whole purpose: a user without a membership can do
      // nothing, so a half-completed registration must not exist.
      await register().expect(201);
      await register({ email: 'grace@example.com' }).expect(409);

      expect(await prisma.user.count()).toBe(1);
      expect(await prisma.organization.count()).toBe(1);
      expect(await prisma.membership.count()).toBe(1);
    });

    it('should leave no orphan rows when the email collides', async () => {
      await register().expect(201);
      await register({ organizationName: 'Another Company' }).expect(409);

      expect(await prisma.user.count()).toBe(1);
      expect(await prisma.organization.count()).toBe(1);
    });

    it('should reject a soft-deleted user re-registering the same email', async () => {
      // A soft-deleted row still owns the unique email. Reclaiming addresses is
      // deliberately out of scope.
      await register().expect(201);
      await prisma.user.updateMany({ data: { deletedAt: new Date() } });

      const response = await register({
        organizationName: 'Another Company',
      }).expect(409);

      expect(response.body.code).toBe('EMAIL_ALREADY_REGISTERED');
    });
  });

  describe('login', () => {
    beforeEach(async () => {
      await register().expect(201);
    });

    it('should return an access token and a refresh cookie', async () => {
      const response = await login().expect(200);

      expect(response.body.accessToken).toEqual(expect.any(String));
      expect(response.body.tokenType).toBe('Bearer');
      expect(refreshCookieOf(response)).toEqual(expect.any(String));
    });

    it('should start a session distinct from the registration one', async () => {
      const first = refreshCookieOf(
        await register({
          email: 'grace@example.com',
          organizationName: 'Hopper Systems',
        }).expect(201),
      );
      const second = refreshCookieOf(
        await login('grace@example.com').expect(200),
      );

      expect(first).not.toBe(second);
      // Both remain usable: logging in on a second device does not end the
      // first device's session.
      await refreshWith(first as string).expect(200);
      await refreshWith(second as string).expect(200);
    });

    it('should reject a wrong password', async () => {
      const response = await login(
        'ada@example.com',
        'wrong-password-entirely',
      ).expect(401);

      expect(response.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('should answer identically for an unknown email', async () => {
      const unknown = await login('nobody@example.com', PASSWORD).expect(401);
      const wrong = await login(
        'ada@example.com',
        'wrong-password-entirely',
      ).expect(401);

      // Telling these apart would make the endpoint an oracle for which
      // addresses have accounts.
      expect(unknown.body.message).toBe(wrong.body.message);
      expect(unknown.body.code).toBe(wrong.body.code);
    });

    it('should refuse a soft-deleted account', async () => {
      await prisma.user.updateMany({ data: { deletedAt: new Date() } });

      const response = await login().expect(401);

      expect(response.body.code).toBe('INVALID_CREDENTIALS');
    });

    it('should refuse an account with no password set', async () => {
      // The shape an invited-but-not-yet-onboarded user will have.
      await prisma.user.create({
        data: { email: 'invited@example.com', name: 'Invited' },
      });

      await login('invited@example.com', PASSWORD).expect(401);
    });
  });

  describe('the current user', () => {
    it('should refuse an unauthenticated request', async () => {
      await http().get('/api/v1/auth/me').expect(401);
    });

    it('should return the caller and their memberships', async () => {
      const { body } = await register().expect(201);

      const response = await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .expect(200);

      expect(response.body).toMatchObject({
        email: 'ada@example.com',
        name: 'Ada Lovelace',
      });
      expect(response.body.memberships).toHaveLength(1);
      expect(response.body.memberships[0]).toMatchObject({
        role: 'ADMIN',
        organization: { slug: 'acme-operations', name: 'Acme Operations' },
      });
    });

    it('should omit memberships whose organization is soft-deleted', async () => {
      const { body } = await register().expect(201);
      await prisma.organization.updateMany({ data: { deletedAt: new Date() } });

      const response = await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .expect(200);

      expect(response.body.memberships).toEqual([]);
    });

    it('should refuse a token whose user has been soft-deleted', async () => {
      const { body } = await register().expect(201);
      await prisma.user.updateMany({ data: { deletedAt: new Date() } });

      await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .expect(401);
    });
  });

  describe('refresh', () => {
    it('should refuse a request with no cookie', async () => {
      const response = await http().post('/api/v1/auth/refresh').expect(401);

      expect(response.body.code).toBe('INVALID_REFRESH_TOKEN');
    });

    it('should refuse an unknown token', async () => {
      const response = await refreshWith('not-a-real-token').expect(401);

      expect(response.body.code).toBe('INVALID_REFRESH_TOKEN');
    });

    it('should rotate the cookie and return a working access token', async () => {
      const first = refreshCookieOf(await register().expect(201)) as string;

      const response = await refreshWith(first).expect(200);
      const second = refreshCookieOf(response) as string;

      expect(second).not.toBe(first);
      await http()
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${response.body.accessToken}`)
        .expect(200);
    });

    it('should keep the rotated token in the same family', async () => {
      const first = refreshCookieOf(await register().expect(201)) as string;
      await refreshWith(first).expect(200);

      const families = await prisma.refreshToken.findMany({
        select: { familyId: true },
      });

      expect(families).toHaveLength(2);
      expect(new Set(families.map((row) => row.familyId)).size).toBe(1);
    });

    it('should refuse an expired token', async () => {
      const cookie = refreshCookieOf(await register().expect(201)) as string;
      await prisma.refreshToken.updateMany({
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const response = await refreshWith(cookie).expect(401);

      expect(response.body.code).toBe('REFRESH_TOKEN_EXPIRED');
    });

    it('should refuse a token whose user has been soft-deleted', async () => {
      const cookie = refreshCookieOf(await register().expect(201)) as string;
      await prisma.user.updateMany({ data: { deletedAt: new Date() } });

      const response = await refreshWith(cookie).expect(401);

      expect(response.body.code).toBe('INVALID_REFRESH_TOKEN');
    });

    it('should clear the cookie when it refuses', async () => {
      // Leaving a dead cookie in the browser guarantees the client retries with
      // a token that can only fail again.
      const response = await refreshWith('not-a-real-token').expect(401);

      expect(setCookieOf(response)).toContain('sops_rt=;');
    });

    describe('reuse detection', () => {
      it('should refuse a token that has already been rotated away', async () => {
        const first = refreshCookieOf(await register().expect(201)) as string;
        await refreshWith(first).expect(200);

        const response = await refreshWith(first).expect(401);

        expect(response.body.code).toBe('REFRESH_TOKEN_REUSED');
      });

      it('should kill the whole family, not just the replayed token', async () => {
        // The point of tracking a family: a stolen token replayed after the
        // legitimate client has rotated past it must not leave the thief and
        // the victim both working.
        const first = refreshCookieOf(await register().expect(201)) as string;
        const second = refreshCookieOf(
          await refreshWith(first).expect(200),
        ) as string;

        await refreshWith(first).expect(401);

        // The legitimate client's current token is now dead too.
        await refreshWith(second).expect(401);
      });

      it('should leave other sessions of the same user untouched', async () => {
        // Terminating one compromised lineage must not log the person out of
        // every device they own.
        const compromised = refreshCookieOf(
          await register().expect(201),
        ) as string;
        const other = refreshCookieOf(await login().expect(200)) as string;

        await refreshWith(compromised).expect(200);
        await refreshWith(compromised).expect(401);

        await refreshWith(other).expect(200);
      });
    });
  });

  describe('logout', () => {
    it('should end the session and clear the cookie', async () => {
      const cookie = refreshCookieOf(await register().expect(201)) as string;

      const response = await http()
        .post('/api/v1/auth/logout')
        .set('Cookie', `sops_rt=${cookie}`)
        .expect(204);

      expect(setCookieOf(response)).toContain('sops_rt=;');
      await refreshWith(cookie).expect(401);
    });

    it('should revoke every token in the family', async () => {
      const first = refreshCookieOf(await register().expect(201)) as string;
      const second = refreshCookieOf(
        await refreshWith(first).expect(200),
      ) as string;

      await http()
        .post('/api/v1/auth/logout')
        .set('Cookie', `sops_rt=${second}`)
        .expect(204);

      const live = await prisma.refreshToken.count({
        where: { revokedAt: null },
      });

      expect(live).toBe(0);
    });

    it('should succeed with no cookie at all', async () => {
      await http().post('/api/v1/auth/logout').expect(204);
    });

    it('should succeed with an unknown token, revealing nothing', async () => {
      await http()
        .post('/api/v1/auth/logout')
        .set('Cookie', 'sops_rt=not-a-real-token')
        .expect(204);
    });

    it('should leave other sessions of the same user working', async () => {
      const first = refreshCookieOf(await register().expect(201)) as string;
      const other = refreshCookieOf(await login().expect(200)) as string;

      await http()
        .post('/api/v1/auth/logout')
        .set('Cookie', `sops_rt=${first}`)
        .expect(204);

      await refreshWith(other).expect(200);
    });
  });

  describe('changing a password', () => {
    const NEW_PASSWORD = 'an-entirely-new-passphrase';

    const changePassword = (
      accessToken: string | undefined,
      body: Record<string, unknown>,
    ) => {
      const pending = http().post('/api/v1/auth/password');

      return (
        accessToken
          ? pending.set('Authorization', `Bearer ${accessToken}`)
          : pending
      ).send(body);
    };

    it('should require authentication', async () => {
      const response = await changePassword(undefined, {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
      }).expect(401);

      expect(response.body.code).toBe('UNAUTHENTICATED');
    });

    it('should refuse a wrong current password with 400, changing nothing', async () => {
      const { accessToken } = (await register().expect(201)).body;

      const response = await changePassword(accessToken, {
        currentPassword: 'not-the-current-one',
        newPassword: NEW_PASSWORD,
      }).expect(400);

      expect(response.body.code).toBe('INVALID_CURRENT_PASSWORD');
      expect(response.body.details).toEqual([
        {
          field: 'currentPassword',
          message: 'The current password is incorrect',
        },
      ]);
      await login('ada@example.com', PASSWORD).expect(200);
    });

    it('should refuse keeping the same password', async () => {
      const { accessToken } = (await register().expect(201)).body;

      const response = await changePassword(accessToken, {
        currentPassword: PASSWORD,
        newPassword: PASSWORD,
      }).expect(400);

      expect(response.body.code).toBe('PASSWORD_UNCHANGED');
    });

    it('should hold the new password to the policy for setting one', async () => {
      const { accessToken } = (await register().expect(201)).body;

      await changePassword(accessToken, {
        currentPassword: PASSWORD,
        newPassword: 'too-short',
      }).expect(400);
      await login('ada@example.com', PASSWORD).expect(200);
    });

    it('should replace the password, end every other session, and keep this one signed in', async () => {
      const registered = await register().expect(201);
      const firstSession = refreshCookieOf(registered) as string;
      const secondSession = refreshCookieOf(
        await login().expect(200),
      ) as string;

      const response = await changePassword(registered.body.accessToken, {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
      }).expect(200);

      expect(response.body).toMatchObject({
        accessToken: expect.any(String),
        tokenType: 'Bearer',
        user: { email: 'ada@example.com', passwordChangeRequired: false },
      });
      expect(leakedKeys(response.body)).toEqual([]);

      await refreshWith(firstSession).expect(401);
      await refreshWith(secondSession).expect(401);
      await refreshWith(refreshCookieOf(response) as string).expect(200);

      await login('ada@example.com', PASSWORD).expect(401);
      await login('ada@example.com', NEW_PASSWORD).expect(200);
    });

    it('should keep an account on a one-time password out of its organizations until it changes it', async () => {
      await register().expect(201);
      await prisma.user.update({
        where: { email: 'ada@example.com' },
        data: { passwordChangeRequired: true },
      });
      const { organizationId } = await prisma.membership.findFirstOrThrow({
        select: { organizationId: true },
      });
      const organizationPath = `/api/v1/organizations/${organizationId}`;

      const signedIn = await login().expect(200);
      const bearer = `Bearer ${signedIn.body.accessToken}`;

      expect(signedIn.body.user.passwordChangeRequired).toBe(true);

      const refused = await http()
        .get(organizationPath)
        .set('Authorization', bearer)
        .expect(403);

      expect(refused.body.code).toBe('PASSWORD_CHANGE_REQUIRED');

      // Who they are stays readable: a client needs it to send them on.
      const me = await http()
        .get('/api/v1/auth/me')
        .set('Authorization', bearer)
        .expect(200);

      expect(me.body.passwordChangeRequired).toBe(true);

      const changed = await changePassword(signedIn.body.accessToken, {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
      }).expect(200);

      // Both the new token and the old one are admitted now: the flag is read
      // from the database on every request, not carried in a token.
      await http()
        .get(organizationPath)
        .set('Authorization', `Bearer ${changed.body.accessToken}`)
        .expect(200);
      await http()
        .get(organizationPath)
        .set('Authorization', bearer)
        .expect(200);

      expect(
        (
          await prisma.user.findUniqueOrThrow({
            where: { email: 'ada@example.com' },
          })
        ).passwordChangeRequired,
      ).toBe(false);
    });
  });

  describe('response leak prevention', () => {
    it('should never expose a persistence internal in any auth response', async () => {
      const registered = await register().expect(201);
      const accessToken = registered.body.accessToken as string;
      const cookie = refreshCookieOf(registered) as string;

      const responses = [
        registered,
        await login().expect(200),
        await http()
          .get('/api/v1/auth/me')
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200),
        await refreshWith(cookie).expect(200),
        // Failure paths too: an error body is a response like any other.
        await register({ organizationName: 'Another Company' }).expect(409),
        await login('ada@example.com', 'wrong-password-entirely').expect(401),
        await http().get('/api/v1/auth/me').expect(401),
        await refreshWith('not-a-real-token').expect(401),
      ];

      for (const response of responses) {
        expect(leakedKeys(response.body)).toEqual([]);
      }
    });

    it('should never echo the submitted password', async () => {
      const responses = [
        await register().expect(201),
        await login().expect(200),
        await login('ada@example.com', 'wrong-password-entirely').expect(401),
      ];

      for (const response of responses) {
        expect(JSON.stringify(response.body)).not.toContain(PASSWORD);
      }
    });

    it('should never put the refresh token in a response body', async () => {
      // It belongs in a Set-Cookie header and nowhere else.
      const registered = await register().expect(201);
      const cookie = refreshCookieOf(registered) as string;

      expect(JSON.stringify(registered.body)).not.toContain(cookie);

      const refreshed = await refreshWith(cookie).expect(200);

      expect(JSON.stringify(refreshed.body)).not.toContain(
        refreshCookieOf(refreshed),
      );
    });

    it('should not expose the stored hash of anything', async () => {
      const registered = await register().expect(201);
      const user = await prisma.user.findFirstOrThrow();
      const token = await prisma.refreshToken.findFirstOrThrow();

      const body = JSON.stringify(registered.body);

      expect(body).not.toContain(user.passwordHash);
      expect(body).not.toContain(token.tokenHash);
      expect(body).not.toContain(token.familyId);
    });
  });
});
