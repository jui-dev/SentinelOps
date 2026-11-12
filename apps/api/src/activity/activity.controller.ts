import { Get, Param, Query } from '@nestjs/common';

import { Permission } from '../authorization/permissions.js';
import { RequirePermission } from '../authorization/require-permission.decorator.js';
import type { OrganizationContext } from '../common/request-context.js';
import { CurrentMembership } from '../tenancy/current-membership.decorator.js';
import { OrganizationController } from '../tenancy/organization-controller.decorator.js';
import type {
  ActivityEntryDetailResponse,
  ActivityPageResponse,
} from './activity.contract.js';
import { listActivityQuerySchema } from './activity.schemas.js';
import type { ListActivityQuery } from './activity.schemas.js';
import { ActivityService } from './activity.service.js';

/**
 * The organization's activity log, read with `activity:read` — the Admin's
 * alone. Read only: entries are written by the changes they record.
 */
@OrganizationController('activity')
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get()
  @RequirePermission(Permission.ACTIVITY_READ)
  list(
    @CurrentMembership() membership: OrganizationContext,
    @Query({ schema: listActivityQuerySchema }) query: ListActivityQuery,
  ): Promise<ActivityPageResponse> {
    return this.activity.list(membership.organizationId, query);
  }

  @Get(':entryId')
  @RequirePermission(Permission.ACTIVITY_READ)
  get(
    @CurrentMembership() membership: OrganizationContext,
    @Param('entryId') entryId: string,
  ): Promise<ActivityEntryDetailResponse> {
    return this.activity.get(membership.organizationId, entryId);
  }
}
