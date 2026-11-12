import { referenceOf } from './activity.actions.js';
import type {
  ActivityAction,
  ActivityArea,
  ActivityChange,
  ActivityEntryResponse,
  ActivitySubjectType,
} from './activity.contract.js';
import { describeUserAgent } from './activity.user-agent.js';

/**
 * An entry as ActivityService selects it. Structural rather than a Prisma
 * type, so the mapping is tested without a database.
 */
export interface ActivityRow {
  id: string;
  action: ActivityAction;
  area: ActivityArea;
  actorId: string;
  actorName: string;
  subjectType: ActivitySubjectType | null;
  subjectId: string | null;
  subjectName: string | null;
  changes: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
}

const isChange = (value: unknown): value is ActivityChange => {
  if (typeof value !== 'object' || value === null) return false;

  const { field, before, after } = value as Record<string, unknown>;
  const side = (x: unknown) => x === null || typeof x === 'string';

  return typeof field === 'string' && side(before) && side(after);
};

/**
 * The changes column as the contract states it. Only the recorder writes
 * it, so anything else is unexpected — dropped rather than passed on, so a
 * malformed row can never put an unknown shape on the wire.
 */
export const changesOf = (stored: unknown): ActivityChange[] =>
  Array.isArray(stored)
    ? stored
        .filter(isChange)
        .map(({ field, before, after }) => ({ field, before, after }))
    : [];

export const toActivityEntryResponse = (
  row: ActivityRow,
): ActivityEntryResponse => ({
  id: row.id,
  reference: referenceOf(row.id),
  action: row.action,
  area: row.area,
  occurredAt: row.createdAt.toISOString(),
  actor: { id: row.actorId, name: row.actorName },
  subject:
    row.subjectType !== null && row.subjectId !== null
      ? {
          type: row.subjectType,
          id: row.subjectId,
          name: row.subjectName ?? '',
        }
      : null,
  changes: changesOf(row.changes),
  client:
    row.ipAddress === null && row.userAgent === null
      ? null
      : {
          ipAddress: row.ipAddress,
          browser: describeUserAgent(row.userAgent),
        },
});
