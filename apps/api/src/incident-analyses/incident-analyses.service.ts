import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { uniqueViolationHint } from '../database/unique-violation.js';
import { incidentNotFound } from '../incidents/incidents.errors.js';
import { parseIncidentNumber } from '../incidents/incidents.schemas.js';
import { membershipNotFound } from '../organizations/organizations.errors.js';
import { organizationNotFound } from '../tenancy/tenancy.errors.js';
import type { IncidentAnalysisResponse } from './incident-analyses.contract.js';
import {
  analysisAlreadyStarted,
  analysisNotStarted,
  incidentNotResolved,
} from './incident-analyses.errors.js';
import { deriveIncidentFacts } from './incident-analyses.facts.js';
import { toIncidentAnalysisResponse } from './incident-analyses.responses.js';
import type { StartIncidentAnalysisRequest } from './incident-analyses.schemas.js';

/**
 * Columns an analysis response is built from. The owner and the attribution
 * are not filtered on deletedAt: who owned, started, or published an
 * analysis stays true after they leave.
 */
const analysisSelection = {
  status: true,
  version: true,
  summary: true,
  impact: true,
  cause: true,
  lessons: true,
  createdAt: true,
  updatedAt: true,
  publishedAt: true,
  owner: { select: { id: true, user: { select: { name: true } } } },
  createdBy: { select: { id: true, name: true } },
  publishedBy: { select: { id: true, name: true } },
} as const;

/**
 * The timeline's own order: by time, and by id between the entries of one
 * change, which share a time.
 */
const timelineOrder: Prisma.IncidentActivityOrderByWithRelationInput[] = [
  { createdAt: 'asc' },
  { id: 'asc' },
];

/**
 * What the facts and key moments are derived from: the incident's own times
 * and severity, and its whole timeline without messages, in the timeline's
 * order.
 */
const factsSelection = {
  createdAt: true,
  resolvedAt: true,
  severity: true,
  activity: {
    select: {
      id: true,
      type: true,
      fromValue: true,
      toValue: true,
      createdAt: true,
      actor: { select: { id: true, name: true } },
    },
    orderBy: timelineOrder,
  },
} as const;

/** Whether a unique violation came from the one-analysis-per-incident key. */
const isAnalysisConflict = (hint: string): boolean =>
  hint.includes('incident_analyses_organization_id_incident_id_key') ||
  hint.includes('incident_id') ||
  hint.includes('incidentid');

/**
 * Incident analyses: reading an incident's, and starting one.
 *
 * Every read is scoped to the admitted organization through the incident,
 * addressed by its number within it, so a foreign incident answers exactly
 * as a missing one does (404 INCIDENT_NOT_FOUND). Only then is the analysis
 * itself judged.
 *
 * The facts and key moments are derived on every read from the incident,
 * which is resolved and therefore final, so they need no transaction with
 * the analysis row and are never stored.
 */
