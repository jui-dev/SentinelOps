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
 * role holds. Reading it *is* a privilege over the member — it is the same
 * history their responses list shows, arranged by day, and a person's
 * history is not the organization's to hand to whoever asks. So whose it may
 * be is mayReadMemberHistory's judgement, made in IncidentsService from the
 * admitted membership: their own always, another member's only as oversight.
 *
 * The membership is resolved within the admitted organization there as well,
 * with the same 404 the membership routes give.
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
      { membershipId: membership.membershipId, role: membership.role },
      membershipId,
      query,
    );
  }
}
