import { BadRequestException } from '@nestjs/common';

import {
  decodeActivityCursor,
  encodeActivityCursor,
} from './activity.cursor.js';

const ID = '01934f2a-7b1c-7d3e-9f40-a1b2c3d4e5f6';

describe('activity cursor', () => {
  it('should round-trip a position', () => {
    const position = {
      createdAt: new Date('2026-11-12T14:32:14.123Z'),
      id: ID,
    };

    expect(decodeActivityCursor(encodeActivityCursor(position))).toEqual(
      position,
    );
  });

  it.each([
    ['no id', '2026-11-12T14:32:14.123Z'],
    ['a malformed id', '2026-11-12T14:32:14.123Z~not-an-id'],
    ['a malformed time', `yesterday~${ID}`],
    ['a time not in its own form', `2026-11-12T14:32:14Z~${ID}`],
    ['a third part', `2026-11-12T14:32:14.123Z~${ID}~more`],
  ])('should refuse %s with INVALID_CURSOR', (_, cursor) => {
    expect(() => decodeActivityCursor(cursor)).toThrow(BadRequestException);
  });
});
