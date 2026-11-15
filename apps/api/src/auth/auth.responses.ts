import type {
  CurrentUserResponse,
  MembershipResponse,
  OrganizationResponse,
  UserResponse,
} from './auth.contract.js';

/**
 * The boundary between a database row and the wire.
 *
 * Every mapper here names each field it emits. That is the point, and it is
 * why none of them spreads its input: `{ ...user }` minus a denylist leaks
 * every column a future migration adds, and the first time such a column holds
 * a secret the leak has already shipped. Adding a field to a response is a
 * deliberate edit to this file.
 *
 * This is the second of three defences. The first is the narrow `select` on
 * each query, so an excluded column is never even in memory; the third is the
 * leak assertion in the integration suite, which walks every response body
 * looking for forbidden keys.
 *
 * Inputs are structural rather than Prisma model types, so a mapper cannot
 * silently start accepting a model that grew a sensitive field.
 */

interface UserRow {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  passwordChangeRequired: boolean;
}

interface OrganizationRow {
  id: string;
  name: string;
  slug: string;
  createdAt: Date;
  isDemo: boolean;
}

interface MembershipRow {
  id: string;
  role: string;
  organization: OrganizationRow;
}

/** Never emits passwordHash, deletedAt, or updatedAt. */
export const toUserResponse = (user: UserRow): UserResponse => ({
  id: user.id,
  email: user.email,
  name: user.name,
  createdAt: user.createdAt.toISOString(),
  passwordChangeRequired: user.passwordChangeRequired,
});

/** Never emits deletedAt: a soft-deleted row is filtered, not disclosed. */
export const toOrganizationResponse = (
  organization: OrganizationRow,
): OrganizationResponse => ({
  id: organization.id,
  name: organization.name,
  slug: organization.slug,
  createdAt: organization.createdAt.toISOString(),
  demo: organization.isDemo,
});

export const toMembershipResponse = (
  membership: MembershipRow,
): MembershipResponse => ({
  id: membership.id,
  role: membership.role,
  organization: toOrganizationResponse(membership.organization),
});

export const toCurrentUserResponse = (
  user: UserRow & { memberships: MembershipRow[] },
): CurrentUserResponse => ({
  ...toUserResponse(user),
  memberships: user.memberships.map(toMembershipResponse),
});
