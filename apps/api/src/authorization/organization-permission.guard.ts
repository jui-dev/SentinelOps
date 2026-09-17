import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { getRequestOrganization } from '../common/request-context.js';
import { REQUIRED_PERMISSION_KEY } from './authorization.constants.js';
import { permissionDenied } from './authorization.errors.js';
import type { Permission } from './permissions.js';
import { hasPermission } from './role-permissions.js';

/**
 * Authorization: lets an admitted member through only if their role holds the
 * permission the handler declares.
 *
 * An additional layer, not a replacement. It decides nothing about which
 * organization the request is in, or whether any row belongs to it — the
 * services still scope every query by organizationId themselves.
 *
 * The role is the one OrganizationMembershipGuard resolved for this request,
 * read from the request context. No second lookup, and nothing from the token,
 * query string, headers, or body.
 *
 * Attached per handler by `@RequirePermission()`, never as an APP_GUARD. Nest
 * runs method guards after controller guards, so admission has recorded the
 * membership by the time this runs.
 *
 * Synchronous, and reads no database.
 */
@Injectable()
export class OrganizationPermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const permission = this.reflector.get<Permission | undefined>(
      REQUIRED_PERMISSION_KEY,
      context.getHandler(),
    );

    if (!permission) {
      // Only reachable by attaching this guard without the decorator. A
      // wiring mistake: a masked 500, never an unconditional pass.
      throw new Error(
        'Authorization ran on a handler that declares no permission. ' +
          'Attach it with @RequirePermission().',
      );
    }

    const organization = getRequestOrganization();

    if (!organization) {
      // A permission declared on a route that admitted no organization. With
      // no role to check there is nothing to allow — so a masked 500 with the
      // cause in the log, never a pass.
      throw new Error(
        'Authorization ran with no admitted organization. ' +
          'Declare the controller with @OrganizationController().',
      );
    }

    if (!hasPermission(organization.role, permission)) {
      throw permissionDenied();
    }

    return true;
  }
}
