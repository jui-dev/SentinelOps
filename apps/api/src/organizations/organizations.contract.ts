import type { OrganizationResponse } from '../auth/auth.contract.js';

/**
 * The wire contract for organization-scoped reads.
 *
 * Declared rather than inferred from Prisma models, for the reason
 * auth.contract.ts gives: an inferred type grows a field with every migration.
 */

/** The caller's own grant within the organization being read. */
export interface CallerMembershipResponse {
  id: string;
  role: string;
  /**
   * What this grant permits, sorted — derived from the role by the same table
   * the API enforces. A client uses it to decide what to offer, never to decide
   * what is allowed: every route still checks its own permission.
   */
  permissions: string[];
}

/**
 * What `GET /organizations/:organizationId` returns: the organization, and the
 * capacity in which the caller holds it.
 */
export interface OrganizationDetailResponse extends OrganizationResponse {
  membership: CallerMembershipResponse;
}

/**
 * A user as a membership listing renders one.
 *
 * Identity only. Deliberately carries none of the user's other memberships:
 * that would tell one tenant which other tenants its members belong to.
 */
export interface MemberUserResponse {
  id: string;
  name: string;
  email: string;
  /**
   * True until the person replaces the one-time password an admin gave them.
   * Says nothing about the password itself.
   *
   * Account setup, and so only for whoever sets accounts up: present to a
   * caller holding `members:manage`, and absent for everyone else — a member
   * reading the directory sees who their colleagues are, not whose account
   * is still being set up.
   */
  passwordChangeRequired?: boolean;
}

/** A team a member is on: identity only — never its members or services. */
export interface MemberTeamResponse {
  id: string;
  name: string;
  slug: string;
}

/**
 * One membership record within an organization.
 *
 * The resource is the membership, not the user: `id` is the membership's id,
 * which is why the routes are `/memberships` rather than `/members`.
 *
 * `teams` is every team in this organization the member is on, ordered by
 * name — always an array, empty for a member on no team. Team membership
 * belongs to the organization membership, not the user, so it sits here
 * rather than on `user`.
 */
export interface OrganizationMembershipResponse {
  id: string;
  role: string;
  createdAt: string;
  user: MemberUserResponse;
  teams: MemberTeamResponse[];
}
