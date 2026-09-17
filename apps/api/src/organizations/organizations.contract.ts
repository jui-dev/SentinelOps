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
}

/**
 * One membership record within an organization.
 *
 * The resource is the membership, not the user: `id` is the membership's id,
 * which is why the routes are `/memberships` rather than `/members`.
 */
export interface OrganizationMembershipResponse {
  id: string;
  role: string;
  createdAt: string;
  user: MemberUserResponse;
}
