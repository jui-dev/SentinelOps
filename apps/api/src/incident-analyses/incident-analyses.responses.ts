import type {
  IncidentAnalysisResponse,
  IncidentAnalysisStatus,
} from './incident-analyses.contract.js';
import type {
  IncidentFacts,
  IncidentKeyMoment,
} from './incident-analyses.facts.js';
import { ANALYSIS_SECTIONS } from './incident-analyses.schemas.js';

/**
 * Row-to-wire mapper for incident analyses. Same rules as
 * incidents.responses.ts: every emitted field is named, nothing is spread
 * from a row, and inputs are structural rather than Prisma model types. The
 * row's own keys — its id, organization, incident, and the raw owner and
 * attribution ids — are never emitted.
 */

export interface IncidentAnalysisRow {
  status: IncidentAnalysisStatus;
  version: number;
  summary: string | null;
  impact: string | null;
  cause: string | null;
  lessons: string | null;
  doneSections: string[];
  createdAt: Date;
  updatedAt: Date;
  publishedAt: Date | null;
  owner: { id: string; user: { name: string } };
  createdBy: { id: string; name: string };
  publishedBy: { id: string; name: string } | null;
}

export const toIncidentAnalysisResponse = (
  analysis: IncidentAnalysisRow,
  derived: { facts: IncidentFacts; keyMoments: IncidentKeyMoment[] },
): IncidentAnalysisResponse => ({
  status: analysis.status,
  version: analysis.version,
  owner: {
    membershipId: analysis.owner.id,
    name: analysis.owner.user.name,
  },
  summary: analysis.summary,
  impact: analysis.impact,
  cause: analysis.cause,
  lessons: analysis.lessons,
  doneSections: ANALYSIS_SECTIONS.filter((section) =>
    analysis.doneSections.includes(section),
  ),
  createdBy: { id: analysis.createdBy.id, name: analysis.createdBy.name },
  createdAt: analysis.createdAt.toISOString(),
  publishedBy: analysis.publishedBy && {
    id: analysis.publishedBy.id,
    name: analysis.publishedBy.name,
  },
  publishedAt: analysis.publishedAt?.toISOString() ?? null,
  updatedAt: analysis.updatedAt.toISOString(),
  facts: {
    declaredAt: derived.facts.declaredAt.toISOString(),
    resolvedAt: derived.facts.resolvedAt.toISOString(),
    firstResponseAt: derived.facts.firstResponseAt?.toISOString() ?? null,
    responderCount: derived.facts.responderCount,
    updateCount: derived.facts.updateCount,
    severity: {
      declared: derived.facts.severity.declared,
      highest: derived.facts.severity.highest,
      final: derived.facts.severity.final,
    },
    reassignmentCount: derived.facts.reassignmentCount,
  },
  keyMoments: derived.keyMoments.map((moment) => ({
    kind: moment.kind,
    activityId: moment.activityId,
    at: moment.at.toISOString(),
    actor: { id: moment.actor.id, name: moment.actor.name },
    fromValue: moment.fromValue,
    toValue: moment.toValue,
  })),
});
