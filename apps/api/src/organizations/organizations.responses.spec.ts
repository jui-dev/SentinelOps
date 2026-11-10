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
          role: 'ADMIN',
        }),
      ).toStrictEqual({
        id: 'org-1',
        name: 'Acme Operations',
        slug: 'acme-operations',
        createdAt: '2026-09-01T12:00:00.000Z',
        membership: {
          id: 'membership-1',
          role: 'ADMIN',
          permissions: [
            'incident-analyses:write',
            'incidents:manage',
            'incidents:read',
            'incidents:read-all',
            'incidents:respond',
            'invitations:manage',
            'invitations:read',
            'members:manage',
            'memberships:read',
            'notifications:read',
            'organization:read',
            'organization:update',
            'services:manage',
            'services:read',
            'teams:manage',
            'teams:read',
            'teams:read-all',
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
        'incident-analyses:write',
        'incidents:read',
        'incidents:respond',
        'memberships:read',
        'notifications:read',
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
          passwordChangeRequired: true,
          deletedAt: null,
          memberships: [{ organizationId: 'org-2' }],
        },
        teamMemberships: [
          {
            id: 'team-membership-1',
            organizationId: 'org-1',
            createdAt: CREATED,
            // Columns a careless team select could carry. None may reach
            // the wire.
            team: {
              id: 'team-1',
              name: 'Payments',
              slug: 'payments',
              description: 'Card processing.',
              organizationId: 'org-1',
              memberships: [{ membershipId: 'membership-9' }],
            },
          },
        ],
      };

      expect(toOrganizationMembershipResponse(row)).toStrictEqual({
        id: 'membership-1',
        role: 'MEMBER',
        createdAt: '2026-09-01T12:00:00.000Z',
        user: {
          id: 'user-1',
          name: 'Ada Lovelace',
          email: 'ada@example.com',
          passwordChangeRequired: true,
        },
        teams: [{ id: 'team-1', name: 'Payments', slug: 'payments' }],
      });
    });

    const baseRow = {
      id: 'membership-1',
      role: 'MEMBER',
      createdAt: CREATED,
      user: {
        id: 'user-1',
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        passwordChangeRequired: false,
      },
    };

    it('should list every team, in the order selected', () => {
      const response = toOrganizationMembershipResponse({
        ...baseRow,
        teamMemberships: [
          { team: { id: 'team-1', name: 'Payments', slug: 'payments' } },
          { team: { id: 'team-2', name: 'Platform', slug: 'platform' } },
        ],
      });

      expect(response.teams).toEqual([
        { id: 'team-1', name: 'Payments', slug: 'payments' },
        { id: 'team-2', name: 'Platform', slug: 'platform' },
      ]);
    });

    it('should answer an empty array for a member on no team', () => {
      const response = toOrganizationMembershipResponse({
        ...baseRow,
        teamMemberships: [],
      });

      expect(response.teams).toEqual([]);
    });
  });
});
