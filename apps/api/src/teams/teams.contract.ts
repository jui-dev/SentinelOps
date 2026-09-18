/**
 * The wire contract for teams.
 *
 * Declared rather than inferred from Prisma models, for the reason
 * auth.contract.ts gives: an inferred type grows a field with every migration.
 */

/**
 * One team. `slug` is there for a client to build URLs from; it is derived by
 * the API, never chosen by a client, and never changes.
 */
export interface TeamResponse {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  /** Members whose accounts still exist. */
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * One member of a team.
 *
 * Keyed by the organization membership id — the same id `GET /memberships`
 * lists, and the one the add and remove routes take. The team membership row's
 * own id is not exposed. Identity only: nothing about the member's other teams
 * or organizations.
 */
export interface TeamMemberResponse {
  membershipId: string;
  addedAt: string;
  user: {
    id: string;
    name: string;
    email: string;
  };
}
