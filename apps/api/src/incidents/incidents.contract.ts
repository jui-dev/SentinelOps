/**
 * The wire contract for incidents.
 *
 * Declared rather than inferred from Prisma models, for the reason
 * auth.contract.ts gives: an inferred type grows a field with every migration.
 */

import type { ServiceCriticality } from '../services/services.contract.js';

/**
 * How serious one incident is, SEV1 the most severe. Chosen for the
 * incident, never derived from its service's criticality. See
 * IncidentSeverity in schema.prisma for what each level means.
 */
export type IncidentSeverity = 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4';

/**
 * Where the incident as a whole stands: DECLARED → INVESTIGATING → RESOLVED,
 * forward only. DECLARED and INVESTIGATING are active; RESOLVED is terminal.
 * See IncidentStatus in schema.prisma for what each means.
 */
export type IncidentStatus = 'DECLARED' | 'INVESTIGATING' | 'RESOLVED';

/**
 * One incident. `number` is the organization's own sequence — the client
 * shows it as INC-{number}, and the API addresses the incident by it.
 *
 * The service, the responsible team, and the declarer are embedded, identity
 * only, so a list needs no second request to name them. Their names are
 * current, not snapshots: renaming a team shows on its past incidents. The
 * responsible team itself is a snapshot — which team it is does not follow
 * the service's owner.
 *
 * `createdBy` names the declarer even if their account was since deleted:
 * attribution is history, not access. It never carries an email.
 *
 * The responsible team's members are who may start investigating it. Who
 * did is `IncidentDetailResponse.responders`, on the single-incident routes.
 */
export interface IncidentResponse {
  id: string;
  number: number;
  title: string;
  summary: string | null;
  severity: IncidentSeverity;
  status: IncidentStatus;
  service: {
    id: string;
    name: string;
    slug: string;
    criticality: ServiceCriticality;
    archivedAt: string | null;
  };
  team: {
    id: string;
    name: string;
    slug: string;
  };
  createdBy: {
    id: string;
    name: string;
  };
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

/**
 * Where one responder's own part of the response stands. Someone who has not
 * started investigating is not a responder at all, and has no entry.
 */
export type IncidentResponderStatus = 'INVESTIGATING' | 'COMPLETED';

/**
 * A member who started investigating an incident, addressed by their
 * membership id. Identity only: never an email. `completedAt` is set exactly
 * when `status` is COMPLETED.
 */
export interface IncidentResponderResponse {
  membershipId: string;
  name: string;
  status: IncidentResponderStatus;
  startedAt: string;
  completedAt: string | null;
}

/**
 * One incident with its responders — what every single-incident route
 * returns. Lists return `IncidentResponse` alone, so a page of incidents
 * stays one query without joins across responders. `responders` are in the
 * order they started.
 */
export interface IncidentDetailResponse extends IncidentResponse {
  responders: IncidentResponderResponse[];
}

/**
 * What a timeline entry records. UPDATE is posted by a member; the others are
 * recorded by the server with the change they describe. Starting the
 * investigation is STATUS_CHANGED from DECLARED to INVESTIGATING; resolution
 * is STATUS_CHANGED with `toValue: 'RESOLVED'`. TEAM_CHANGED is a
 * reassignment of the responsible team. RESPONSE_STARTED and
 * RESPONSE_COMPLETED are a responder starting and completing their own
 * response; the actor is the responder.
 */
export type IncidentActivityType =
  | 'DECLARED'
  | 'UPDATE'
  | 'SEVERITY_CHANGED'
  | 'STATUS_CHANGED'
  | 'TEAM_CHANGED'
  | 'RESPONSE_STARTED'
  | 'RESPONSE_COMPLETED';

/**
 * One entry on an incident's timeline. History, not state: the incident
 * itself says where it stands now. A status change recorded before the
 * lifecycle was simplified can name a retired status, IDENTIFIED or
 * MONITORING: history is not rewritten.
 *
 * `message` is set for UPDATE only. `fromValue` and `toValue` are severity or
 * status values: DECLARED carries the declared severity in `toValue`; the
 * severity and status changes carry both. TEAM_CHANGED carries the two teams'
 * names as they were when the change was made.
 *
 * Who took part in the response is read from these entries: an UPDATE is the
 * participation, and its actor the participant. There is no separate record
 * of it. `actor` names who posted or made the change even if
 * their account was since deleted, as `createdBy` does. Never an email.
 */
export interface IncidentActivityResponse {
  id: string;
  type: IncidentActivityType;
  message: string | null;
  fromValue: string | null;
  toValue: string | null;
  actor: {
    id: string;
    name: string;
  };
  createdAt: string;
}

/** A count for each severity level; a level with none is 0. */
export type SeverityCounts = Record<IncidentSeverity, number>;

/**
 * A service with at least one active incident: identity, its owner, how many
 * active incidents it has, and the most severe of them. Criticality is the
 * classification people chose, not health.
 */
export interface AffectedServiceResponse {
  id: string;
  name: string;
  slug: string;
  criticality: ServiceCriticality;
  archivedAt: string | null;
  ownerTeam: { id: string; name: string; slug: string };
  activeIncidents: number;
  worstSeverity: IncidentSeverity;
}

/**
 * One incident in a period's history: the incident, and which of its two
 * lifecycle moments happened inside the period. At least one is true.
 *
 * An incident declared and resolved in the same period is one item with
 * both set — never two — so the history never lists an incident twice.
 */
export interface IncidentHistoryItemResponse {
  incident: IncidentResponse;
  declaredInPeriod: boolean;
  resolvedInPeriod: boolean;
}

/**
 * `GET .../incidents/summary`: the organization's incidents in two parts.
 *
 * `current` is the state now — every unresolved incident, whenever it was
 * declared — and does not depend on the period asked for.
 *
 * `period` covers whole UTC days, `from` to `to`, both included. `declared`
 * counts incidents declared in it; `declaredBySeverity` splits them by each
 * incident's severity now, which may have changed since it was declared.
 * `resolved` counts incidents resolved in it, whenever they were declared.
 * `stillOpen` counts those declared in it that are not yet resolved.
 *
 * `history` is what happened in the period: every incident declared or
 * resolved in it, most recent first. `total` counts them all — declared
 * plus resolved, less those that were both — while `items` is a preview of
 * the most recent few.
 */
export interface IncidentSummaryResponse {
  current: {
    active: number;
    activeBySeverity: SeverityCounts;
    affectedServices: AffectedServiceResponse[];
  };
  period: {
    from: string;
    to: string;
    declared: number;
    declaredBySeverity: SeverityCounts;
    resolved: number;
    stillOpen: number;
    history: {
      total: number;
      items: IncidentHistoryItemResponse[];
    };
  };
}

/**
 * One page of a collection. `cursor` is opaque and asks for the page after
 * this one; it is null exactly when `hasMore` is false.
 */
export interface IncidentPage {
  items: IncidentResponse[];
  page: {
    cursor: string | null;
    hasMore: boolean;
  };
}
