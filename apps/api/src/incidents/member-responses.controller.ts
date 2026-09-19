import { Get, Param, Query } from '@nestjs/common';

import { Permission } from '../authorization/permissions.js';
import { RequirePermission } from '../authorization/require-permission.decorator.js';
import type { OrganizationContext } from '../common/request-context.js';
import { CurrentMembership } from '../tenancy/current-membership.decorator.js';
import { OrganizationController } from '../tenancy/organization-controller.decorator.js';
import type { MemberResponsePage } from './incidents.contract.js';
import { memberResponsesQuerySchema } from './incidents.schemas.js';
import type { MemberResponsesQuery } from './incidents.schemas.js';
import { IncidentsService } from './incidents.service.js';

/**
 * A member's responses to incidents, addressed under the membership they
 * belong to. It lives with incidents, not organizations, because what it
 * returns is incident data: `incidents:read`, which every role holds, as
 * reading any incident's responders does. The membership is resolved within
 * the admitted organization by IncidentsService, with the same 404 the
 * membership routes give.
 */
@OrganizationController('memberships/:membershipId/responses')
export class MemberResponsesController {
  constructor(private readonly incidents: IncidentsService) {}

  /** One page of the member's responses, the most recently started first. */
  @Get()
  @RequirePermission(Permission.INCIDENTS_READ)
  list(
    @CurrentMembership() membership: OrganizationContext,
    @Param('membershipId') membershipId: string,
    @Query({ schema: memberResponsesQuerySchema }) query: MemberResponsesQuery,
  ): Promise<MemberResponsePage> {
    return this.incidents.memberResponses(
      membership.organizationId,
      membershipId,
      query,
    );
  }
}
