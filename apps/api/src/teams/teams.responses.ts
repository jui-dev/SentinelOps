import type { TeamMemberResponse, TeamResponse } from './teams.contract.js';

/**
 * Row-to-wire mappers for teams. Same rules as auth.responses.ts: every
 * emitted field is named, nothing is spread from a row, and inputs are
 * structural rather than Prisma model types.
 */

interface TeamRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count: { memberships: number };
}

interface TeamMemberRow {
  membershipId: string;
  createdAt: Date;
  membership: {
    user: { id: string; name: string; email: string };
  };
}

export const toTeamResponse = (team: TeamRow): TeamResponse => ({
  id: team.id,
  name: team.name,
  slug: team.slug,
  description: team.description,
  memberCount: team._count.memberships,
  createdAt: team.createdAt.toISOString(),
  updatedAt: team.updatedAt.toISOString(),
});

/** Never emits the user's password hash, deletion state, or other memberships. */
export const toTeamMemberResponse = (
  member: TeamMemberRow,
): TeamMemberResponse => ({
  membershipId: member.membershipId,
  addedAt: member.createdAt.toISOString(),
  user: {
    id: member.membership.user.id,
    name: member.membership.user.name,
    email: member.membership.user.email,
  },
});
