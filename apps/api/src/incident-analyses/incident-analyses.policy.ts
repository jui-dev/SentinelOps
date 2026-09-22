/**
 * Who may write one incident analysis: its owner, or whoever runs
 * incidents' lifecycles. Both must also hold `incident-analyses:write`.
 *
 * The role table grants the verb; this narrows it to the analysis, as
 * IncidentsService narrows `incidents:respond` to the responsible team. The
 * role is the caller's admitted one, judged by the same table the guards
 * use — never by its name.
 *
 * Pure: the caller and the owner are given, never looked up.
 */

import { Permission } from '../authorization/permissions.js';
import { hasPermission } from '../authorization/role-permissions.js';
import type { Role } from '../generated/prisma/enums.js';

export interface AnalysisCaller {
  membershipId: string;
  role: Role;
}

export const mayWriteAnalysis = (
  caller: AnalysisCaller,
  analysis: { ownerMembershipId: string },
): boolean =>
  hasPermission(caller.role, Permission.INCIDENT_ANALYSES_WRITE) &&
  (hasPermission(caller.role, Permission.INCIDENTS_MANAGE) ||
    analysis.ownerMembershipId === caller.membershipId);
