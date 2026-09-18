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

/** The three active statuses, then RESOLVED — which is terminal. */
export type IncidentStatus =
  'INVESTIGATING' | 'IDENTIFIED' | 'MONITORING' | 'RESOLVED';

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
 * A member assigned to an incident, addressed by their membership id — the
 * id the lead and responder routes take. Identity only: never an email.
 */
export interface IncidentMemberResponse {
  membershipId: string;
  name: string;
}

/**
 * One incident with the people responding to it: what every route about a
 * single incident returns. Lists return `IncidentResponse` alone, so a page
 * of incidents stays one query without joins across responders.
 *
 * `lead` is null until someone is assigned; declaring an incident does not
 * make its declarer the lead. `responders` are in the order they were added.
 */
export interface IncidentDetailResponse extends IncidentResponse {
  lead: IncidentMemberResponse | null;
  responders: IncidentMemberResponse[];
}

/**
 * What a timeline entry records. UPDATE is posted by a member; the others are
 * recorded by the server with the change they describe. Resolution is
 * STATUS_CHANGED with `toValue: 'RESOLVED'`.
 */
export type IncidentActivityType =
  'DECLARED' | 'UPDATE' | 'SEVERITY_CHANGED' | 'STATUS_CHANGED';

/**
 * One entry on an incident's timeline. History, not state: the incident
 * itself says where it stands now.
 *
 * `message` is set for UPDATE only. `fromValue` and `toValue` are severity or
 * status values: DECLARED carries the declared severity in `toValue`; the two
 * changes carry both. `actor` names who posted or made the change even if
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
