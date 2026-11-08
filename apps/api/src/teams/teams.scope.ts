/**
 * Which of an organization's teams one reader may see.
 *
 * `teams:read` lets every role read teams; this narrows it to the reader's
 * own unless they also hold `teams:read-all`, as incidents.scope.ts narrows
 * `incidents:read`. A team is a reader's own when one thing is true:
 *
 *   - they have a TeamMembership row on it now
 *
 * That is the whole rule, and it is deliberately not the incidents' one.
 * Responding to an incident, or owning its analysis, keeps that *incident*
 * readable after the responsibility moves elsewhere — but it says nothing
 * about the team now responsible for it. Nor does a placement the reader
 * used to have: team placement keeps no history, so leaving a team hides it
 * at once. Incident visibility and team visibility answer different
 * questions, so this scope reaches no incident relation at all, and
 * incidentReadScope is not reused or composed here.
 *
 * Pure: the reader is given, never looked up, and the role is judged by the
 * same table the guards use — never by its name.
 */

import { Permission } from '../authorization/permissions.js';
import { hasPermission } from '../authorization/role-permissions.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { Role } from '../generated/prisma/enums.js';

/** Who is reading: the admitted membership and its role. */
export interface TeamReader {
  membershipId: string;
  role: Role;
}

/**
 * The reader's own teams as a condition, or undefined when they may see
 * every team in the organization.
 */
export const teamReadScope = (
  reader: TeamReader,
): Prisma.TeamWhereInput | undefined => {
  if (hasPermission(reader.role, Permission.TEAMS_READ_ALL)) {
    return undefined;
  }

  return { memberships: { some: { membershipId: reader.membershipId } } };
};

/**
 * `where` narrowed to the teams this reader may see in the organization,
 * which must not be soft-deleted.
 *
 * Each part is its own element of one AND, never spread into a shared
 * object, for the reason withinIncidentScope gives: `GET /teams` takes no
 * query today, but the moment a search or a page's cursor does, a spread
 * would let one key silently replace another — the caller's OR displacing
 * the scope's, or the reverse. As elements, every part applies whatever keys
 * `where` holds; even an organizationId in it can only narrow further, never
 * widen.
 */
export const withinTeamScope = (
  organizationId: string,
  reader: TeamReader,
  where: Prisma.TeamWhereInput = {},
): Prisma.TeamWhereInput => {
  const scope = teamReadScope(reader);

  return {
    AND: [
      { organizationId, organization: { deletedAt: null } },
      ...(scope ? [scope] : []),
      where,
    ],
  };
};
