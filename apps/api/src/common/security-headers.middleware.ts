import { Injectable } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * The security headers every API response carries — success, error, and
 * unmatched path alike. The API only ever answers JSON, so the set is short
 * and strict, written out here rather than taken from a package whose
 * defaults are tuned for HTML pages.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  // A response is what its Content-Type says, never sniffed into something
  // a browser would run.
  'X-Content-Type-Options': 'nosniff',
  // Nothing in a response may load anything, and no page may frame one.
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  // A link followed from a response says nothing of where it came from.
  'Referrer-Policy': 'no-referrer',
  // Responses carry tokens and private data: nothing may keep a copy.
  'Cache-Control': 'no-store',
  // HTTPS from now on, for a year. Browsers ignore it over plain HTTP and on
  // localhost, so sending it always is safe in development.
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  use(_req: Request, res: Response, next: NextFunction): void {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      res.setHeader(name, value);
    }

    // Says which server software answers, which helps nobody but an attacker.
    res.removeHeader('X-Powered-By');

    next();
  }
}
