import {
  Body,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';

import { Permission } from '../authorization/permissions.js';
import { RequirePermission } from '../authorization/require-permission.decorator.js';
import type { OrganizationContext } from '../common/request-context.js';
import { CurrentMembership } from '../tenancy/current-membership.decorator.js';
import { OrganizationController } from '../tenancy/organization-controller.decorator.js';
import type { TeamMemberResponse, TeamResponse } from './teams.contract.js';
import {
  addTeamMemberSchema,
  createTeamSchema,
  updateTeamSchema,
} from './teams.schemas.js';
import type {
  AddTeamMemberRequest,
  CreateTeamRequest,
  UpdateTeamRequest,
} from './teams.schemas.js';
import { TeamsService } from './teams.service.js';

/**
 * An organization's teams and who is on them.
 *
 * The same three layers as every organization route: admission by
 * `@OrganizationController()`, authorization by `@RequirePermission()`, and
 * isolation in the service. Every member may read; changing anything needs
 * `teams:manage`.
 *
 * Path ids are validated in the service, so a malformed one answers 404 like
 * any other id this organization lacks.
 */
@OrganizationController('teams')
export class TeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  @RequirePermission(Permission.TEAMS_READ)
  list(
    @CurrentMembership() membership: OrganizationContext,
  ): Promise<TeamResponse[]> {
    return this.teams.list(membership.organizationId);
  }

  /** Creates a team. The slug is derived from the name, never supplied. */
  @Post()
  @RequirePermission(Permission.TEAMS_MANAGE)
  create(
    @CurrentMembership() membership: OrganizationContext,
    @Body({ schema: createTeamSchema }) body: CreateTeamRequest,
  ): Promise<TeamResponse> {
    return this.teams.create(membership.organizationId, body);
  }

  @Get(':teamId')
  @RequirePermission(Permission.TEAMS_READ)
  get(
    @CurrentMembership() membership: OrganizationContext,
    @Param('teamId') teamId: string,
  ): Promise<TeamResponse> {
    return this.teams.get(membership.organizationId, teamId);
  }

  /** Renames a team or changes its description. The slug never changes. */
  @Patch(':teamId')
  @RequirePermission(Permission.TEAMS_MANAGE)
  update(
    @CurrentMembership() membership: OrganizationContext,
    @Param('teamId') teamId: string,
    @Body({ schema: updateTeamSchema }) body: UpdateTeamRequest,
  ): Promise<TeamResponse> {
    return this.teams.update(membership.organizationId, teamId, body);
  }

  /** Deletes a team. Its members stay in the organization. */
  @Delete(':teamId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.TEAMS_MANAGE)
  delete(
    @CurrentMembership() membership: OrganizationContext,
    @Param('teamId') teamId: string,
  ): Promise<void> {
    return this.teams.delete(membership.organizationId, teamId);
  }

  @Get(':teamId/members')
  @RequirePermission(Permission.TEAMS_READ)
  listMembers(
    @CurrentMembership() membership: OrganizationContext,
    @Param('teamId') teamId: string,
  ): Promise<TeamMemberResponse[]> {
    return this.teams.listMembers(membership.organizationId, teamId);
  }

  /**
   * Puts an existing organization member, by membership id, on the team,
   * and tells them. The actor is the admitted member.
   */
  @Post(':teamId/members')
  @RequirePermission(Permission.TEAMS_MANAGE)
  addMember(
    @CurrentMembership() membership: OrganizationContext,
    @Param('teamId') teamId: string,
    @Body({ schema: addTeamMemberSchema }) body: AddTeamMemberRequest,
  ): Promise<TeamMemberResponse> {
    return this.teams.addMember(membership.organizationId, teamId, body, {
      membershipId: membership.membershipId,
    });
  }

  /**
   * Takes a member off the team, addressed by their membership id, and
   * tells them. The actor is the admitted member.
   */
  @Delete(':teamId/members/:membershipId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.TEAMS_MANAGE)
  removeMember(
    @CurrentMembership() membership: OrganizationContext,
    @Param('teamId') teamId: string,
    @Param('membershipId') membershipId: string,
  ): Promise<void> {
    return this.teams.removeMember(
      membership.organizationId,
      teamId,
      membershipId,
      { membershipId: membership.membershipId },
    );
  }
}
