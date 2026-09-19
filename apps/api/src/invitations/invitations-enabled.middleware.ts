import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';

import { featuresConfig } from '../config/configuration.js';

/**
 * Makes every invitation route disappear while INVITATIONS_ENABLED is off.
 *
 * Middleware rather than a guard, because middleware runs before every guard:
 * a guard would let the global JwtAuthGuard answer an anonymous call first,
 * and a 401 from `/invitations/accept` would confirm the route exists. Here
 * each route answers with the same 404 — same status, same message shape, no
 * code — as a path that was never declared.
 *
 * The code, tables, and tests stay: switching the flag on restores the
 * feature unchanged.
 */
@Injectable()
export class InvitationsEnabledMiddleware implements NestMiddleware {
  constructor(
    @Inject(featuresConfig.KEY)
    private readonly features: ConfigType<typeof featuresConfig>,
  ) {}

  use(req: Request, _res: Response, next: NextFunction): void {
    if (this.features.invitationsEnabled) {
      next();
      return;
    }

    // Nest's own wording for an unmatched route. The query string is left
    // out, as a route that does not exist has no business echoing one.
    const path = req.originalUrl.split('?')[0];

    next(new NotFoundException(`Cannot ${req.method} ${path}`));
  }
}
