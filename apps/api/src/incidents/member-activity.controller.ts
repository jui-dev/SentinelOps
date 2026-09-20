import { Get, Param, Query } from '@nestjs/common';

import { Permission } from '../authorization/permissions.js';
import { RequirePermission } from '../authorization/require-permission.decorator.js';
import type { OrganizationContext } from '../common/request-context.js';
import { CurrentMembership } from '../tenancy/current-membership.decorator.js';
import { OrganizationController } from '../tenancy/organization-controller.decorator.js';
import type { MemberActivityResponse } from './incidents.contract.js';
import { incidentActivityQuerySchema } from './incidents.schemas.js';
import type { IncidentActivityQuery } from './incidents.schemas.js';
import { IncidentsService } from './incidents.service.js';

/**
 * When a member personally took part in incident response, addressed under
 * the membership it belongs to.
 *
 * It lives with incidents for the reason MemberResponsesController gives:
 * what it returns is incident data, so it is `incidents:read`, which every
 * role holds. Reading it is not a privilege over the member — this is the
 * organization's operational history, the same history their responses list
 * already shows, arranged by day.
 *
 * The membership is resolved within the admitted organization by
 * IncidentsService, with the same 404 the membership routes give.
 */
@OrganizationController('memberships/:membershipId/activity')
export class MemberActivityController {
  constructor(private readonly incidents: IncidentsService) {}

  /** The member's activity over a period of whole UTC days. */
  @Get()
  @RequirePermission(Permission.INCIDENTS_READ)
  activity(
    @CurrentMembership() membership: OrganizationContext,
    @Param('membershipId') membershipId: string,
    @Query({ schema: incidentActivityQuerySchema })
    query: IncidentActivityQuery,
  ): Promise<MemberActivityResponse> {
    return this.incidents.memberActivity(
      membership.organizationId,
      membershipId,
      query,
    );
  }
}
