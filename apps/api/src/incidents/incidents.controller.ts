import {
  Body,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { Permission } from '../authorization/permissions.js';
import { RequirePermission } from '../authorization/require-permission.decorator.js';
import type { OrganizationContext } from '../common/request-context.js';
import { CurrentMembership } from '../tenancy/current-membership.decorator.js';
import { OrganizationController } from '../tenancy/organization-controller.decorator.js';
import type {
  IncidentDetailResponse,
  IncidentPage,
} from './incidents.contract.js';
import {
  addResponderSchema,
  createIncidentSchema,
  listIncidentsQuerySchema,
  updateIncidentSchema,
} from './incidents.schemas.js';
import type {
  AddResponderRequest,
  CreateIncidentRequest,
  ListIncidentsQuery,
  UpdateIncidentRequest,
} from './incidents.schemas.js';
import { IncidentsService } from './incidents.service.js';

/**
 * An organization's incidents.
 *
 * The same three layers as every organization route: admission by
 * `@OrganizationController()`, authorization by `@RequirePermission()`, and
 * isolation in the service. Every role holds both incident permissions —
 * responding is members' work, not configuration — but each route still
 * declares one, so narrowing that is a change to the role table alone.
 *
 * Incidents are addressed by number, validated in the service, so a
 * malformed one answers 404 like any other number this organization lacks.
 * There is no delete: incidents are history.
 */
@OrganizationController('incidents')
export class IncidentsController {
  constructor(private readonly incidents: IncidentsService) {}

  /** One page of active or resolved incidents. */
  @Get()
  @RequirePermission(Permission.INCIDENTS_READ)
  list(
    @CurrentMembership() membership: OrganizationContext,
    @Query({ schema: listIncidentsQuerySchema }) query: ListIncidentsQuery,
  ): Promise<IncidentPage> {
    return this.incidents.list(membership.organizationId, query);
  }

  /**
   * Declares an incident. The declarer is the admitted member, the number is
   * allocated, and the responsible team is the service's owner — none of
   * them can be supplied.
   */
  @Post()
  @RequirePermission(Permission.INCIDENTS_MANAGE)
  create(
    @CurrentMembership() membership: OrganizationContext,
    @Body({ schema: createIncidentSchema }) body: CreateIncidentRequest,
  ): Promise<IncidentDetailResponse> {
    return this.incidents.create(
      membership.organizationId,
      { membershipId: membership.membershipId },
      body,
    );
  }

  @Get(':incidentNumber')
  @RequirePermission(Permission.INCIDENTS_READ)
  get(
    @CurrentMembership() membership: OrganizationContext,
    @Param('incidentNumber') incidentNumber: string,
  ): Promise<IncidentDetailResponse> {
    return this.incidents.get(membership.organizationId, incidentNumber);
  }

  /**
   * Changes an active incident's title, summary, severity, status,
   * responsible team, or lead (`leadMembershipId`, null to clear);
   * `status: 'RESOLVED'` resolves it.
   */
  @Patch(':incidentNumber')
  @RequirePermission(Permission.INCIDENTS_MANAGE)
  update(
    @CurrentMembership() membership: OrganizationContext,
    @Param('incidentNumber') incidentNumber: string,
    @Body({ schema: updateIncidentSchema }) body: UpdateIncidentRequest,
  ): Promise<IncidentDetailResponse> {
    return this.incidents.update(
      membership.organizationId,
      incidentNumber,
      body,
    );
  }

  /** Adds a member of the organization, by membership id, as a responder. */
  @Post(':incidentNumber/responders')
  @RequirePermission(Permission.INCIDENTS_MANAGE)
  addResponder(
    @CurrentMembership() membership: OrganizationContext,
    @Param('incidentNumber') incidentNumber: string,
    @Body({ schema: addResponderSchema }) body: AddResponderRequest,
  ): Promise<IncidentDetailResponse> {
    return this.incidents.addResponder(
      membership.organizationId,
      incidentNumber,
      body,
    );
  }

  /** Takes a responder off the incident, addressed by their membership id. */
  @Delete(':incidentNumber/responders/:membershipId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.INCIDENTS_MANAGE)
  removeResponder(
    @CurrentMembership() membership: OrganizationContext,
    @Param('incidentNumber') incidentNumber: string,
    @Param('membershipId') membershipId: string,
  ): Promise<void> {
    return this.incidents.removeResponder(
      membership.organizationId,
      incidentNumber,
      membershipId,
    );
  }
}
