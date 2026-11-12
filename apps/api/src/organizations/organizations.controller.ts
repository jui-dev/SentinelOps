import { Body, Get, Param, Patch, Post, Put } from '@nestjs/common';

import type { OrganizationResponse } from '../auth/auth.contract.js';
import { Permission } from '../authorization/permissions.js';
import { RequirePermission } from '../authorization/require-permission.decorator.js';
import type { OrganizationContext } from '../common/request-context.js';
import { CurrentMembership } from '../tenancy/current-membership.decorator.js';
import { OrganizationController } from '../tenancy/organization-controller.decorator.js';
import type {
  OrganizationDetailResponse,
  OrganizationMembershipResponse,
  OrganizationRoleResponse,
} from './organizations.contract.js';
import {
  changeRoleSchema,
  createMemberSchema,
  resetPasswordSchema,
  updateOrganizationSchema,
} from './organizations.schemas.js';
import type {
  ChangeRoleRequest,
  CreateMemberRequest,
  ResetPasswordRequest,
  UpdateOrganizationRequest,
} from './organizations.schemas.js';
import { OrganizationsService } from './organizations.service.js';

/**
 * Routes on the organization itself and its membership records.
 *
 * Three layers, each on its own: `@OrganizationController()` admits the
 * request (the caller is a current member of the organization in the path);
 * `@RequirePermission()` authorizes it (the caller's role holds what the
 * handler needs); and the service isolates it, scoping every query by the
 * organization id the handler passes explicitly. Every member may read;
 * renaming needs `organization:update`, and adding a member `members:manage`.
 */
@OrganizationController()
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  /** The organization and the caller's membership in it. */
  @Get()
  @RequirePermission(Permission.ORGANIZATION_READ)
  getOrganization(
    @CurrentMembership() membership: OrganizationContext,
  ): Promise<OrganizationDetailResponse> {
    return this.organizations.getOrganization(membership.organizationId, {
      membershipId: membership.membershipId,
      role: membership.role,
    });
  }

  /**
   * Renames the organization. The body is strict: `name` and nothing else, so
   * the slug, a role, or another organization cannot ride along.
   *
   * Guards run before pipes, so a member without the permission is refused
   * with 403 before their body is even validated.
   */
  @Patch()
  @RequirePermission(Permission.ORGANIZATION_UPDATE)
  updateOrganization(
    @CurrentMembership() membership: OrganizationContext,
    @Body({ schema: updateOrganizationSchema })
    body: UpdateOrganizationRequest,
  ): Promise<OrganizationResponse> {
    return this.organizations.updateOrganization(
      membership.organizationId,
      body,
    );
  }

  /**
   * The organization's roles: what each permits, and how many hold it.
   * Every member may read them, to know what their own role and everyone
   * else's is for.
   */
  @Get('roles')
  @RequirePermission(Permission.ORGANIZATION_READ)
  listRoles(
    @CurrentMembership() membership: OrganizationContext,
  ): Promise<OrganizationRoleResponse[]> {
    return this.organizations.listRoles(membership.organizationId);
  }

  /** Every membership record in the organization. */
  @Get('memberships')
  @RequirePermission(Permission.MEMBERSHIPS_READ)
  listMemberships(
    @CurrentMembership() membership: OrganizationContext,
  ): Promise<OrganizationMembershipResponse[]> {
    return this.organizations.listMemberships(membership.organizationId, {
      membershipId: membership.membershipId,
      role: membership.role,
    });
  }

  /**
   * Adds a person in the role chosen for them: creates their account with a one-time
   * password, their membership here, and — optionally — their places on
   * this organization's teams, all or nothing. They must choose their own password before they can do
   * anything else. 201, with the new membership as the list shows one; the
   * password is never echoed.
   */
  @Post('memberships')
  @RequirePermission(Permission.MEMBERS_MANAGE)
  createMember(
    @CurrentMembership() membership: OrganizationContext,
    @Body({ schema: createMemberSchema }) body: CreateMemberRequest,
  ): Promise<OrganizationMembershipResponse> {
    return this.organizations.createMember(membership.organizationId, body);
  }

  /**
   * Gives a member a different role. 200 with the member as the list shows
   * one; 409 LAST_ADMIN for the organization's only Admin.
   */
  @Put('memberships/:membershipId/role')
  @RequirePermission(Permission.MEMBERS_MANAGE)
  changeRole(
    @CurrentMembership() membership: OrganizationContext,
    @Param('membershipId') membershipId: string,
    @Body({ schema: changeRoleSchema }) body: ChangeRoleRequest,
  ): Promise<OrganizationMembershipResponse> {
    return this.organizations.changeRole(
      membership.organizationId,
      membershipId,
      body,
    );
  }

  /**
   * Gives a member a new one-time password, and ends their sessions. 200 with
   * the member, marked to choose their own password at next sign-in; the
   * password is never echoed. 409 for the caller's own membership, or for
   * someone who also belongs to another organization.
   */
  @Put('memberships/:membershipId/password')
  @RequirePermission(Permission.MEMBERS_MANAGE)
  resetPassword(
    @CurrentMembership() membership: OrganizationContext,
    @Param('membershipId') membershipId: string,
    @Body({ schema: resetPasswordSchema }) body: ResetPasswordRequest,
  ): Promise<OrganizationMembershipResponse> {
    return this.organizations.resetPassword(
      membership.organizationId,
      membershipId,
      body,
      { membershipId: membership.membershipId },
    );
  }

  /**
   * One membership record. Deliberately validated in the service rather than
   * with a param schema: a malformed id answers 404, like any other id that
   * names nothing in this organization, instead of a 400.
   */
  @Get('memberships/:membershipId')
  @RequirePermission(Permission.MEMBERSHIPS_READ)
  getMembership(
    @CurrentMembership() membership: OrganizationContext,
    @Param('membershipId') membershipId: string,
  ): Promise<OrganizationMembershipResponse> {
    return this.organizations.getMembership(
      membership.organizationId,
      membershipId,
      { membershipId: membership.membershipId, role: membership.role },
    );
  }
}
