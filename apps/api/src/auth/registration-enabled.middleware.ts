import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';

import { featuresConfig } from '../config/configuration.js';

/**
 * Makes `POST /auth/register` disappear while REGISTRATION_ENABLED is off,
 * so nobody can create an organization from the website. Organizations are
 * then created by whoever runs the server, who switches it on for as long as
 * that takes; people join one only when its Admin adds them.
 *
 * Middleware rather than a guard, as for invitations: it runs before every
 * guard and pipe, so a closed route answers with the same 404 — same status,
 * same message shape, no code — as a path that was never declared, and its
 * body is never read.
 */
@Injectable()
export class RegistrationEnabledMiddleware implements NestMiddleware {
  constructor(
    @Inject(featuresConfig.KEY)
    private readonly features: ConfigType<typeof featuresConfig>,
  ) {}

  use(req: Request, _res: Response, next: NextFunction): void {
    if (this.features.registrationEnabled) {
      next();
      return;
    }

    // Nest's own wording for an unmatched route, without the query string.
    const path = req.originalUrl.split('?')[0];

    next(new NotFoundException(`Cannot ${req.method} ${path}`));
  }
}
