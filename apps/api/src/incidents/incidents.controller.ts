import {
  Body,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';

import { Permission } from '../authorization/permissions.js';
import { RequirePermission } from '../authorization/require-permission.decorator.js';
import type { OrganizationContext } from '../common/request-context.js';
import { CurrentMembership } from '../tenancy/current-membership.decorator.js';
import { OrganizationController } from '../tenancy/organization-controller.decorator.js';
import type {
  IncidentActivityResponse,
  IncidentAttentionResponse,
  IncidentPartsResponse,
  IncidentDetailResponse,
  IncidentRepeatsResponse,
  IncidentFlowResponse,
  IncidentHistoryPage,
  IncidentOccurrenceResponse,
  IncidentPage,
  IncidentSummaryResponse,
  OperationalActivityResponse,
} from './incidents.contract.js';
import {
  createIncidentSchema,
  incidentActivityQuerySchema,
  incidentFlowQuerySchema,
  incidentHistoryQuerySchema,
  incidentOccurrenceQuerySchema,
  incidentSummaryQuerySchema,
  listIncidentsQuerySchema,
  postIncidentUpdateSchema,
  setIncidentResponseAccessSchema,
  updateIncidentSchema,
} from './incidents.schemas.js';
import type {
  CreateIncidentRequest,
  IncidentActivityQuery,
  IncidentFlowQuery,
  IncidentHistoryQuery,
  IncidentOccurrenceQuery,
  IncidentSummaryQuery,
  ListIncidentsQuery,
  PostIncidentUpdateRequest,
  SetIncidentResponseAccessRequest,
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
 * Reading a list, an incident, or its timeline is scoped to the caller's own
 * incidents unless they hold `incidents:read-all` (see incidents.scope.ts);
 * one outside it answers 404 like a missing one. Every change finds its
 * incident the same way, before judging whether the caller may make it, so
 * no refusal tells a member that an incident they cannot see exists.
 *
 * The organization-wide readings — the summary, the activity calendar, and
 * occurrence — are oversight rather than reading. Each counts every incident
 * there is, with no reader to narrow it by, so each requires
 * `incidents:read-all` outright: a member without it is refused 403, like
 * anyone whose role lacks a permission a route declares. Not 404, which is
 * what admission answers, and which here would be read as a missing incident
 * number rather than as the refusal it is. `attention` is the exception that
 * proves the rule: it asks what waits on the caller, so it is scoped by them
 * and stays `incidents:read`.
 *
 * Incidents are addressed by number, validated in the service, so a
 * malformed one answers 404 like any other number this organization lacks.
 * There is no delete: incidents are history.
 */
@OrganizationController('incidents')
export class IncidentsController {
  constructor(private readonly incidents: IncidentsService) {}

  /** One page of the active or resolved incidents the caller may see. */
  @Get()
  @RequirePermission(Permission.INCIDENTS_READ)
  list(
    @CurrentMembership() membership: OrganizationContext,
    @Query({ schema: listIncidentsQuerySchema }) query: ListIncidentsQuery,
  ): Promise<IncidentPage> {
    return this.incidents.list(
      membership.organizationId,
      { membershipId: membership.membershipId, role: membership.role },
      query,
    );
  }

  /**
   * Counts of the incidents active now, and of those declared and resolved
   * in a period of whole UTC days, with a preview of that period's history.
   * Every incident in the organization, the preview included — oversight, so
   * `incidents:read-all`. Declared before `:incidentNumber`, which would
   * otherwise claim the path.
   */
  @Get('summary')
  @RequirePermission(Permission.INCIDENTS_READ_ALL)
  summary(
    @CurrentMembership() membership: OrganizationContext,
    @Query({ schema: incidentSummaryQuerySchema }) query: IncidentSummaryQuery,
  ): Promise<IncidentSummaryResponse> {
    return this.incidents.summary(membership.organizationId, query);
  }

  /**
   * One page of a period's history: every incident declared or resolved in
   * it, most recent first — oversight, so `incidents:read-all`. Declared
   * before `:incidentNumber`, which would otherwise claim the path.
   */
  @Get('history')
  @RequirePermission(Permission.INCIDENTS_READ_ALL)
  history(
    @CurrentMembership() membership: OrganizationContext,
    @Query({ schema: incidentHistoryQuerySchema }) query: IncidentHistoryQuery,
  ): Promise<IncidentHistoryPage> {
    return this.incidents.history(membership.organizationId, query);
  }

  /**
   * How much happened on each day of a period, across every incident, with
   * the incidents each day touched — oversight, so `incidents:read-all`.
   * Declared before `:incidentNumber`, which would otherwise claim the path.
   */
  @Get('activity')
  @RequirePermission(Permission.INCIDENTS_READ_ALL)
  activity(
    @CurrentMembership() membership: OrganizationContext,
    @Query({ schema: incidentActivityQuerySchema })
    query: IncidentActivityQuery,
  ): Promise<OperationalActivityResponse> {
    return this.incidents.activity(membership.organizationId, query);
  }

  /**
   * How often incidents were declared over a period, day by day and by
   * service, against the same elapsed time before it — oversight, so
   * `incidents:read-all`. Declared before `:incidentNumber`, which would
   * otherwise claim the path.
   */
  @Get('occurrence')
  @RequirePermission(Permission.INCIDENTS_READ_ALL)
  occurrence(
    @CurrentMembership() membership: OrganizationContext,
    @Query({ schema: incidentOccurrenceQuerySchema })
    query: IncidentOccurrenceQuery,
  ): Promise<IncidentOccurrenceResponse> {
    return this.incidents.occurrence(membership.organizationId, query);
  }

  /**
   * How teams' incidents ran over the last week or two. Every role may ask:
   * a member is answered for the teams they are on, whoever oversees every
   * incident for every team — the service decides which, from the role.
   * Declared before `:incidentNumber`, which would otherwise claim the path.
   */
  @Get('flow')
  @RequirePermission(Permission.INCIDENTS_READ)
  flow(
    @CurrentMembership() membership: OrganizationContext,
    @Query({ schema: incidentFlowQuerySchema }) query: IncidentFlowQuery,
  ): Promise<IncidentFlowResponse> {
    return this.incidents.flow(
      membership.organizationId,
      { membershipId: membership.membershipId, role: membership.role },
      query,
    );
  }

  /**
   * The active incidents waiting on the caller now: resolvable ones with
   * `incidents:manage`; with `incidents:respond`, their teams' unclaimed
   * ones and their own responses under way. Every role may ask; what comes
   * back follows the caller's permissions. Declared before
   * `:incidentNumber`, which would otherwise claim the path.
   */
  @Get('attention')
  @RequirePermission(Permission.INCIDENTS_READ)
  attention(
    @CurrentMembership() membership: OrganizationContext,
  ): Promise<IncidentAttentionResponse> {
    return this.incidents.attention(membership.organizationId, {
      membershipId: membership.membershipId,
      role: membership.role,
    });
  }

  /**
   * The caller's active incidents counted by their own part in each, and
   * all of them, within what their list shows. Every role may ask; what is
   * counted follows the caller's read scope. Declared before
   * `:incidentNumber`, which would otherwise claim the path.
   */
  @Get('parts')
  @RequirePermission(Permission.INCIDENTS_READ)
  parts(
    @CurrentMembership() membership: OrganizationContext,
  ): Promise<IncidentPartsResponse> {
    return this.incidents.parts(membership.organizationId, {
      membershipId: membership.membershipId,
      role: membership.role,
    });
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
    return this.incidents.get(
      membership.organizationId,
      { membershipId: membership.membershipId, role: membership.role },
      incidentNumber,
    );
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
      { membershipId: membership.membershipId, role: membership.role },
    );
  }

  /**
   * The incident's timeline, oldest first: operational updates, responses
   * starting and completing, and the severity, status, and team changes the
   * server recorded.
   */
  /** Its known issue, and the other times that has happened. */
  @Get(':incidentNumber/repeats')
  @RequirePermission(Permission.INCIDENTS_READ)
  repeats(
    @CurrentMembership() membership: OrganizationContext,
    @Param('incidentNumber') incidentNumber: string,
  ): Promise<IncidentRepeatsResponse> {
    return this.incidents.repeats(
      membership.organizationId,
      { membershipId: membership.membershipId, role: membership.role },
      incidentNumber,
    );
  }

  @Get(':incidentNumber/timeline')
  @RequirePermission(Permission.INCIDENTS_READ)
  timeline(
    @CurrentMembership() membership: OrganizationContext,
    @Param('incidentNumber') incidentNumber: string,
  ): Promise<IncidentActivityResponse[]> {
    return this.incidents.timeline(
      membership.organizationId,
      { membershipId: membership.membershipId, role: membership.role },
      incidentNumber,
    );
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
   * The Admin chooses who may respond: the responsible team, or the people
   * named. 200 with the incident, whether or not the choice changed anything.
   */
  @Put(':incidentNumber/response-access')
  @RequirePermission(Permission.INCIDENTS_MANAGE)
  setResponseAccess(
    @CurrentMembership() membership: OrganizationContext,
    @Param('incidentNumber') incidentNumber: string,
    @Body({ schema: setIncidentResponseAccessSchema })
    body: SetIncidentResponseAccessRequest,
  ): Promise<IncidentDetailResponse> {
    return this.incidents.setResponseAccess(
      membership.organizationId,
      incidentNumber,
      body,
      { membershipId: membership.membershipId, role: membership.role },
    );
  }

  /**
   * The caller starts investigating the incident, if who may respond lets
   * them. The first to start moves a DECLARED incident to
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
      { membershipId: membership.membershipId, role: membership.role },
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
      { membershipId: membership.membershipId, role: membership.role },
    );
  }
}
