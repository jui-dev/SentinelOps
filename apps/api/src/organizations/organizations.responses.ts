import { toOrganizationResponse } from '../auth/auth.responses.js';
import type {
  OrganizationDetailResponse,
  OrganizationMembershipResponse,
} from './organizations.contract.js';

/**
 * Row-to-wire mappers for organization-scoped reads. Same rules as
 * auth.responses.ts: every emitted field is named, nothing is spread from a
 * row, and inputs are structural rather than Prisma model types.
 */

interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
}

interface CallerMembership {
  membershipId: string;
  role: string;
}

interface MembershipRow {
  id: string;
  role: string;
  createdAt: Date;
  user: {
    id: string;
    name: string;
    email: string;
  };
}

export const toOrganizationDetailResponse = (
  organization: OrganizationRow,
  caller: CallerMembership,
): OrganizationDetailResponse => ({
  ...toOrganizationResponse(organization),
  membership: {
    id: caller.membershipId,
    role: caller.role,
  },
});

/** Never emits the user's password hash, deletion state, or other memberships. */
export const toOrganizationMembershipResponse = (
  membership: MembershipRow,
): OrganizationMembershipResponse => ({
  id: membership.id,
  role: membership.role,
  createdAt: membership.createdAt.toISOString(),
  user: {
    id: membership.user.id,
    name: membership.user.name,
    email: membership.user.email,
  },
});
