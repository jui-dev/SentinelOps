import type { IncidentSeverity } from '../incidents/incidents.contract.js';
import type { KnownIssueResponse } from './known-issues.contract.js';

/**
 * A known issue as KnownIssuesService selects it, with its occurrences
 * already counted. Structural rather than a Prisma type, so the mapping and
 * the order are tested without a database.
 */
export interface KnownIssueRow {
  id: string;
  name: string;
  description: string | null;
  usualSeverity: IncidentSeverity;
  pendingReview: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  service: {
    id: string;
    name: string;
    slug: string;
    ownerTeam: { id: string; name: string; slug: string };
  };
}

export interface Occurrences {
  total: number;
  lastAt: Date | null;
  active: number | null;
}

export const NO_OCCURRENCES: Occurrences = {
  total: 0,
  lastAt: null,
  active: null,
};

export const toKnownIssueResponse = (
  row: KnownIssueRow,
  occurrences: Occurrences,
): KnownIssueResponse => ({
  id: row.id,
  name: row.name,
  description: row.description,
  usualSeverity: row.usualSeverity,
  service: {
    id: row.service.id,
    name: row.service.name,
    slug: row.service.slug,
    team: {
      id: row.service.ownerTeam.id,
      name: row.service.ownerTeam.name,
      slug: row.service.ownerTeam.slug,
    },
  },
  pendingReview: row.pendingReview,
  archivedAt: row.archivedAt?.toISOString() ?? null,
  occurrences: {
    total: occurrences.total,
    lastAt: occurrences.lastAt?.toISOString() ?? null,
    active: occurrences.active,
  },
  createdAt: row.createdAt.toISOString(),
});

/**
 * The order declaring offers them in: most frequent first, then the most
 * recent, then by name — so a service's usual problems head its list, and
 * one never seen yet sorts by name after them.
 */
export const byFrequency = (
  a: KnownIssueResponse,
  b: KnownIssueResponse,
): number =>
  b.occurrences.total - a.occurrences.total ||
  (b.occurrences.lastAt ?? '').localeCompare(a.occurrences.lastAt ?? '') ||
  a.name.localeCompare(b.name) ||
  a.id.localeCompare(b.id);
