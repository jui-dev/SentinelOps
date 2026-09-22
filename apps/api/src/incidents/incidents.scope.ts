/**
 * Which of an organization's incidents one reader may see.
 *
 * `incidents:read` lets every role read incidents; this narrows it to the
 * reader's own unless they also hold `incidents:read-all`, as
 * IncidentsService narrows `incidents:respond` to the responsible team. An
 * incident is a reader's own when any of these is true:
 *
 *   - its responsible team (Incident.teamId) is one they are on now
 *   - they responded to it: an IncidentResponder row, whatever its status,
 *     which outlives a reassignment of the team
 *   - they own its analysis
 *
 * The service's owner is deliberately not consulted. Incident.teamId is the
 * recorded responsibility, the same relation that decides who may start
 * investigating; the service's owner is configuration and may have moved on.
 *
 * Team placement keeps no history, so the scope follows the teams as they
 * stand: joining a team shows its past incidents, and leaving one hides them
 * except those the reader responded to or owns the analysis of.
 *
 * Pure: the reader is given, never looked up, and the role is judged by the
 * same table the guards use — never by its name.
 */

import { Permission } from '../authorization/permissions.js';
import { hasPermission } from '../authorization/role-permissions.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { Role } from '../generated/prisma/enums.js';

/** Who is reading: the admitted membership and its role. */
export interface IncidentReader {
  membershipId: string;
  role: Role;
}

/**
 * The reader's own incidents as a condition, or undefined when they may
 * read every incident in the organization.
 */
export const incidentReadScope = (
  reader: IncidentReader,
): Prisma.IncidentWhereInput | undefined => {
  if (hasPermission(reader.role, Permission.INCIDENTS_READ_ALL)) {
    return undefined;
  }

  const { membershipId } = reader;

  return {
    OR: [
      { team: { memberships: { some: { membershipId } } } },
      { responders: { some: { membershipId } } },
      { analysis: { is: { ownerMembershipId: membershipId } } },
    ],
  };
};

/**
 * `where` narrowed to the incidents this reader may see in the organization,
 * which must not be soft-deleted.
 *
 * Each part is its own element of one AND, never spread into a shared
 * object: a caller's `where` may carry its own OR (a page's cursor) or AND
 * (a search), and a spread would let one key silently replace another —
 * the scope's OR overwriting the cursor's, or the cursor's the scope's. As
 * elements, every part applies, whatever keys `where` holds; even an
 * organizationId in it can only narrow further, never widen.
 */
export const withinIncidentScope = (
  organizationId: string,
  reader: IncidentReader,
  where: Prisma.IncidentWhereInput = {},
): Prisma.IncidentWhereInput => {
  const scope = incidentReadScope(reader);

  return {
    AND: [
      { organizationId, organization: { deletedAt: null } },
      ...(scope ? [scope] : []),
      where,
    ],
  };
};
