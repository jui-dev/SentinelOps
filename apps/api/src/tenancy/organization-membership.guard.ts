import { Injectable } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { REQUIRED_PERMISSION_KEY } from '../authorization/authorization.constants.js';
import {
  getRequestUser,
  setRequestOrganization,
} from '../common/request-context.js';
import { MembershipResolver } from './membership-resolver.service.js';
import { ORGANIZATION_ID_PARAM } from './tenancy.constants.js';
import { organizationNotFound } from './tenancy.errors.js';
import { isResourceId } from './tenancy.schemas.js';

/**
 * Tenant admission: lets a request into an organization only if the caller is
 * a current member of it.
 *
 * Admission is not resource isolation. Passing this guard means the caller may
 * act within `organizationId`; it says nothing about whether a resource id
 * elsewhere in the URL belongs to that organization. Every tenant-owned query
 * must still scope by organizationId itself — `{ id, organizationId }`, never
 * a lookup by id alone followed by a check.
 *
 * The organization comes from the route parameter and from nowhere else. The
 * query string, headers, and body are never consulted, so a client cannot
 * steer a request into another tenant by adding a field.
 *
 * Attached per controller by `@OrganizationController()`, never as an
 * APP_GUARD. Nest always runs global guards before controller guards, so
 * JwtAuthGuard has established the user by the time this runs, without
 * depending on the registration order of two global guards.
 *
 * It also refuses to admit a request to a handler that declares no permission.
 * That is a wiring check, not authorization — OrganizationPermissionGuard does
 * the checking — but this guard is the one every organization route is
 * certain to run, which is what makes forgetting `@RequirePermission()` a
 * failure rather than a route open to every member.
 */
@Injectable()
export class OrganizationMembershipGuard implements CanActivate {
  constructor(
    private readonly memberships: MembershipResolver,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Checked first, before anything is read or queried: a handler with no
    // declared permission is a wiring mistake whoever the caller is.
    const permission: unknown = this.reflector.get(
      REQUIRED_PERMISSION_KEY,
      context.getHandler(),
    );

    if (!permission) {
      throw new Error(
        'Organization-scoped handlers must declare a permission. ' +
          'Add @RequirePermission() to the handler.',
      );
    }

    const userId = getRequestUser();

    if (!userId) {
      // Only reachable on a route the JWT guard does not protect. That is a
      // wiring mistake, not a client error: a masked 500 with the cause in the
      // log, and never an anonymous admission.
      throw new Error(
        'Organization admission ran with no authenticated user. ' +
          'Remove @Public() from organization-scoped routes.',
      );
    }

    const request = context.switchToHttp().getRequest<Request>();
    const organizationId: unknown = request.params?.[ORGANIZATION_ID_PARAM];

    if (typeof organizationId !== 'string') {
      throw new Error(
        `Organization admission ran on a route without a :${ORGANIZATION_ID_PARAM} ` +
          'parameter. Declare organization-scoped controllers with @OrganizationController().',
      );
    }

    // A malformed id names no organization. Answered without a query, and
    // with the same 404 as every other failure below.
    if (!isResourceId(organizationId)) {
      throw organizationNotFound();
    }

    const organization = await this.memberships.resolve(userId, organizationId);

    if (!organization) {
      throw organizationNotFound();
    }

    setRequestOrganization(organization);

    return true;
  }
}
