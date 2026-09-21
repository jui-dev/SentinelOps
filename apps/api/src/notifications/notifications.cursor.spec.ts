import { HttpException } from '@nestjs/common';

import {
  atOrBefore,
  decodeNotificationCursor,
  encodeNotificationCursor,
  olderThan,
} from './notifications.cursor.js';
import { NotificationsErrorCode } from './notifications.errors.js';

const ID = '0199a1b2-c3d4-7000-8000-0000000000e1';
const AT = new Date('2026-09-18T12:05:00.000Z');

describe('notification cursors', () => {
  it('should round-trip a position', () => {
    const cursor = encodeNotificationCursor({ createdAt: AT, id: ID });

    expect(cursor).toBe(`2026-09-18T12:05:00.000Z~${ID}`);
    expect(decodeNotificationCursor(cursor)).toEqual({ createdAt: AT, id: ID });
  });

  it.each([
    ['no separator', '2026-09-18T12:05:00.000Z'],
    ['an extra part', `2026-09-18T12:05:00.000Z~${ID}~x`],
    ['a malformed id', '2026-09-18T12:05:00.000Z~not-a-uuid'],
    ['an unparseable time', `yesterday~${ID}`],
    // Parses, but is not the form this API issues.
    ['a non-canonical time', `2026-09-18T12:05:00Z~${ID}`],
    ['nothing before the separator', `~${ID}`],
  ])('should refuse %s with 400 INVALID_CURSOR', (_case, cursor) => {
    const caught = (() => {
      try {
        decodeNotificationCursor(cursor);
      } catch (error) {
        return error;
      }
    })();

    expect(caught).toBeInstanceOf(HttpException);
    expect((caught as HttpException).getStatus()).toBe(400);
    expect((caught as HttpException).errorCode).toBe(
      NotificationsErrorCode.INVALID_CURSOR,
    );
  });

  it('should page strictly past a position, breaking a tie by id', () => {
    expect(olderThan({ createdAt: AT, id: ID })).toEqual({
      OR: [{ createdAt: { lt: AT } }, { createdAt: AT, id: { lt: ID } }],
    });
  });

  it('should bound read-through at a position, including it', () => {
    expect(atOrBefore({ createdAt: AT, id: ID })).toEqual({
      OR: [{ createdAt: { lt: AT } }, { createdAt: AT, id: { lte: ID } }],
    });
  });
});