@Injectable()
export class IncidentAnalysesService {
  private readonly logger = new Logger(IncidentAnalysesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** The incident's analysis: 404 ANALYSIS_NOT_STARTED when it has none. */
  async get(
    organizationId: string,
    incidentNumber: string,
  ): Promise<IncidentAnalysisResponse> {
    const incident = await this.prisma.incident.findFirst({
      where: this.incidentWhere(organizationId, incidentNumber),
      select: { ...factsSelection, analysis: { select: analysisSelection } },
    });

    if (!incident) {
      throw incidentNotFound();
    }

    if (!incident.analysis) {
      throw analysisNotStarted();
    }

    return this.respond(incident, incident.analysis);
  }

  /**
   * Starts the incident's analysis, as a DRAFT owned by `ownerMembershipId`
   * — the caller when none is named. The one who started it is the user
   * behind the admitted membership, never anything a body names.
   *
   * Judged in the order that reveals least: the incident (404), its being
   * resolved (409 INCIDENT_NOT_RESOLVED) and not yet analysed (409
   * ANALYSIS_ALREADY_STARTED), then the owner, which must be a membership of
   * this organization whose account still exists (404 MEMBERSHIP_NOT_FOUND,
   * the same for one that is missing, foreign, or deleted).
   *
   * No transaction and no lock. RESOLVED is terminal, so the incident read
   * here is still resolved when the row is inserted. Two starts at once both
   * pass the read; the unique (organization_id, incident_id) key admits one
   * insert, and the other, waiting on that key until the first commits, is
   * refused and answered 409 ANALYSIS_ALREADY_STARTED — exactly one analysis,
   * never two and never a 500.
   *
   * The owner is not locked either: nothing in the application deletes a
   * membership, so one that vanishes between the read and the insert means
   * an out-of-band deletion, and the key's refusal is left a 500.
   */
  async start(
    organizationId: string,
    incidentNumber: string,
    caller: { membershipId: string },
    input: StartIncidentAnalysisRequest,
  ): Promise<IncidentAnalysisResponse> {
    const incident = await this.prisma.incident.findFirst({
      where: this.incidentWhere(organizationId, incidentNumber),
      select: {
        ...factsSelection,
        id: true,
        status: true,
        analysis: { select: { status: true } },
      },
    });

    if (!incident) {
      throw incidentNotFound();
    }

    if (incident.status !== 'RESOLVED') {
      throw incidentNotResolved();
    }

    if (incident.analysis) {
      throw analysisAlreadyStarted();
    }

    const createdById = await this.resolveActor(
      organizationId,
      caller.membershipId,
    );
    const ownerMembershipId = input?.ownerMembershipId ?? caller.membershipId;

    if (ownerMembershipId !== caller.membershipId) {
      await this.requireActiveMember(organizationId, ownerMembershipId);
    }

    let analysis;

    try {
      // Scalar ids, not nested connects: the incident and owner keys share
      // organizationId, and it is that shared column they check.
      analysis = await this.prisma.incidentAnalysis.create({
        data: {
          organizationId,
          incidentId: incident.id,
          ownerMembershipId,
          createdById,
        },
        select: analysisSelection,
      });
    } catch (error) {
      const hint = uniqueViolationHint(error);

      if (hint !== undefined && isAnalysisConflict(hint)) {
        throw analysisAlreadyStarted();
      }

      throw error;
    }

    this.logger.log('Incident analysis started', {
      incidentId: incident.id,
      ownerMembershipId,
    });

    return this.respond(incident, analysis);
  }

  /**
   * Finds the incident `incidentNumber` names in the admitted organization.
   * A malformed number is 404 INCIDENT_NOT_FOUND here, like a missing one
   * or — numbers being per organization — one another tenant holds.
   */
  private incidentWhere(
    organizationId: string,
    incidentNumber: string,
  ): Prisma.IncidentWhereInput {
    const number = parseIncidentNumber(incidentNumber);

    if (number === undefined) {
      throw incidentNotFound();
    }

    return { organizationId, number, organization: { deletedAt: null } };
  }

  /**
   * The response, with the facts derived from the incident. An analysis
   * only exists for a resolved incident, so resolvedAt is always set here;
   * its absence would be a broken invariant, not an answer.
   */
  private respond(
    incident: {
      createdAt: Date;
      resolvedAt: Date | null;
      severity: Parameters<typeof deriveIncidentFacts>[0]['severity'];
      activity: Parameters<typeof deriveIncidentFacts>[1];
    },
    analysis: Parameters<typeof toIncidentAnalysisResponse>[0],
  ): IncidentAnalysisResponse {
    const { resolvedAt } = incident;

    if (resolvedAt === null) {
      throw new Error('An incident analysis exists for an unresolved incident');
    }

    return toIncidentAnalysisResponse(
      analysis,
      deriveIncidentFacts(
        {
          createdAt: incident.createdAt,
          resolvedAt,
          severity: incident.severity,
        },
        incident.activity,
      ),
    );
  }

  /**
   * The user behind the admitted membership, within this organization and
   * with an account that still exists — as IncidentsService resolves its
   * actors.
   */
  private async resolveActor(
    organizationId: string,
    membershipId: string,
  ): Promise<string> {
    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, organizationId, user: { deletedAt: null } },
      select: { userId: true },
    });

    if (!membership) {
      throw organizationNotFound();
    }

    return membership.userId;
  }

  /** 404 MEMBERSHIP_NOT_FOUND unless it is an active member of this organization. */
  private async requireActiveMember(
    organizationId: string,
    membershipId: string,
  ): Promise<void> {
    const membership = await this.prisma.membership.findFirst({
      where: { id: membershipId, organizationId, user: { deletedAt: null } },
      select: { id: true },
    });

    if (!membership) {
      throw membershipNotFound();
    }
  }
}
