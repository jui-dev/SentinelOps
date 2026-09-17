import { Get, Param } from '@nestjs/common';

import type { OrganizationContext } from '../common/request-context.js';
import { CurrentMembership } from '../tenancy/current-membership.decorator.js';
import { OrganizationController } from '../tenancy/organization-controller.decorator.js';
import type {
  OrganizationDetailResponse,
  OrganizationMembershipResponse,
} from './organizations.contract.js';
import { OrganizationsService } from './organizations.service.js';

/**
 * Read-only routes within one organization.
 *
 * `@OrganizationController()` admits the request: the caller is a current
 * member of the organization named in the path. Each handler then passes the
 * admitted organization id to the service explicitly, and the service scopes
 * every query by it. Role is available on the membership but is not enforced
 * here; every member may read these.
 */
@OrganizationController()
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  /** The organization and the caller's membership in it. */
  @Get()
  getOrganization(
    @CurrentMembership() membership: OrganizationContext,
  ): Promise<OrganizationDetailResponse> {
    return this.organizations.getOrganization(membership.organizationId, {
      membershipId: membership.membershipId,
      role: membership.role,
    });
  }

  /** Every membership record in the organization. */
  @Get('memberships')
  listMemberships(
    @CurrentMembership() membership: OrganizationContext,
  ): Promise<OrganizationMembershipResponse[]> {
    return this.organizations.listMemberships(membership.organizationId);
  }

  /**
   * One membership record. Deliberately validated in the service rather than
   * with a param schema: a malformed id answers 404, like any other id that
   * names nothing in this organization, instead of a 400.
   */
  @Get('memberships/:membershipId')
  getMembership(
    @CurrentMembership() membership: OrganizationContext,
    @Param('membershipId') membershipId: string,
  ): Promise<OrganizationMembershipResponse> {
    return this.organizations.getMembership(
      membership.organizationId,
      membershipId,
    );
  }
}
