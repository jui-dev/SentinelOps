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
            'activity:read',
            'incident-analyses:write',
            'incidents:declare',
            'incidents:manage',
            'incidents:read',
            'incidents:read-all',
            'incidents:respond',
            'invitations:manage',
            'invitations:read',
            'members:manage',
            'memberships:read',
            'memberships:read-all',
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
        { membershipId: 'membership-2', role: 'RESPONDER' },
      );

      expect(response.membership.permissions).toEqual([
        'incident-analyses:write',
        'incidents:read',
        'incidents:respond',
        'memberships:read',
        'notifications:read',
        'organization:read',
        'responses:work',
        'services:read',
        'teams:read',
      ]);
    });
  });

  describe('toOrganizationMembershipResponse', () => {
    it('should emit exactly the declared fields, including on the nested user', () => {
      const row = {
        id: 'membership-1',
        role: 'RESPONDER',
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

      expect(
        toOrganizationMembershipResponse(row, { accountSetup: true }),
      ).toStrictEqual({
        id: 'membership-1',
        role: 'RESPONDER',
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

    it('should leave account setup out for a reader who does not set accounts up', () => {
      const response = toOrganizationMembershipResponse(
        {
          id: 'membership-1',
          role: 'RESPONDER',
          createdAt: CREATED,
          user: {
            id: 'user-1',
            name: 'Ada Lovelace',
            email: 'ada@example.com',
            passwordChangeRequired: true,
          },
          teamMemberships: [],
        },
        { accountSetup: false },
      );

      expect(response.user).toStrictEqual({
        id: 'user-1',
        name: 'Ada Lovelace',
        email: 'ada@example.com',
      });
      expect('passwordChangeRequired' in response.user).toBe(false);
    });

    const baseRow = {
      id: 'membership-1',
      role: 'RESPONDER',
      createdAt: CREATED,
      user: {
        id: 'user-1',
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        passwordChangeRequired: false,
      },
    };

    it('should list every team, in the order selected', () => {
      const response = toOrganizationMembershipResponse(
        {
          ...baseRow,
          teamMemberships: [
            { team: { id: 'team-1', name: 'Payments', slug: 'payments' } },
            { team: { id: 'team-2', name: 'Platform', slug: 'platform' } },
          ],
        },
        { accountSetup: true },
      );

      expect(response.teams).toEqual([
        { id: 'team-1', name: 'Payments', slug: 'payments' },
        { id: 'team-2', name: 'Platform', slug: 'platform' },
      ]);
    });

    it('should answer an empty array for a member on no team', () => {
      const response = toOrganizationMembershipResponse(
        {
          ...baseRow,
          teamMemberships: [],
        },
        { accountSetup: true },
      );

      expect(response.teams).toEqual([]);
    });
  });
});
