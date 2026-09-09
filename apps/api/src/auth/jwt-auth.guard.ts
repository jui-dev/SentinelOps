import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { setRequestUser } from '../common/request-context.js';
import { unauthenticated } from './auth.errors.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import { TokenService } from './token.service.js';

/**
 * Pulls the credential out of `Authorization: Bearer <token>`.
 *
 * Split on whitespace rather than a single space, because clients do send
 * `Bearer  token`. The scheme is compared case-insensitively, as RFC 7235
 * requires.
 */
const extractBearerToken = (request: Request): string | undefined => {
  const header = request.headers?.authorization;

  if (typeof header !== 'string') {
    return undefined;
  }

  const [scheme, ...rest] = header.trim().split(/\s+/);

  if (scheme?.toLowerCase() !== 'bearer') {
    return undefined;
  }

  const token = rest.join(' ');

  return token.length > 0 ? token : undefined;
};

/**
 * Authenticates every request that is not explicitly marked `@Public()`.
 *
 * Registered as an APP_GUARD in AuthModule, so protection is the default and
 * opening a route is a deliberate, visible act.
 *
 * It reads no database. Verifying a signature is arithmetic; a lookup would put
 * a query on every authenticated request in order to catch a user deleted
 * within the access token's short lifetime. Revocation is enforced at refresh,
 * where the cost is paid once per token rotation instead of once per request.
 * The consequence, stated plainly: a soft-deleted user keeps working until
 * their access token expires.
 *
 * On success the user id goes into the request context rather than onto the
 * Express request, which is what lets every subsequent log line carry it
 * without a single call site passing it along.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Handler first, then class: a @Public() route inside a protected
    // controller is public, which is the direction that has to work for auth's
    // own controller.
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);

    if (!token) {
      throw unauthenticated('Authentication required');
    }

    let sub: string;

    try {
      ({ sub } = await this.tokens.verifyAccessToken(token));
    } catch {
      // The reason is deliberately not relayed. "Signature invalid" and
      // "expired" tell a caller which half of a forged token to fix; a client
      // with a legitimately expired token refreshes on the 401 either way.
      throw unauthenticated('Invalid or expired access token');
    }

    if (!sub) {
      // A token signed with our key and issuer but carrying no subject is not
      // one this application minted.
      throw unauthenticated('Invalid or expired access token');
    }

    setRequestUser(sub);

    return true;
  }
}
