import { lockActiveMembership } from '../organizations/active-membership.js';
import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { uniqueViolationHint } from '../database/unique-violation.js';
import { incidentNotFound } from '../incidents/incidents.errors.js';
import { withinIncidentScope } from '../incidents/incidents.scope.js';
import type { IncidentReader } from '../incidents/incidents.scope.js';
import { parseIncidentNumber } from '../incidents/incidents.schemas.js';
import { membershipNotFound } from '../organizations/organizations.errors.js';
import { organizationNotFound } from '../tenancy/tenancy.errors.js';
import type { IncidentAnalysisResponse } from './incident-analyses.contract.js';
import {
  analysisAlreadyStarted,
  analysisChanged,
  analysisNotStarted,
  analysisPublished,
  analysisSectionNotWritten,
  analysisSummaryRequired,
  incidentNotResolved,
  notAnalysisOwner,
} from './incident-analyses.errors.js';
import { deriveIncidentFacts } from './incident-analyses.facts.js';
import {
  mayWriteAnalysis,
  nextDoneSections,
} from './incident-analyses.policy.js';
import type { AnalysisCaller } from './incident-analyses.policy.js';
import { toIncidentAnalysisResponse } from './incident-analyses.responses.js';
import { ANALYSIS_SECTIONS } from './incident-analyses.schemas.js';
import type {
  AnalysisSection,
  EditIncidentAnalysisRequest,
  PublishIncidentAnalysisRequest,
  ReassignIncidentAnalysisOwnerRequest,
  StartIncidentAnalysisRequest,
} from './incident-analyses.schemas.js';

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
  doneSections: true,
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

/**
 * What a change to a draft may write: its sections, its owner, or its
 * publication. Never its version, which applyToDraft advances, nor the
 * status it is guarded on: the one status a change may write is PUBLISHED,
 * the only way out of DRAFT. Nor anything that names what it is — its
 * organization, incident, or who started it.
 */
interface DraftChange {
  summary?: string | null;
  impact?: string | null;
  cause?: string | null;
  lessons?: string | null;
  doneSections?: AnalysisSection[];
  ownerMembershipId?: string;
  status?: 'PUBLISHED';
  publishedAt?: Date;
  publishedById?: string;
}

/** Whether a unique violation came from the one-analysis-per-incident key. */
const isAnalysisConflict = (hint: string): boolean =>
  hint.includes('incident_analyses_organization_id_incident_id_key') ||
  hint.includes('incident_id') ||
  hint.includes('incidentid');

/**
 * Incident analyses: reading an incident's, starting one, editing a draft's
 * sections, handing a draft to another owner, and publishing it.
 *
 * Every read is scoped to the admitted organization through the incident,
 * addressed by its number within it, so a foreign incident answers exactly
 * as a missing one does (404 INCIDENT_NOT_FOUND). Only then is the analysis
 * itself judged. Reading, editing, and publishing one are further scoped to
 * the incidents the caller may see (see incidents.scope.ts), with the same
 * 404 outside it, so no later answer — ANALYSIS_NOT_STARTED,
 * NOT_ANALYSIS_OWNER, ANALYSIS_PUBLISHED — tells a member about an incident
 * they cannot see. That is visibility only: who may write is still
 * mayWriteAnalysis. Starting one and choosing its owner are
 * `incidents:manage`, whose holders see every incident.
 *
 * The facts and key moments are derived on every read from the incident,
 * which is resolved and therefore final, so they need no transaction with
 * the analysis row and are never stored.
 */
