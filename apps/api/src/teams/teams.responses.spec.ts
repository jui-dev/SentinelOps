import { toTeamMemberResponse, toTeamResponse } from './teams.responses.js';

const CREATED = new Date('2026-09-18T12:00:00.000Z');
const UPDATED = new Date('2026-09-18T13:00:00.000Z');

describe('team responses', () => {
  it('should emit exactly the declared team fields', () => {
    const row = {
      id: 'team-1',
      name: 'Platform',
      slug: 'platform',
      description: null,
      createdAt: CREATED,
      updatedAt: UPDATED,
      _count: { memberships: 2, services: 3 },
      organizationId: 'org-1',
    };

    expect(toTeamResponse(row)).toStrictEqual({
      id: 'team-1',
      name: 'Platform',
      slug: 'platform',
      description: null,
      memberCount: 2,
      serviceCount: 3,
      createdAt: '2026-09-18T12:00:00.000Z',
      updatedAt: '2026-09-18T13:00:00.000Z',
    });
  });

  it('should emit exactly the declared member fields, including on the nested user', () => {
    const row = {
      id: 'team-membership-1',
      organizationId: 'org-1',
      membershipId: 'membership-1',
      createdAt: CREATED,
      membership: {
        role: 'ADMIN',
        user: {
          id: 'user-1',
          name: 'Ada Lovelace',
          email: 'ada@example.com',
          passwordHash: 'secret',
          deletedAt: null,
        },
      },
    };

    expect(toTeamMemberResponse(row)).toStrictEqual({
      membershipId: 'membership-1',
      addedAt: '2026-09-18T12:00:00.000Z',
      user: { id: 'user-1', name: 'Ada Lovelace', email: 'ada@example.com' },
    });
  });
});
