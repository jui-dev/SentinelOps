import { Body, Get, Param, Patch, Post } from '@nestjs/common';

import { Permission } from '../authorization/permissions.js';
import { RequirePermission } from '../authorization/require-permission.decorator.js';
import type { OrganizationContext } from '../common/request-context.js';
import { CurrentMembership } from '../tenancy/current-membership.decorator.js';
import { OrganizationController } from '../tenancy/organization-controller.decorator.js';
import type { IncidentAnalysisResponse } from './incident-analyses.contract.js';
import {
  editIncidentAnalysisSchema,
  startIncidentAnalysisSchema,
} from './incident-analyses.schemas.js';
import type {
  EditIncidentAnalysisRequest,
  StartIncidentAnalysisRequest,
} from './incident-analyses.schemas.js';
import { IncidentAnalysesService } from './incident-analyses.service.js';

/**
 * An incident's analysis: one per incident, addressed through it.
 *
 * The same three layers as every organization route: admission by
 * `@OrganizationController()`, authorization by `@RequirePermission()`, and
 * isolation in the service. Reading is `incidents:read`, since an analysis
 * is part of the incident's record. Starting one — and choosing who owns it
 * — is `incidents:manage`, part of running the incident's lifecycle.
 * Editing one is `incident-analyses:write`, which the service narrows to the
 * analysis's owner unless the caller also holds `incidents:manage`.
 */
@OrganizationController('incidents/:incidentNumber/analysis')
export class IncidentAnalysesController {
  constructor(private readonly analyses: IncidentAnalysesService) {}

  @Get()
  @RequirePermission(Permission.INCIDENTS_READ)
  get(
    @CurrentMembership() membership: OrganizationContext,
    @Param('incidentNumber') incidentNumber: string,
  ): Promise<IncidentAnalysisResponse> {
    return this.analyses.get(membership.organizationId, incidentNumber);
  }

  /**
   * Starts the resolved incident's analysis as a DRAFT. The owner is the
   * caller unless the body names another member; who started it is always
   * the caller.
   */
  @Post()
  @RequirePermission(Permission.INCIDENTS_MANAGE)
  start(
    @CurrentMembership() membership: OrganizationContext,
    @Param('incidentNumber') incidentNumber: string,
    @Body({ schema: startIncidentAnalysisSchema })
    body: StartIncidentAnalysisRequest,
  ): Promise<IncidentAnalysisResponse> {
    return this.analyses.start(
      membership.organizationId,
      incidentNumber,
      { membershipId: membership.membershipId },
      body,
    );
  }

  /**
   * Edits the named sections of a draft analysis, if it is still at
   * `version`. The caller must own it or hold `incidents:manage`; their role
   * is the admitted one, never anything a body names.
   */
  @Patch()
  @RequirePermission(Permission.INCIDENT_ANALYSES_WRITE)
  edit(
    @CurrentMembership() membership: OrganizationContext,
    @Param('incidentNumber') incidentNumber: string,
    @Body({ schema: editIncidentAnalysisSchema })
    body: EditIncidentAnalysisRequest,
  ): Promise<IncidentAnalysisResponse> {
    return this.analyses.edit(
      membership.organizationId,
      incidentNumber,
      { membershipId: membership.membershipId, role: membership.role },
      body,
    );
  }
}
