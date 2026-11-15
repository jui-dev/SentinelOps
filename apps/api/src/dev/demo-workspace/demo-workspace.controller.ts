import { Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';

import { CurrentUserId } from '../../auth/current-user.decorator.js';
import { Permission } from '../../authorization/permissions.js';
import { RequirePermission } from '../../authorization/require-permission.decorator.js';
import type { OrganizationContext } from '../../common/request-context.js';
import { CurrentMembership } from '../../tenancy/current-membership.decorator.js';
import { OrganizationController } from '../../tenancy/organization-controller.decorator.js';
import { isDemoPart } from './demo-parts.js';
import type { DemoPart } from './demo-parts.js';
import type { DemoWorkspaceResponse } from './demo-workspace.contract.js';
import { demoPartNotFound } from './demo-workspace.errors.js';
import { DemoWorkspaceService } from './demo-workspace.service.js';

const partOf = (value: string): DemoPart => {
  if (!isDemoPart(value)) throw demoPartNotFound();

  return value;
};

/**
 * TEMPORARY — the demo workspace, for its Admin: what is loaded, and the
 * buttons that generate, remove, and reset it. Admission, then
 * `organization:update` — the Admin's, as Settings is — then the service,
 * which answers 404 outside development or for an organization that is not
 * a demo. Every change answers with the workspace as it now stands.
 */
@OrganizationController('demo')
export class DemoWorkspaceController {
  constructor(private readonly demo: DemoWorkspaceService) {}

  @Get()
  @RequirePermission(Permission.ORGANIZATION_UPDATE)
  status(
    @CurrentMembership() membership: OrganizationContext,
  ): Promise<DemoWorkspaceResponse> {
    return this.demo.status(membership.organizationId);
  }

  @Post('parts/:part')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.ORGANIZATION_UPDATE)
  generate(
    @CurrentMembership() membership: OrganizationContext,
    @Param('part') part: string,
  ): Promise<DemoWorkspaceResponse> {
    return this.demo.generate(membership.organizationId, partOf(part));
  }

  @Delete('parts/:part')
  @RequirePermission(Permission.ORGANIZATION_UPDATE)
  remove(
    @CurrentMembership() membership: OrganizationContext,
    @Param('part') part: string,
  ): Promise<DemoWorkspaceResponse> {
    return this.demo.remove(membership.organizationId, partOf(part));
  }

  @Post('reset')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.ORGANIZATION_UPDATE)
  reset(
    @CurrentMembership() membership: OrganizationContext,
    @CurrentUserId() userId: string,
  ): Promise<DemoWorkspaceResponse> {
    return this.demo.reset(membership.organizationId, userId);
  }

  @Delete()
  @RequirePermission(Permission.ORGANIZATION_UPDATE)
  removeAll(
    @CurrentMembership() membership: OrganizationContext,
  ): Promise<DemoWorkspaceResponse> {
    return this.demo.removeAll(membership.organizationId);
  }
}
