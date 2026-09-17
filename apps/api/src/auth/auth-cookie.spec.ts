import type { Request, Response } from 'express';
import type { ConfigType } from '@nestjs/config';

import type { authConfig } from '../config/configuration.js';
import {
  clearRefreshCookie,
  readCookie,
  readRefreshCookie,
  REFRESH_COOKIE_NAME,
  setRefreshCookie,
} from './auth-cookie.js';

type AuthConfig = ConfigType<typeof authConfig>;

const config = (cookieSecure = false): AuthConfig =>
  ({
    jwtSecret: 'a-test-signing-key-of-at-least-32-characters',
    jwtIssuer: 'sentinelops',
    accessTtlSeconds: 900,
    refreshTtlDays: 30,
    cookieSecure,
    cookiePath: '/api/v1/auth',
  }) as AuthConfig;

const requestWith = (cookie?: string): Request =>
  ({ headers: cookie === undefined ? {} : { cookie } }) as unknown as Request;

const responseSpy = () => {
  const res = {
    cookie: vi.fn(),
    clearCookie: vi.fn(),
  };

  return res as unknown as Response & typeof res;
};

describe('auth cookie', () => {
  describe('readCookie', () => {
    it('should read the only cookie', () => {
      expect(readCookie(requestWith('sops_rt=abc123'), 'sops_rt')).toBe(
        'abc123',
      );
    });

    it('should read one cookie among several', () => {
      expect(
        readCookie(
          requestWith('theme=dark; sops_rt=abc123; locale=en'),
          'sops_rt',
        ),
      ).toBe('abc123');
    });

    it('should tolerate the space after each separator', () => {
      expect(readCookie(requestWith('a=1;sops_rt=xyz'), 'sops_rt')).toBe('xyz');
    });

    it('should not match a cookie whose name merely ends with the target', () => {
      expect(
        readCookie(requestWith('not_sops_rt=wrong'), 'sops_rt'),
      ).toBeUndefined();
    });

    it('should split on the first equals only', () => {
      // A percent-encoded value can legitimately contain '='.
      expect(readCookie(requestWith('sops_rt=a=b=c'), 'sops_rt')).toBe('a=b=c');
    });

    it('should percent-decode the value', () => {
      expect(readCookie(requestWith('sops_rt=a%20b'), 'sops_rt')).toBe('a b');
    });

    it('should return the raw value when the escape is malformed', () => {
      // A malformed cookie is a failed lookup, not a crash.
      expect(readCookie(requestWith('sops_rt=100%'), 'sops_rt')).toBe('100%');
    });

    it.each<[string | undefined, string]>([
      [undefined, 'no cookie header'],
      ['', 'an empty header'],
      ['garbage', 'a header with no equals'],
      ['=novalue', 'a nameless entry'],
      ['other=1', 'a header without the target'],
    ])('should return undefined for %j: %s', (header) => {
      expect(readCookie(requestWith(header), 'sops_rt')).toBeUndefined();
    });
  });

  describe('readRefreshCookie', () => {
    it('should read the refresh cookie by its own name', () => {
      expect(
        readRefreshCookie(requestWith(`${REFRESH_COOKIE_NAME}=token-value`)),
      ).toBe('token-value');
    });
  });

  describe('setRefreshCookie', () => {
    it('should set the token with the hardening attributes', () => {
      const res = responseSpy();
      const expiresAt = new Date('2026-02-01T00:00:00.000Z');

      setRefreshCookie(res, 'the-token', expiresAt, config());

      expect(res.cookie).toHaveBeenCalledWith(
        REFRESH_COOKIE_NAME,
        'the-token',
        expect.objectContaining({
          httpOnly: true,
          sameSite: 'lax',
          path: '/api/v1/auth',
          expires: expiresAt,
        }),
      );
    });

    it('should scope the cookie to the auth routes, not the whole API', () => {
      const res = responseSpy();

      setRefreshCookie(res, 't', new Date(), config());

      // Narrow enough that it is not attached to every ordinary call, wide
      // enough to cover logout as well as refresh.
      expect(res.cookie.mock.calls[0][2].path).toBe('/api/v1/auth');
    });

    it.each([
      [true, 'production'],
      [false, 'development'],
    ])('should set secure=%s for %s', (secure) => {
      const res = responseSpy();

      setRefreshCookie(res, 't', new Date(), config(secure));

      expect(res.cookie.mock.calls[0][2].secure).toBe(secure);
    });

    it('should pin expiry to the token rather than recomputing it', () => {
      // The cookie and the database row must not disagree about when the
      // session ends.
      const res = responseSpy();
      const expiresAt = new Date('2026-03-04T05:06:07.000Z');

      setRefreshCookie(res, 't', expiresAt, config());

      expect(res.cookie.mock.calls[0][2].expires).toBe(expiresAt);
    });
  });

  describe('clearRefreshCookie', () => {
    it('should clear with attributes matching the ones it was set with', () => {
      // A browser only replaces a cookie when name, domain, and path agree, so
      // a mismatched path here means logout silently leaves the cookie behind.
      const setRes = responseSpy();
      const clearRes = responseSpy();

      setRefreshCookie(setRes, 't', new Date(), config());
      clearRefreshCookie(clearRes, config());

      const setOptions = setRes.cookie.mock.calls[0][2];
      const clearOptions = clearRes.clearCookie.mock.calls[0][1];

      expect(clearRes.clearCookie).toHaveBeenCalledWith(
        REFRESH_COOKIE_NAME,
        expect.any(Object),
      );
      expect(clearOptions.path).toBe(setOptions.path);
      expect(clearOptions.httpOnly).toBe(setOptions.httpOnly);
      expect(clearOptions.sameSite).toBe(setOptions.sameSite);
      expect(clearOptions.secure).toBe(setOptions.secure);
    });
  });
});
