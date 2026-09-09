import { JwtService } from '@nestjs/jwt';
import type { ConfigType } from '@nestjs/config';

import type { authConfig } from '../config/configuration.js';
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

const build = (overrides: Partial<AuthConfig> = {}): TokenService =>
  new TokenService(
    new JwtService({ secret: overrides.jwtSecret ?? SECRET }),
    config(overrides),
  );

describe('TokenService', () => {
  describe('access tokens', () => {
    it('should round-trip the user id in the sub claim', async () => {
      const service = build();

      const payload = await service.verifyAccessToken(
        await service.signAccessToken(USER_ID),
      );

      expect(payload.sub).toBe(USER_ID);
    });

    it('should stamp the configured issuer', async () => {
      const service = build();

      const payload = await service.verifyAccessToken(
        await service.signAccessToken(USER_ID),
      );

      expect(payload.iss).toBe('sentinelops');
    });

    it('should set an expiry the configured number of seconds ahead', async () => {
      const service = build({ accessTtlSeconds: 900 });

      const payload = await service.verifyAccessToken(
        await service.signAccessToken(USER_ID),
      );

      expect(payload.exp - payload.iat).toBe(900);
    });

    it('should carry identity only, with no organization or role', async () => {
      // Membership is resolved per request instead, so revoking one takes
      // effect immediately rather than at the next expiry.
      const service = build();

      const payload = await service.verifyAccessToken(
        await service.signAccessToken(USER_ID),
      );

      expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'iss', 'sub']);
    });

    it('should reject a token signed with a different secret', async () => {
      const mint = build({
        jwtSecret: 'another-key-of-at-least-32-characters-x',
      });
      const verify = build();

      await expect(
        verify.verifyAccessToken(await mint.signAccessToken(USER_ID)),
      ).rejects.toThrow();
    });

    it('should reject a token minted with a different issuer', async () => {
      // A token from an unrelated service that happens to share the secret is
      // still not one of ours.
      const mint = build({ jwtIssuer: 'somebody-else' });
      const verify = build();

      await expect(
        verify.verifyAccessToken(await mint.signAccessToken(USER_ID)),
      ).rejects.toThrow();
    });

    it('should reject an expired token', async () => {
      const mint = build({ accessTtlSeconds: -60 });
      const verify = build();

      await expect(
        verify.verifyAccessToken(await mint.signAccessToken(USER_ID)),
      ).rejects.toThrow();
    });

    it('should reject a tampered token', async () => {
      const service = build();
      const token = await service.signAccessToken(USER_ID);
      // Keep the real header and signature; swap the payload for a forged one.
      const [header, , signature] = token.split('.');
      const forged = [
        header,
        Buffer.from(
          JSON.stringify({ sub: 'someone-else', iss: 'sentinelops' }),
        ).toString('base64url'),
        signature,
      ].join('.');

      await expect(service.verifyAccessToken(forged)).rejects.toThrow();
    });

    it.each([['not-a-token'], [''], ['a.b.c']])(
      'should reject %j',
      async (token) => {
        await expect(build().verifyAccessToken(token)).rejects.toThrow();
      },
    );
  });

  describe('refresh tokens', () => {
    it('should mint a token that is not the stored hash', () => {
      const minted = build().mintRefreshToken();

      expect(minted.token).not.toBe(minted.tokenHash);
    });

    it('should mint 256 bits of entropy, base64url encoded', () => {
      const { token } = build().mintRefreshToken();

      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    });

    it('should never mint the same token twice', () => {
      const service = build();
      const tokens = new Set(
        Array.from({ length: 50 }, () => service.mintRefreshToken().token),
      );

      expect(tokens.size).toBe(50);
    });

    it('should hash deterministically, so lookup by hash works', () => {
      const service = build();
      const { token, tokenHash } = service.mintRefreshToken();

      expect(service.hashRefreshToken(token)).toBe(tokenHash);
    });

    it('should produce a 64-character hex digest', () => {
      expect(build().hashRefreshToken('anything')).toMatch(/^[0-9a-f]{64}$/);
    });

    it('should set the expiry the configured number of days ahead', () => {
      const now = new Date('2026-01-01T00:00:00.000Z');

      const { expiresAt } = build({ refreshTtlDays: 7 }).mintRefreshToken(now);

      expect(expiresAt.toISOString()).toBe('2026-01-08T00:00:00.000Z');
    });
  });

  describe('newFamilyId', () => {
    it('should return a distinct uuid each time', () => {
      const service = build();

      expect(service.newFamilyId()).not.toBe(service.newFamilyId());
      expect(service.newFamilyId()).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });
  });
});
