import type { Request, Response } from 'express';

import type { authConfig } from '../config/configuration.js';
import type { ConfigType } from '@nestjs/config';

type AuthConfig = ConfigType<typeof authConfig>;

/**
 * The refresh cookie's name. Prefixed rather than bare so it reads as this
 * application's in a browser holding cookies from several.
 */
export const REFRESH_COOKIE_NAME = 'sops_rt';

/**
 * Reads one cookie from the request header.
 *
 * Hand-parsed rather than adding cookie-parser: Express 5 already provides
 * `res.cookie()` for the write side, so a dependency would buy the read of a
 * single known name. The parsing that matters is minimal, and doing it here
 * keeps it visible and tested.
 *
 * Splits on ';' and on the *first* '=' only, because a base64url value never
 * contains '=' but a percent-encoded one can.
 */
export const readCookie = (req: Request, name: string): string | undefined => {
  const header = req.headers?.cookie;

  if (typeof header !== 'string' || header.length === 0) {
    return undefined;
  }

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');

    if (separator < 1) {
      continue;
    }

    if (part.slice(0, separator).trim() !== name) {
      continue;
    }

    const value = part.slice(separator + 1).trim();

    try {
      return decodeURIComponent(value);
    } catch {
      // A malformed percent-escape is a malformed cookie, not a crash.
      return value;
    }
  }

  return undefined;
};

/**
 * The attributes the refresh cookie is always set and always cleared with.
 *
 * They must match on both operations: a browser only replaces a cookie when the
 * name, domain, and path all agree, so clearing with a different path leaves
 * the original in place and logout silently fails.
 *
 * - httpOnly: script cannot read it, so an XSS does not walk away with the
 *   session.
 * - sameSite lax: the browser will not attach it to a cross-site POST, which is
 *   what stands in for a CSRF token here.
 * - secure in production only, because localhost is not served over TLS.
 * - path scoped to the auth routes, so it is not sent with every API call. It
 *   covers logout as well as refresh, both of which need it.
 */
const baseOptions = (config: AuthConfig) =>
  ({
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: config.cookiePath,
  }) as const;

export const setRefreshCookie = (
  res: Response,
  token: string,
  expiresAt: Date,
  config: AuthConfig,
): void => {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    ...baseOptions(config),
    // Pinned to the token's own expiry rather than recomputed from the TTL, so
    // the cookie and the database row can never disagree about when a session
    // ends.
    expires: expiresAt,
  });
};

export const clearRefreshCookie = (res: Response, config: AuthConfig): void => {
  res.clearCookie(REFRESH_COOKIE_NAME, baseOptions(config));
};

export const readRefreshCookie = (req: Request): string | undefined =>
  readCookie(req, REFRESH_COOKIE_NAME);
