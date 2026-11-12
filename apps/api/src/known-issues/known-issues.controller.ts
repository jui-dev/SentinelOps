import { Body, Get, Param, Patch, Post, Query } from '@nestjs/common';

import { CurrentUserId } from '../auth/current-user.decorator.js';
import { Permission } from '../authorization/permissions.js';
import { RequirePermission } from '../authorization/require-permission.decorator.js';
import type { OrganizationContext } from '../common/request-context.js';
import { CurrentMembership } from '../tenancy/current-membership.decorator.js';
import { OrganizationController } from '../tenancy/organization-controller.decorator.js';
import type { KnownIssueResponse } from './known-issues.contract.js';
import {
  createKnownIssueSchema,
  listKnownIssuesQuerySchema,
  mergeKnownIssueSchema,
  updateKnownIssueSchema,
} from './known-issues.schemas.js';
import type {
  CreateKnownIssueRequest,
  ListKnownIssuesQuery,
  MergeKnownIssueRequest,
  UpdateKnownIssueRequest,
} from './known-issues.schemas.js';
import { KnownIssuesService } from './known-issues.service.js';

/**
 * An organization's known issues. Read with `services:read`, as services
 * are — every member declares from them, or sees them on an incident. Made,
 * changed, archived and merged with `services:manage`: the Admin's.
 */
@OrganizationController('known-issues')
export class KnownIssuesController {
  constructor(private readonly knownIssues: KnownIssuesService) {}

  @Get()
  @RequirePermission(Permission.SERVICES_READ)
  list(
    @CurrentMembership() membership: OrganizationContext,
    @Query({ schema: listKnownIssuesQuerySchema }) query: ListKnownIssuesQuery,
  ): Promise<KnownIssueResponse[]> {
    return this.knownIssues.list(membership.organizationId, query);
  }

  @Post()
  @RequirePermission(Permission.SERVICES_MANAGE)
  create(
    @CurrentMembership() membership: OrganizationContext,
    @Body({ schema: createKnownIssueSchema }) body: CreateKnownIssueRequest,
    @CurrentUserId() userId: string,
  ): Promise<KnownIssueResponse> {
    return this.knownIssues.create(membership.organizationId, body, userId);
  }

  @Get(':knownIssueId')
  @RequirePermission(Permission.SERVICES_READ)
  get(
    @CurrentMembership() membership: OrganizationContext,
    @Param('knownIssueId') id: string,
  ): Promise<KnownIssueResponse> {
    return this.knownIssues.get(membership.organizationId, id);
  }

  @Patch(':knownIssueId')
  @RequirePermission(Permission.SERVICES_MANAGE)
  update(
    @CurrentMembership() membership: OrganizationContext,
    @Param('knownIssueId') id: string,
    @Body({ schema: updateKnownIssueSchema }) body: UpdateKnownIssueRequest,
    @CurrentUserId() userId: string,
  ): Promise<KnownIssueResponse> {
    return this.knownIssues.update(membership.organizationId, id, body, userId);
  }

  /** Moves its incidents into another of the same service, and removes it. */
  @Post(':knownIssueId/merge')
  @RequirePermission(Permission.SERVICES_MANAGE)
  merge(
    @CurrentMembership() membership: OrganizationContext,
    @Param('knownIssueId') id: string,
    @Body({ schema: mergeKnownIssueSchema }) body: MergeKnownIssueRequest,
    @CurrentUserId() userId: string,
  ): Promise<KnownIssueResponse> {
    return this.knownIssues.merge(membership.organizationId, id, body, userId);
  }
}
