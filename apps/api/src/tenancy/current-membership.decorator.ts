import { createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';

import { getRequestOrganization } from '../common/request-context.js';
import type { OrganizationContext } from '../common/request-context.js';

/**
 * The membership that admitted this request to its organization: the
 * organization id, the membership id, and the role.
 *
 * Named for what it returns — a grant, not an Organization row. The handler
 * passes `organizationId` from it to the service explicitly; services never
 * read the request context for it.
 */
export const CurrentMembership = createParamDecorator(
  (_data: unknown, _context: ExecutionContext): OrganizationContext => {
    const organization = getRequestOrganization();

    if (!organization) {
      // Only reachable on a controller not declared with
      // @OrganizationController(). A wiring mistake, so a masked 500 — the same
      // stance CurrentUserId takes — and never a request that proceeds
      // without a tenant.
      throw new Error(
        'CurrentMembership was read on a route with no admitted organization. ' +
          'Declare the controller with @OrganizationController().',
      );
    }

    return organization;
  },
);
