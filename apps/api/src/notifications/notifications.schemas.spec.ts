import {
  listNotificationsQuerySchema,
  markNotificationsReadSchema,
} from './notifications.schemas.js';

const ID = '0199a1b2-c3d4-7000-8000-0000000000e1';

describe('notification request schemas', () => {
  describe('listNotificationsQuerySchema', () => {
    it('should accept no cursor, or an opaque one', () => {
      expect(listNotificationsQuerySchema.parse({})).toEqual({});
      expect(
        listNotificationsQuerySchema.parse({ cursor: 'anything' }),
      ).toEqual({ cursor: 'anything' });
    });

    it('should refuse an empty or oversized cursor', () => {
      expect(
        listNotificationsQuerySchema.safeParse({ cursor: '' }).success,
      ).toBe(false);
      expect(
        listNotificationsQuerySchema.safeParse({ cursor: 'x'.repeat(101) })
          .success,
      ).toBe(false);
    });
  });

  describe('markNotificationsReadSchema', () => {
    it('should accept a notification id to read through', () => {
      expect(markNotificationsReadSchema.parse({ through: ID })).toEqual({
        through: ID,
      });
    });

    it.each([
      ['no bound', {}],
      ['a malformed id', { through: 'latest' }],
      // A recipient is never input, whatever it is called.
      ['a recipient alongside', { through: ID, recipientMembershipId: ID }],
      ['an organization alongside', { through: ID, organizationId: ID }],
    ])('should refuse %s', (_case, body) => {
      expect(markNotificationsReadSchema.safeParse(body).success).toBe(false);
    });
  });
});
