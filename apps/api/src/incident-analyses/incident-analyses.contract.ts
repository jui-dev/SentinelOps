/**
 * The wire contract for incident analyses. An analysis has no address of its
 * own: it is the analysis of one incident, at
 * `/incidents/:incidentNumber/analysis`, so it carries no id.
 */

import type { IncidentSeverity } from '../incidents/incidents.contract.js';
import type { IncidentKeyMomentKind } from './incident-analyses.facts.js';
import type { AnalysisSection } from './incident-analyses.schemas.js';

export type IncidentAnalysisStatus = 'DRAFT' | 'PUBLISHED';

export type { IncidentKeyMomentKind };

/**
 * What SentinelOps already knew about the incident, derived on every read:
 * instants and counts, never durations — the client measures between them.
 */
export interface IncidentAnalysisFactsResponse {
  declaredAt: string;
  resolvedAt: string;
  /** Null when nobody's start of a response was recorded. */
  firstResponseAt: string | null;
  responderCount: number;
  updateCount: number;
  severity: {
    declared: IncidentSeverity;
    highest: IncidentSeverity;
    final: IncidentSeverity;
  };
  reassignmentCount: number;
}

/**
 * A timeline entry that shaped the incident — a selection, not the timeline,
 * which remains the complete record. `activityId` names the entry;
 * `fromValue` and `toValue` are as it recorded them.
 */
export interface IncidentKeyMomentResponse {
  kind: IncidentKeyMomentKind;
  activityId: string;
  at: string;
  actor: { id: string; name: string };
  fromValue: string | null;
  toValue: string | null;
}

/**
 * One incident's analysis. `version` identifies this state of it: a write
 * names the version it was based on. The written sections are null until
 * written, and `doneSections` names, in reading order, those the writer has
 * said are finished. `owner` is a membership of the organization; `createdBy` and
 * `publishedBy` are attribution, and name their user even after the account
 * is deleted, as an incident's `createdBy` does.
 */
export interface IncidentAnalysisResponse {
  status: IncidentAnalysisStatus;
  version: number;
  /** `former`: removed from the organization since; the analysis keeps them. */
  owner: { membershipId: string; name: string; former: boolean };
  summary: string | null;
  impact: string | null;
  cause: string | null;
  lessons: string | null;
  doneSections: AnalysisSection[];
  createdBy: { id: string; name: string };
  createdAt: string;
  publishedBy: { id: string; name: string } | null;
  publishedAt: string | null;
  updatedAt: string;
  facts: IncidentAnalysisFactsResponse;
  keyMoments: IncidentKeyMomentResponse[];
}
