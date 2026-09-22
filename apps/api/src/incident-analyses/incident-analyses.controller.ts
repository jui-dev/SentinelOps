import { Body, Get, Param, Post } from '@nestjs/common';

import { Permission } from '../authorization/permissions.js';
import { RequirePermission } from '../authorization/require-permission.decorator.js';
import type { OrganizationContext } from '../common/request-context.js';
import { CurrentMembership } from '../tenancy/current-membership.decorator.js';
import { OrganizationController } from '../tenancy/organization-controller.decorator.js';
import type { IncidentAnalysisResponse } from './incident-analyses.contract.js';
import { startIncidentAnalysisSchema } from './incident-analyses.schemas.js';
import type { StartIncidentAnalysisRequest } from './incident-analyses.schemas.js';
import { IncidentAnalysesService } from './incident-analyses.service.js';

/**
 * An incident's analysis: one per incident, addressed through it.
 *
 * The same three layers as every organization route: admission by
 * `@OrganizationController()`, authorization by `@RequirePermission()`, and
 * isolation in the service. Reading is `incidents:read`, since an analysis
 * is part of the incident's record. Starting one — and choosing who owns it
 * — is `incidents:manage`, part of running the incident's lifecycle.
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
}
