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
  // Settled by the service, which knows who has been removed since.
  actor: { id: row.actorId, name: row.actorName, former: false },
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
  repeat: null,
});

/**
 * Folds wrong passwords tried one after another on one account into a
 * single row: the latest, saying how many and since when. `rows` are newest
 * first, as the log lists them; only rows next to each other fold, so
 * anything else that happened between them keeps them apart.
 */
export const foldRepeats = (rows: ActivityRow[]): ActivityEntryResponse[] => {
  const folded: ActivityEntryResponse[] = [];
  let head: ActivityRow | null = null;
  let oldest: ActivityRow | null = null;
  let count = 0;

  const close = () => {
    if (head === null || oldest === null) return;

    folded.push({
      ...toActivityEntryResponse(head),
      repeat:
        count > 1 ? { count, firstAt: oldest.createdAt.toISOString() } : null,
    });
    head = null;
    oldest = null;
    count = 0;
  };

  for (const row of rows) {
    if (row.action !== 'SIGN_IN_FAILED') {
      close();
      folded.push(toActivityEntryResponse(row));
    } else if (head !== null && head.actorId === row.actorId) {
      oldest = row;
      count += 1;
    } else {
      close();
      head = row;
      oldest = row;
      count = 1;
    }
  }

  close();

  return folded;
};
