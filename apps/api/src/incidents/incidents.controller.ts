import {
  Body,
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
  IncidentActivityResponse,
  IncidentDetailResponse,
  IncidentPage,
  IncidentSummaryResponse,
} from './incidents.contract.js';
import {
  createIncidentSchema,
  incidentSummaryQuerySchema,
  listIncidentsQuerySchema,
  postIncidentUpdateSchema,
  updateIncidentSchema,
} from './incidents.schemas.js';
import type {
  CreateIncidentRequest,
  IncidentSummaryQuery,
  ListIncidentsQuery,
  PostIncidentUpdateRequest,
  UpdateIncidentRequest,
} from './incidents.schemas.js';
import { IncidentsService } from './incidents.service.js';

/**
 * An organization's incidents.
 *
 * The same three layers as every organization route: admission by
 * `@OrganizationController()`, authorization by `@RequirePermission()`, and
 * isolation in the service. The lifecycle — declaring, changing,
 * reassigning, resolving — is `incidents:manage`, which only an admin holds.
 * Responding — starting to investigate, posting updates, completing one's
 * own response — is `incidents:respond`, which every role holds; the service
 * then decides by the incident's responsible team and the caller's own
 * response. Who holds which permission is decided by the role table alone.
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
   * Counts of the incidents active now, and of those declared and resolved
   * in a period of whole UTC days, with a preview of that period's history.
   * Declared before `:incidentNumber`, which would otherwise claim the path.
   */
  @Get('summary')
  @RequirePermission(Permission.INCIDENTS_READ)
  summary(
    @CurrentMembership() membership: OrganizationContext,
    @Query({ schema: incidentSummaryQuerySchema }) query: IncidentSummaryQuery,
  ): Promise<IncidentSummaryResponse> {
    return this.incidents.summary(membership.organizationId, query);
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
   * Changes an active incident's title, summary, severity, or responsible
   * team, or resolves it with `status: 'RESOLVED'` — once it is
   * INVESTIGATING and no responder is still investigating.
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
      { membershipId: membership.membershipId },
    );
  }

  /**
   * The incident's timeline, oldest first: operational updates, responses
   * starting and completing, and the severity, status, and team changes the
   * server recorded.
   */
  @Get(':incidentNumber/timeline')
  @RequirePermission(Permission.INCIDENTS_READ)
  timeline(
    @CurrentMembership() membership: OrganizationContext,
    @Param('incidentNumber') incidentNumber: string,
  ): Promise<IncidentActivityResponse[]> {
    return this.incidents.timeline(membership.organizationId, incidentNumber);
  }

  /**
   * Posts an operational update to an active incident. Who posted it is the
   * admitted member, and cannot be supplied. A member must be investigating
   * it (403 START_INVESTIGATING_FIRST otherwise); the Admin may post to any.
   */
  @Post(':incidentNumber/updates')
  @RequirePermission(Permission.INCIDENTS_RESPOND)
  postUpdate(
    @CurrentMembership() membership: OrganizationContext,
    @Param('incidentNumber') incidentNumber: string,
    @Body({ schema: postIncidentUpdateSchema }) body: PostIncidentUpdateRequest,
  ): Promise<IncidentActivityResponse> {
    return this.incidents.postUpdate(
      membership.organizationId,
      incidentNumber,
      body,
      { membershipId: membership.membershipId, role: membership.role },
    );
  }

  /**
   * The caller starts investigating the incident, as a member of its
   * responsible team. The first to start moves a DECLARED incident to
   * INVESTIGATING. Starting again while investigating changes nothing, so
   * this answers 200 either way, with the incident. The responder is always
   * the admitted member: there is no body.
   */
  @Post(':incidentNumber/responders/me')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.INCIDENTS_RESPOND)
  startResponse(
    @CurrentMembership() membership: OrganizationContext,
    @Param('incidentNumber') incidentNumber: string,
  ): Promise<IncidentDetailResponse> {
    return this.incidents.startResponse(
      membership.organizationId,
      incidentNumber,
      { membershipId: membership.membershipId },
    );
  }

  /**
   * The caller marks their own response complete. It resolves nothing, and
   * completing again changes nothing: 200 either way, with the incident.
   */
  @Post(':incidentNumber/responders/me/complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.INCIDENTS_RESPOND)
  completeResponse(
    @CurrentMembership() membership: OrganizationContext,
    @Param('incidentNumber') incidentNumber: string,
  ): Promise<IncidentDetailResponse> {
    return this.incidents.completeResponse(
      membership.organizationId,
      incidentNumber,
      { membershipId: membership.membershipId },
    );
  }
}