@Injectable()
export class IncidentAnalysesService {
  private readonly logger = new Logger(IncidentAnalysesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * The incident's analysis: 404 ANALYSIS_NOT_STARTED when it has none.
   * Readable only with the incident itself (see incidents.scope.ts): an
   * incident the reader may not see is 404 INCIDENT_NOT_FOUND, as a missing
   * one is, before the analysis is judged — so the answer says nothing about
   * whether it has one.
   */
  async get(
    organizationId: string,
    reader: IncidentReader,
    incidentNumber: string,
  ): Promise<IncidentAnalysisResponse> {
    const incident = await this.prisma.incident.findFirst({
      where: withinIncidentScope(
        organizationId,
        reader,
        this.incidentWhere(organizationId, incidentNumber),
      ),
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
      this.prisma,
      organizationId,
      caller.membershipId,
    );
    const ownerMembershipId = input?.ownerMembershipId ?? caller.membershipId;

    if (ownerMembershipId !== caller.membershipId) {
      await this.requireActiveMember(
        this.prisma,
        organizationId,
        ownerMembershipId,
      );
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
   * Edits a draft analysis's sections — the text of those the request names,
   * and no others, and which of them are done. Applies only if the analysis is still at the version the caller
   * read, and makes it the next version.
   *
   * Judged in the order that reveals least: the incident (404), its analysis
   * (404 ANALYSIS_NOT_STARTED), whether the caller may write it (403
   * NOT_ANALYSIS_OWNER — its owner, or whoever holds `incidents:manage`),
   * then its state: published (409 ANALYSIS_PUBLISHED) or moved past the
   * caller's version (409 ANALYSIS_CHANGED), and last whether a section it
   * marks done would hold any text (409 ANALYSIS_SECTION_NOT_WRITTEN). Those
   * reads give the precise answer; they do not make the guarantee.
   *
   * The guarantee is applyToDraft's conditional UPDATE: of two edits based
   * on one version, only one applies, and nothing is written to a published
   * analysis — whatever the reads above saw. The facts are derived from the
   * incident, which is resolved and final.
   *
   * Every accepted edit makes a new version, even one that changes no text.
   */
  async edit(
    organizationId: string,
    incidentNumber: string,
    caller: AnalysisCaller,
    input: EditIncidentAnalysisRequest,
  ): Promise<IncidentAnalysisResponse> {
    const { version, markDone, reopen, ...sections } = input;

    const { incident, analysis } = await this.prisma.$transaction(
      async (tx) => {
        const incident = await tx.incident.findFirst({
          where: withinIncidentScope(
            organizationId,
            caller,
            this.incidentWhere(organizationId, incidentNumber),
          ),
          select: {
            ...factsSelection,
            id: true,
            analysis: {
              select: {
                id: true,
                status: true,
                version: true,
                ownerMembershipId: true,
                summary: true,
                impact: true,
                cause: true,
                lessons: true,
                doneSections: true,
              },
            },
          },
        });

        if (!incident) {
          throw incidentNotFound();
        }

        const current = incident.analysis;

        if (!current) {
          throw analysisNotStarted();
        }

        if (!mayWriteAnalysis(caller, current)) {
          throw notAnalysisOwner();
        }

        if (current.status === 'PUBLISHED') {
          throw analysisPublished();
        }

        if (current.version !== version) {
          throw analysisChanged();
        }

        const doneSections = nextDoneSections(current, {
          ...sections,
          markDone,
          reopen,
        });

        if (doneSections === null) {
          throw analysisSectionNotWritten();
        }

        return {
          incident,
          // A section left undefined is not written.
          analysis: await this.applyToDraft(
            tx,
            organizationId,
            current.id,
            version,
            { ...sections, doneSections },
          ),
        };
      },
    );

    // Which sections, never what they say.
    this.logger.log('Incident analysis edited', {
      incidentId: incident.id,
      version: analysis.version,
      sections: ANALYSIS_SECTIONS.filter(
        (section) => sections[section] !== undefined,
      ),
      markDone: markDone ?? [],
      reopen: reopen ?? [],
    });

    return this.respond(incident, analysis);
  }

  /**
   * Hands a draft analysis to another active member of the organization, if
   * it is still at the version the caller read, and makes it the next
   * version. The owner is who is accountable for the analysis now; who
   * started it and who publishes it are recorded apart, and do not change.
   *
   * Judged in the order that reveals least: the incident (404), its analysis
   * (404 ANALYSIS_NOT_STARTED), its state — published (409
   * ANALYSIS_PUBLISHED), or moved past the caller's version (409
   * ANALYSIS_CHANGED) — and then the new owner, which must be a membership
   * of this organization whose account still exists (404
   * MEMBERSHIP_NOT_FOUND, the same for one that is missing, foreign, or
   * deleted). Only a draft is reassigned: once published, nothing is left
   * for an owner to do.
   *
   * The guarantee is applyToDraft's conditional UPDATE, as for an edit: a
   * reassignment and an edit based on the same version cannot both apply;
   * whichever commits second matches nothing and is told ANALYSIS_CHANGED. So an owner's edit already under way when
   * they are replaced is refused, and once they read the analysis again,
   * they are no longer its owner.
   *
   * Naming the current owner is accepted, and still makes a new version:
   * every accepted write does.
   */
  async reassignOwner(
    organizationId: string,
    incidentNumber: string,
    input: ReassignIncidentAnalysisOwnerRequest,
  ): Promise<IncidentAnalysisResponse> {
    const { ownerMembershipId, version } = input;

    const { incident, analysis } = await this.prisma.$transaction(
      async (tx) => {
        const incident = await tx.incident.findFirst({
          where: this.incidentWhere(organizationId, incidentNumber),
          select: {
            ...factsSelection,
            id: true,
            analysis: { select: { id: true, status: true, version: true } },
          },
        });

        if (!incident) {
          throw incidentNotFound();
        }

        const current = incident.analysis;

        if (!current) {
          throw analysisNotStarted();
        }

        if (current.status === 'PUBLISHED') {
          throw analysisPublished();
        }

        if (current.version !== version) {
          throw analysisChanged();
        }

        await this.requireActiveMember(tx, organizationId, ownerMembershipId);

        return {
          incident,
          analysis: await this.applyToDraft(
            tx,
            organizationId,
            current.id,
            version,
            { ownerMembershipId },
          ),
        };
      },
    );

    this.logger.log('Incident analysis owner changed', {
      incidentId: incident.id,
      version: analysis.version,
      ownerMembershipId,
    });

    return this.respond(incident, analysis);
  }

  /**
   * Publishes a draft analysis as it stands at the version the caller read:
   * the organization's record of the incident from then on. One way — a
   * published analysis is not edited, reassigned, or published again.
   *
   * Publishing is part of writing the analysis, so it is its owner's, or
   * whoever holds `incidents:manage`. Who published it is the user behind
   * the admitted membership, and when is the server's clock; neither comes
   * from a body.
   *
   * Judged in the order that reveals least: the incident (404), its analysis
   * (404 ANALYSIS_NOT_STARTED), whether the caller may write it (403
   * NOT_ANALYSIS_OWNER), its state — published (409 ANALYSIS_PUBLISHED) or
   * moved past the caller's version (409 ANALYSIS_CHANGED) — and last its
   * content: a summary its writer has marked done, the one section a
   * publication requires (409 ANALYSIS_SUMMARY_REQUIRED). The other sections
   * are published as they stand, finished or not. The version is judged
   * before the content, so that answer is always about the analysis the
   * caller read.
   *
   * The guarantee is applyToDraft's conditional UPDATE, as for an edit.
   * The summary is not in its WHERE: the version
   * already fixes the text that was read, so an edit that cleared the summary
   * in the meantime has moved the version on and the publication matches
   * nothing. The database's CHECK that a published analysis has a summary is
   * the backstop. Of two publications, the second matches nothing and is
   * told the analysis is published — it did not publish it.
   *
   * Publishing is an accepted write, and makes a new version.
   */
  async publish(
    organizationId: string,
    incidentNumber: string,
    caller: AnalysisCaller,
    input: PublishIncidentAnalysisRequest,
  ): Promise<IncidentAnalysisResponse> {
    const { version } = input;

    const { incident, analysis } = await this.prisma.$transaction(
      async (tx) => {
        const incident = await tx.incident.findFirst({
          where: withinIncidentScope(
            organizationId,
            caller,
            this.incidentWhere(organizationId, incidentNumber),
          ),
          select: {
            ...factsSelection,
            id: true,
            analysis: {
              select: {
                id: true,
                status: true,
                version: true,
                ownerMembershipId: true,
                doneSections: true,
              },
            },
          },
        });

        if (!incident) {
          throw incidentNotFound();
        }

        const current = incident.analysis;

        if (!current) {
          throw analysisNotStarted();
        }

        if (!mayWriteAnalysis(caller, current)) {
          throw notAnalysisOwner();
        }

        if (current.status === 'PUBLISHED') {
          throw analysisPublished();
        }

        if (current.version !== version) {
          throw analysisChanged();
        }

        // Only a section holding text can be done, so this needs a summary too.
        if (!current.doneSections.includes('summary')) {
          throw analysisSummaryRequired();
        }

        const publishedById = await this.resolveActor(
          tx,
          organizationId,
          caller.membershipId,
        );

        return {
          incident,
          analysis: await this.applyToDraft(
            tx,
            organizationId,
            current.id,
            version,
            { status: 'PUBLISHED', publishedAt: new Date(), publishedById },
          ),
        };
      },
    );

    this.logger.log('Incident analysis published', {
      incidentId: incident.id,
      version: analysis.version,
    });

    return this.respond(incident, analysis);
  }

  /**
   * Applies one change to a draft analysis, if it is still a draft at
   * `version`, makes it the next version, and returns it as it now stands.
   * Every change to a draft goes through here, so each is scoped to the
   * organization, made only to a draft, guarded by the version its caller
   * read, and advances that version exactly once.
   *
   * The guarantee is the UPDATE itself. Its WHERE names the analysis, the
   * organization, DRAFT, and `version`, and it increments the version in
   * SQL. Of two changes based on one version, the second waits on the row
   * lock the first holds; once the first commits, Postgres re-evaluates the
   * second's WHERE against the new row, the version no longer matches, and
   * it updates nothing. So only one change ever makes version N+1, and
   * nothing is written to a published analysis, whatever the caller read
   * before. When nothing was updated, the row is read again to say which:
   * published (409 ANALYSIS_PUBLISHED), or changed (409 ANALYSIS_CHANGED).
   *
   * Runs in the caller's transaction, at the default isolation and with no
   * explicit lock, so that the analysis returned is read under the row lock
   * the UPDATE took: this change's result, not a later one's.
   *
   * What to read, who may change it, and what makes the change valid are
   * the caller's to judge first; this only makes it.
   */
  private async applyToDraft(
    tx: Prisma.TransactionClient,
    organizationId: string,
    analysisId: string,
    version: number,
    change: DraftChange,
  ) {
    const { count } = await tx.incidentAnalysis.updateMany({
      where: { id: analysisId, organizationId, status: 'DRAFT', version },
      data: { ...change, version: { increment: 1 } },
    });

    if (count !== 1) {
      const now = await tx.incidentAnalysis.findFirst({
        where: { id: analysisId, organizationId },
        select: { status: true },
      });

      throw now?.status === 'PUBLISHED'
        ? analysisPublished()
        : analysisChanged();
    }

    return tx.incidentAnalysis.findUniqueOrThrow({
      where: { id: analysisId },
      select: analysisSelection,
    });
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
    db: Prisma.TransactionClient,
    organizationId: string,
    membershipId: string,
  ): Promise<string> {
    const membership = await db.membership.findFirst({
      where: { id: membershipId, organizationId, user: { deletedAt: null } },
      select: { userId: true },
    });

    if (!membership) {
      throw organizationNotFound();
    }

    return membership.userId;
  }

  /**
   * 404 MEMBERSHIP_NOT_FOUND unless it is an active member of this
   * organization — not removed, and held so until the transaction ends.
   */
  private async requireActiveMember(
    db: Prisma.TransactionClient,
    organizationId: string,
    membershipId: string,
  ): Promise<void> {
    if (!(await lockActiveMembership(db, organizationId, membershipId))) {
      throw membershipNotFound();
    }

    const membership = await db.membership.findFirst({
      where: { id: membershipId, organizationId, user: { deletedAt: null } },
      select: { id: true },
    });

    if (!membership) {
      throw membershipNotFound();
    }
  }
}
