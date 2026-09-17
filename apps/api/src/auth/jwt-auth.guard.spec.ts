import { UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ConfigType } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import {
  getRequestUser,
  runWithRequestContext,
} from '../common/request-context.js';
import type { authConfig } from '../config/configuration.js';
import { AuthErrorCode } from './auth.errors.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { TokenService } from './token.service.js';

const SECRET = 'a-test-signing-key-of-at-least-32-characters';
const USER_ID = '0199a1b2-c3d4-7000-8000-000000000001';

type AuthConfig = ConfigType<typeof authConfig>;

const config = (overrides: Partial<AuthConfig> = {}): AuthConfig =>
  ({
    jwtSecret: SECRET,
    jwtIssuer: 'sentinelops',
    accessTtlSeconds: 900,
    refreshTtlDays: 30,
    cookieSecure: false,
    cookiePath: '/api/v1/auth',
    ...overrides,
  }) as AuthConfig;

const tokenService = (overrides: Partial<AuthConfig> = {}): TokenService =>
  new TokenService(
    new JwtService({ secret: overrides.jwtSecret ?? SECRET }),
    config(overrides),
  );

/** An ExecutionContext carrying the given headers and reflector metadata. */
const contextWith = (headers: Record<string, string> = {}): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  }) as unknown as ExecutionContext;

const guardWith = (isPublic: boolean, tokens = tokenService()) => {
  const reflector = {
    getAllAndOverride: vi.fn().mockReturnValue(isPublic ? true : undefined),
  } as unknown as Reflector;

  return new JwtAuthGuard(reflector, tokens);
};

describe('JwtAuthGuard', () => {
  describe('public routes', () => {
    it('should allow a route marked @Public() with no token at all', async () => {
      await expect(guardWith(true).canActivate(contextWith())).resolves.toBe(
        true,
      );
    });

    it('should not authenticate a public route that does carry a token', async () => {
      // A public route stays anonymous. Nothing downstream should be able to
      // read a user from one, because nothing verified it.
      const tokens = tokenService();
      const token = await tokens.signAccessToken(USER_ID);

      await runWithRequestContext({ requestId: 'req-1' }, async () => {
        await guardWith(true, tokens).canActivate(
          contextWith({ authorization: `Bearer ${token}` }),
        );

        expect(getRequestUser()).toBeUndefined();
      });
    });
  });

  describe('rejecting a request', () => {
    const expectUnauthorized = async (
      headers: Record<string, string>,
    ): Promise<UnauthorizedException> => {
      const promise = guardWith(false).canActivate(contextWith(headers));

      await expect(promise).rejects.toBeInstanceOf(UnauthorizedException);

      return promise.then(
        () => {
          throw new Error('expected the guard to reject');
        },
        (error: UnauthorizedException) => error,
      );
    };

    it('should reject a request with no Authorization header', async () => {
      await expectUnauthorized({});
    });

    it.each([
      ['', 'an empty header'],
      ['Bearer', 'a scheme with no token'],
      ['Bearer ', 'a scheme with an empty token'],
      ['Basic dXNlcjpwYXNz', 'the wrong scheme'],
      ['token-without-a-scheme', 'no scheme'],
    ])('should reject %j: %s', async (authorization) => {
      await expectUnauthorized({ authorization });
    });

    it('should reject a malformed token', async () => {
      await expectUnauthorized({ authorization: 'Bearer not-a-jwt' });
    });

    it('should reject a token signed with another secret', async () => {
      const other = tokenService({
        jwtSecret: 'another-key-of-at-least-32-characters-xx',
      });

      await expectUnauthorized({
        authorization: `Bearer ${await other.signAccessToken(USER_ID)}`,
      });
    });

    it('should reject an expired token', async () => {
      const expired = tokenService({ accessTtlSeconds: -60 });

      await expectUnauthorized({
        authorization: `Bearer ${await expired.signAccessToken(USER_ID)}`,
      });
    });

    it('should reject a token from another issuer', async () => {
      const foreign = tokenService({ jwtIssuer: 'somebody-else' });

      await expectUnauthorized({
        authorization: `Bearer ${await foreign.signAccessToken(USER_ID)}`,
      });
    });

    it('should carry the UNAUTHENTICATED code on the error contract', async () => {
      const error = await expectUnauthorized({});

      expect(error?.errorCode).toBe(AuthErrorCode.UNAUTHENTICATED);
      expect(error?.getStatus()).toBe(401);
    });

    it('should not disclose why the token failed', async () => {
      // "Signature invalid" versus "expired" tells a forger which half to fix.
      const expired = tokenService({ accessTtlSeconds: -60 });
      const malformed = await expectUnauthorized({
        authorization: 'Bearer not-a-jwt',
      });
      const stale = await expectUnauthorized({
        authorization: `Bearer ${await expired.signAccessToken(USER_ID)}`,
      });

      expect(malformed?.message).toBe(stale?.message);
    });

    it('should leave the context unauthenticated when it rejects', async () => {
      await runWithRequestContext({ requestId: 'req-1' }, async () => {
        await guardWith(false)
          .canActivate(contextWith({ authorization: 'Bearer nope' }))
          .catch(() => undefined);

        expect(getRequestUser()).toBeUndefined();
      });
    });
  });

  describe('accepting a request', () => {
    it('should allow a valid token', async () => {
      const tokens = tokenService();

      await expect(
        guardWith(false, tokens).canActivate(
          contextWith({
            authorization: `Bearer ${await tokens.signAccessToken(USER_ID)}`,
          }),
        ),
      ).resolves.toBe(true);
    });

    it('should record the user id in the request context', async () => {
      // This is what puts userId on every log line for the rest of the request.
      const tokens = tokenService();
      const token = await tokens.signAccessToken(USER_ID);

      await runWithRequestContext({ requestId: 'req-1' }, async () => {
        await guardWith(false, tokens).canActivate(
          contextWith({ authorization: `Bearer ${token}` }),
        );

        expect(getRequestUser()).toBe(USER_ID);
      });
    });

    it('should tolerate extra whitespace after the scheme', async () => {
      const tokens = tokenService();
      const token = await tokens.signAccessToken(USER_ID);

      await expect(
        guardWith(false, tokens).canActivate(
          contextWith({ authorization: `Bearer   ${token}` }),
        ),
      ).resolves.toBe(true);
    });

    it('should accept the scheme in any case', async () => {
      const tokens = tokenService();
      const token = await tokens.signAccessToken(USER_ID);

      await expect(
        guardWith(false, tokens).canActivate(
          contextWith({ authorization: `bearer ${token}` }),
        ),
      ).resolves.toBe(true);
    });

    it('should not throw outside a request context', async () => {
      // A unit test has no middleware ahead of the guard. Recording the user is
      // a no-op there rather than a crash.
      const tokens = tokenService();

      await expect(
        guardWith(false, tokens).canActivate(
          contextWith({
            authorization: `Bearer ${await tokens.signAccessToken(USER_ID)}`,
          }),
        ),
      ).resolves.toBe(true);
    });
  });
});
