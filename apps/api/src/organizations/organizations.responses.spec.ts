import {
  toOrganizationDetailResponse,
  toOrganizationMembershipResponse,
} from './organizations.responses.js';

const CREATED = new Date('2026-09-01T12:00:00.000Z');

describe('organization response mappers', () => {
  describe('toOrganizationDetailResponse', () => {
    it('should emit exactly the declared fields', () => {
      const row = {
        id: 'org-1',
        name: 'Acme Operations',
        slug: 'acme-operations',
        createdAt: CREATED,
        // Columns a careless select could carry. None may reach the wire.
        updatedAt: CREATED,
        deletedAt: null,
      };

      expect(
        toOrganizationDetailResponse(row, {
          membershipId: 'membership-1',
          role: 'OWNER',
        }),
      ).toStrictEqual({
        id: 'org-1',
        name: 'Acme Operations',
        slug: 'acme-operations',
        createdAt: '2026-09-01T12:00:00.000Z',
        membership: {
          id: 'membership-1',
          role: 'OWNER',
          permissions: [
            'invitations:manage',
            'invitations:read',
            'memberships:read',
            'organization:read',
            'organization:update',
            'services:manage',
            'services:read',
            'teams:manage',
            'teams:read',
          ],
        },
      });
    });

    it('should not offer a member the rename permission', () => {
      const response = toOrganizationDetailResponse(
        {
          id: 'org-1',
          name: 'Acme Operations',
          slug: 'acme-operations',
          createdAt: CREATED,
        },
        { membershipId: 'membership-2', role: 'MEMBER' },
      );

      expect(response.membership.permissions).toEqual([
        'memberships:read',
        'organization:read',
        'services:read',
        'teams:read',
      ]);
    });
  });

  describe('toOrganizationMembershipResponse', () => {
    it('should emit exactly the declared fields, including on the nested user', () => {
      const row = {
        id: 'membership-1',
        role: 'MEMBER',
        createdAt: CREATED,
        organizationId: 'org-1',
        userId: 'user-1',
        updatedAt: CREATED,
        user: {
          id: 'user-1',
          name: 'Ada Lovelace',
          email: 'ada@example.com',
          passwordHash: '$argon2id$secret',
          deletedAt: null,
          memberships: [{ organizationId: 'org-2' }],
        },
      };

      expect(toOrganizationMembershipResponse(row)).toStrictEqual({
        id: 'membership-1',
        role: 'MEMBER',
        createdAt: '2026-09-01T12:00:00.000Z',
        user: {
          id: 'user-1',
          name: 'Ada Lovelace',
          email: 'ada@example.com',
        },
      });
    });
  });
});
