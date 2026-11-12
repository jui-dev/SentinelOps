import { isResourceId } from '../tenancy/tenancy.schemas.js';
import { invalidCursor } from './activity.errors.js';

/**
 * Where the next page of the log starts: the last entry's time, and its id
 * to break a tie. `2026-11-12T14:32:14.000Z~<uuid>` — the shape notifications
 * page by.
 */
export interface ActivityPosition {
  createdAt: Date;
  id: string;
}

export const encodeActivityCursor = ({
  createdAt,
  id,
}: ActivityPosition): string => `${createdAt.toISOString()}~${id}`;

/** The position a cursor names, or 400 INVALID_CURSOR for anything else. */
export const decodeActivityCursor = (cursor: string): ActivityPosition => {
  const [at, id, ...rest] = cursor.split('~');
  const createdAt = at === undefined ? undefined : new Date(at);

  if (
    rest.length > 0 ||
    id === undefined ||
    !isResourceId(id) ||
    createdAt === undefined ||
    Number.isNaN(createdAt.getTime()) ||
    createdAt.toISOString() !== at
  ) {
    throw invalidCursor();
  }

  return { createdAt, id };
};

/**
 * Entries strictly older than `position`, newest first. Prisma has no row
 * comparison, so (createdAt, id) < (t, i) is spelled out.
 */
export const olderThan = ({ createdAt, id }: ActivityPosition) => ({
  OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }],
});
