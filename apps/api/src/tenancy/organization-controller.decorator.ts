import {
  applyDecorators,
  Controller,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';

import { OrganizationMembershipGuard } from './organization-membership.guard.js';
import { IS_ORGANIZATION_SCOPED_KEY } from './tenancy.constants.js';

/**
 * The prefix every organization-scoped route lives under.
 *
 * This file is the only place in src/ allowed to spell the parameter as a
 * route segment. An architecture spec enforces that, which is what makes it
 * impossible to declare a tenant route without also attaching admission.
 *
 * Written out literally so that spec has something to find; its segment name
 * must equal ORGANIZATION_ID_PARAM, which the guard reads.
 */
const ORGANIZATION_ROUTE_PREFIX = 'organizations/:organizationId';

/**
 * Declares a controller whose routes act within one organization.
 *
 * The route prefix and the admission guard arrive together, so neither can be
 * forgotten without the other. `subpath` extends the prefix:
 * `@OrganizationController('memberships')` serves
 * `organizations/:organizationId/memberships`.
 *
 * This provides admission only. Handlers still pass the admitted
 * organizationId to their service explicitly, and every query scopes by it.
 */
export const OrganizationController = (subpath = ''): ClassDecorator => {
  const trimmed = subpath.replace(/^\/+|\/+$/g, '');
  const path = trimmed
    ? `${ORGANIZATION_ROUTE_PREFIX}/${trimmed}`
    : ORGANIZATION_ROUTE_PREFIX;

  return applyDecorators(
    Controller(path),
    SetMetadata(IS_ORGANIZATION_SCOPED_KEY, true),
    UseGuards(OrganizationMembershipGuard),
  );
};
