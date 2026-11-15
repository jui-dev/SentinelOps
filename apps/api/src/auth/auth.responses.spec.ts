import {
  toCurrentUserResponse,
  toMembershipResponse,
  toOrganizationResponse,
  toUserResponse,
} from './auth.responses.js';

const CREATED_AT = new Date('2026-01-02T03:04:05.678Z');

/**
 * A full database row, sensitive columns included.
 *
 * The mappers are typed against narrow structural inputs, so TypeScript would
 * not object to these extra fields being absent. Passing them anyway is the
 * point: it proves the mappers drop what they are not told to emit, rather than
 * spreading whatever they are handed.
 */
const userRow = {
  id: 'user-1',
  email: 'ada@example.com',
  name: 'Ada Lovelace',
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
  passwordHash: '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA',
  passwordChangeRequired: true,
  deletedAt: new Date('2026-02-01T00:00:00.000Z'),
};

const organizationRow = {
  id: 'org-1',
  name: 'Acme Operations',
  slug: 'acme-operations',
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
  deletedAt: new Date('2026-02-01T00:00:00.000Z'),
  isDemo: false,
};

const membershipRow = {
  id: 'membership-1',
  role: 'ADMIN',
  organizationId: 'org-1',
  userId: 'user-1',
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
  organization: organizationRow,
};

describe('auth responses', () => {
  describe('toUserResponse', () => {
    it('should emit exactly the declared fields', () => {
      expect(toUserResponse(userRow)).toEqual({
        id: 'user-1',
        email: 'ada@example.com',
        name: 'Ada Lovelace',
        createdAt: '2026-01-02T03:04:05.678Z',
        passwordChangeRequired: true,
      });
    });

    it('should drop passwordHash', () => {
      expect(Object.keys(toUserResponse(userRow))).not.toContain(
        'passwordHash',
      );
    });

    it('should drop the soft-delete metadata', () => {
      const keys = Object.keys(toUserResponse(userRow));

      expect(keys).not.toContain('deletedAt');
      expect(keys).not.toContain('updatedAt');
    });

    it('should serialise dates as ISO-8601 strings', () => {
      expect(typeof toUserResponse(userRow).createdAt).toBe('string');
    });
  });

  describe('toOrganizationResponse', () => {
    it('should emit exactly the declared fields', () => {
      expect(toOrganizationResponse(organizationRow)).toEqual({
        id: 'org-1',
        name: 'Acme Operations',
        slug: 'acme-operations',
        createdAt: '2026-01-02T03:04:05.678Z',
        demo: false,
      });
    });

    it('should drop deletedAt', () => {
      // A soft-deleted row is filtered out of a query, never disclosed as one.
      expect(
        Object.keys(toOrganizationResponse(organizationRow)),
      ).not.toContain('deletedAt');
    });
  });

  describe('toMembershipResponse', () => {
    it('should emit the role and its organization, and nothing else', () => {
      expect(toMembershipResponse(membershipRow)).toEqual({
        id: 'membership-1',
        role: 'ADMIN',
        organization: {
          id: 'org-1',
          name: 'Acme Operations',
          slug: 'acme-operations',
          createdAt: '2026-01-02T03:04:05.678Z',
          demo: false,
        },
      });
    });

    it('should drop the raw foreign keys', () => {
      // The organization is nested; its id does not also need to be flat.
      const keys = Object.keys(toMembershipResponse(membershipRow));

      expect(keys).not.toContain('organizationId');
      expect(keys).not.toContain('userId');
    });
  });

  describe('toCurrentUserResponse', () => {
    it('should combine the user with its memberships', () => {
      const response = toCurrentUserResponse({
        ...userRow,
        memberships: [membershipRow],
      });

      expect(response).toEqual({
        id: 'user-1',
        email: 'ada@example.com',
        name: 'Ada Lovelace',
        createdAt: '2026-01-02T03:04:05.678Z',
        passwordChangeRequired: true,
        memberships: [
          {
            id: 'membership-1',
            role: 'ADMIN',
            organization: {
              id: 'org-1',
              name: 'Acme Operations',
              slug: 'acme-operations',
              createdAt: '2026-01-02T03:04:05.678Z',
              demo: false,
            },
          },
        ],
      });
    });

    it('should handle a user who belongs to nothing', () => {
      const response = toCurrentUserResponse({ ...userRow, memberships: [] });

      expect(response.memberships).toEqual([]);
    });

    it('should leak nothing sensitive at any depth', () => {
      const serialised = JSON.stringify(
        toCurrentUserResponse({ ...userRow, memberships: [membershipRow] }),
      );

      for (const forbidden of [
        'passwordHash',
        'deletedAt',
        'updatedAt',
        '$argon2id$',
      ]) {
        expect(serialised).not.toContain(forbidden);
      }
    });
  });
});
