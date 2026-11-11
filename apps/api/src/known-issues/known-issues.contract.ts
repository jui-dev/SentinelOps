/**
 * The wire contract for known issues.
 *
 * Declared rather than inferred from Prisma models, for the reason
 * auth.contract.ts gives: an inferred type grows a field with every migration.
 */

import type { IncidentSeverity } from '../incidents/incidents.contract.js';

/**
 * A problem a service has had before. `usualSeverity` is what declaring it
 * starts from — a suggestion; each incident keeps its own severity.
 *
 * `occurrences` counts its incidents, resolved or not: how many, when the
 * latest was declared, and the number of one still active, if any is.
 *
 * `pendingReview` marks one saved while declaring something new, which the
 * Admin has yet to keep, rename, or merge.
 */
export interface KnownIssueResponse {
  id: string;
  name: string;
  description: string | null;
  usualSeverity: IncidentSeverity;
  service: {
    id: string;
    name: string;
    slug: string;
    team: { id: string; name: string; slug: string };
  };
  pendingReview: boolean;
  archivedAt: string | null;
  occurrences: {
    total: number;
    lastAt: string | null;
    /** An active incident of it, by number; null when none is active. */
    active: number | null;
  };
  createdAt: string;
}
