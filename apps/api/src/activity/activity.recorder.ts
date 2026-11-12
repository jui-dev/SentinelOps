import { getRequestClient } from '../common/request-context.js';
import type { Prisma } from '../generated/prisma/client.js';
import { ACTION_AREA } from './activity.actions.js';
import type {
  ActivityAction,
  ActivityChange,
  ActivitySubjectType,
} from './activity.contract.js';

/**
 * What happened, as the code that did it knows it. The area and the names
 * are not here: the area comes from the action, and the actor's name is read
 * from their account at the moment it happened.
 */
export interface ActivityRecord {
  organizationId: string;
  action: ActivityAction;
  /** Who did it; for a sign-in, whose account it was. */
  actorId: string;
  subject?: { type: ActivitySubjectType; id: string; name: string };
  changes?: ActivityChange[];
  /**
   * For an edit: record nothing when no field actually changed — saving a
   * form unchanged is not something that happened. Additions, removals and
   * sign-ins are recorded whatever their changes.
   */
  onlyIfChanged?: boolean;
}

/**
 * Only the fields that actually changed: a before and after that are equal
 * is no change, and listing it would make the log say something happened
 * that did not.
 */
export const changedFields = (changes: ActivityChange[]): ActivityChange[] =>
  changes.filter(({ before, after }) => before !== after);

/**
 * Writes one entry in the activity log, inside the transaction of the change
 * it records — so a change and its entry are saved together or not at all,
 * and a change that is rolled back leaves no entry claiming it happened.
 *
 * Where the request came from is read from the ambient request context, so
 * no service has to be handed it; outside a request — a script, a seed — it
 * is simply not known.
 */
export const recordActivity = async (
  tx: Prisma.TransactionClient,
  record: ActivityRecord,
): Promise<void> => {
  const changes = changedFields(record.changes ?? []);

  if (record.onlyIfChanged && changes.length === 0) return;

  const actor = await tx.user.findUniqueOrThrow({
    where: { id: record.actorId },
    select: { name: true },
  });
  const client = getRequestClient();

  await tx.activityEntry.create({
    data: {
      organizationId: record.organizationId,
      action: record.action,
      area: ACTION_AREA[record.action],
      actorId: record.actorId,
      actorName: actor.name,
      subjectType: record.subject?.type ?? null,
      subjectId: record.subject?.id ?? null,
      subjectName: record.subject?.name ?? null,
      changes: changes as unknown as Prisma.InputJsonValue,
      ipAddress: client?.ipAddress ?? null,
      userAgent: client?.userAgent ?? null,
    },
  });
};
