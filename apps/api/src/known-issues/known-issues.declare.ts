import { recordActivity } from '../activity/activity.recorder.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { IncidentSeverity } from '../incidents/incidents.contract.js';
import {
  knownIssueArchived,
  knownIssueNotFound,
} from './known-issues.errors.js';

/**
 * Which known issue a declaration is an occurrence of, inside the
 * declaration's own transaction, once its service is found and locked.
 *
 *   knownIssueId      one of the service's, not archived — chosen from the
 *                     list. Another service's, another organization's, or
 *                     none answers 404, exactly as not existing.
 *   saveAsKnownIssue  something new, kept for next time: named by the
 *                     incident's title, described by its summary, usually
 *                     its severity, and pending the Admin's review. If the
 *                     service already has one by that name, in any case,
 *                     the incident is linked to that one instead — a
 *                     declaration is never refused over a name.
 *   neither           a one-off: null.
 *
 * Saving something new is recorded in the activity log, attributed to
 * `actorId` — whoever declared it.
 *
 * The two are never both given; the request schema refuses that.
 */
export const knownIssueForDeclaration = async (
  tx: Prisma.TransactionClient,
  declaration: {
    organizationId: string;
    serviceId: string;
    title: string;
    summary: string | null;
    severity: IncidentSeverity;
    knownIssueId?: string;
    saveAsKnownIssue?: boolean;
    actorId: string;
  },
): Promise<string | null> => {
  const { organizationId, serviceId } = declaration;

  if (declaration.knownIssueId !== undefined) {
    const chosen = await tx.knownIssue.findFirst({
      where: { id: declaration.knownIssueId, organizationId, serviceId },
      select: { id: true, archivedAt: true },
    });

    if (!chosen) throw knownIssueNotFound();
    if (chosen.archivedAt !== null) throw knownIssueArchived();

    return chosen.id;
  }

  if (declaration.saveAsKnownIssue !== true) return null;

  const existing = await tx.knownIssue.findFirst({
    where: {
      organizationId,
      serviceId,
      name: { equals: declaration.title, mode: 'insensitive' },
    },
    select: { id: true },
  });

  if (existing) return existing.id;

  // An exact-name race with another declaration resolves to the same row.
  const saved = await tx.knownIssue.upsert({
    where: { serviceId_name: { serviceId, name: declaration.title } },
    create: {
      organizationId,
      serviceId,
      name: declaration.title,
      description: declaration.summary,
      usualSeverity: declaration.severity,
      pendingReview: true,
    },
    update: {},
    select: { id: true, name: true, description: true },
  });

  await recordActivity(tx, {
    organizationId,
    action: 'KNOWN_ISSUE_CREATED',
    actorId: declaration.actorId,
    subject: { type: 'KNOWN_ISSUE', id: saved.id, name: saved.name },
    changes: [
      { field: 'description', before: null, after: saved.description },
      { field: 'usualSeverity', before: null, after: declaration.severity },
      { field: 'status', before: null, after: 'PENDING_REVIEW' },
    ],
  });

  return saved.id;
};
