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
