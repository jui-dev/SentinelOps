import {
  Body,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';

import { CurrentUserId } from '../auth/current-user.decorator.js';
import { Permission } from '../authorization/permissions.js';
import { RequirePermission } from '../authorization/require-permission.decorator.js';
import type { OrganizationContext } from '../common/request-context.js';
import { CurrentMembership } from '../tenancy/current-membership.decorator.js';
import { OrganizationController } from '../tenancy/organization-controller.decorator.js';
import type {
  CreatedInvitationResponse,
  InvitationResponse,
} from './invitations.contract.js';
import { createInvitationSchema } from './invitations.schemas.js';
import type { CreateInvitationRequest } from './invitations.schemas.js';
import { InvitationsService } from './invitations.service.js';

/**
 * An organization's invitations, managed by the organization.
 *
 * The same three layers as every organization route: admission by
 * `@OrganizationController()`, authorization by `@RequirePermission()`, and
 * isolation in the service, which scopes every query by the organization id
 * passed here. Listing needs `invitations:read`; creating and revoking need
 * `invitations:manage`.
 */
@OrganizationController('invitations')
export class OrganizationInvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  /**
   * Invites an email address, replacing any open invitation for it. The
   * response is the only place the token ever appears.
   */
  @Post()
  @RequirePermission(Permission.INVITATIONS_MANAGE)
  create(
    @CurrentMembership() membership: OrganizationContext,
    @CurrentUserId() userId: string,
    @Body({ schema: createInvitationSchema }) body: CreateInvitationRequest,
  ): Promise<CreatedInvitationResponse> {
    return this.invitations.create(membership.organizationId, { userId }, body);
  }

  /** Every open invitation, pending or expired. */
  @Get()
  @RequirePermission(Permission.INVITATIONS_READ)
  list(
    @CurrentMembership() membership: OrganizationContext,
  ): Promise<InvitationResponse[]> {
    return this.invitations.listOpen(membership.organizationId);
  }

  /**
   * Revokes an open invitation. The id is validated in the service, so a
   * malformed one answers 404 like any other id this organization lacks.
   */
  @Delete(':invitationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.INVITATIONS_MANAGE)
  revoke(
    @CurrentMembership() membership: OrganizationContext,
    @Param('invitationId') invitationId: string,
    @CurrentUserId() userId: string,
  ): Promise<void> {
    return this.invitations.revoke(
      membership.organizationId,
      invitationId,
      userId,
    );
  }
}
