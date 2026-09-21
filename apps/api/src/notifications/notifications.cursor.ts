import { isResourceId } from '../tenancy/tenancy.schemas.js';
import { invalidCursor } from './notifications.errors.js';

/**
 * Where the next page of a recipient's notifications starts: the last
 * notification's creation time, and its id to break a tie.
 * `2026-09-18T12:05:00.000Z~<uuid>` — the shape a member's responses page by.
 *
 * Also the bound "read through" is judged against: a notification is at or
 * before another when its (createdAt, id) is not greater.
 */
export interface NotificationPosition {
  createdAt: Date;
  id: string;
}

export const encodeNotificationCursor = ({
  createdAt,
  id,
}: NotificationPosition): string => `${createdAt.toISOString()}~${id}`;

/** The position a cursor names, or 400 INVALID_CURSOR for anything else. */
export const decodeNotificationCursor = (
  cursor: string,
): NotificationPosition => {
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
 * Notifications strictly after `position` in newest-first order — older than
 * it. Prisma has no row comparison, so (createdAt, id) < (t, i) is spelled
 * out.
 */
export const olderThan = ({ createdAt, id }: NotificationPosition) => ({
  OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lt: id } }],
});

/** Notifications at or before `position`: (createdAt, id) <= (t, i). */
export const atOrBefore = ({ createdAt, id }: NotificationPosition) => ({
  OR: [{ createdAt: { lt: createdAt } }, { createdAt, id: { lte: id } }],
});
