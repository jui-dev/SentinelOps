/**
 * Operational attention: the active incidents waiting on one caller now.
 *
 * Current state, not history. Nothing here is an event or is stored: each
 * section is a question asked of the incidents as they stand, so an item
 * appears when the work exists and is gone once it does not — resolved,
 * reassigned, or picked up. The timeline is where what happened is kept.
 *
 *   readyToResolve  incidents:manage. INVESTIGATING, and no responder is
 *                   still investigating: the same rule the resolution
 *                   itself enforces.
 *   needsYourTeam   incidents:respond. On one of the caller's teams, and
 *                   nobody now on that team has responded — so a
 *                   reassignment brings it to the new team even when the
 *                   old team's responders are still listed, and it leaves
 *                   the other members' lists once one of them starts.
 *   yourResponses   incidents:respond. The caller's own response is still
 *                   INVESTIGATING, whatever team the incident has now.
 *
 * Pure: the caller's permissions and teams are given, never looked up, and
 * rows are structural rather than Prisma types.
 */

import type {
  IncidentResponderStatus,
  IncidentSeverity,
  IncidentStatus,
} from './incidents.contract.js';

interface AttentionRow {
  number: number;
  severity: IncidentSeverity;
  status: IncidentStatus;
  team: { id: string };
  responders: readonly {
    status: IncidentResponderStatus;
    membership: { id: string };
  }[];
}

/** Who is asking, and what they may do — decided by the role table. */
export interface AttentionCaller {
  membershipId: string;
  canManage: boolean;
  canRespond: boolean;
  /**
   * The caller's teams, each with the membership ids of everyone on it now,
   * the caller included. The keys are the caller's teams; a team they are
   * not on is not here.
   */
  teams: ReadonlyMap<string, ReadonlySet<string>>;
}

/** Each section is null when the caller lacks its permission. */
export interface Attention<Row extends AttentionRow> {
  manage: { readyToResolve: Row[] } | null;
  respond: { needsYourTeam: Row[]; yourResponses: Row[] } | null;
}

/** Most severe first — the order the database enum declares them in. */
const SEVERITY_ORDER: readonly IncidentSeverity[] = [
  'SEV1',
  'SEV2',
  'SEV3',
  'SEV4',
];

/** The active list's order: most severe, then longest-running, first. */
const byUrgency = (a: AttentionRow, b: AttentionRow): number =>
  SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
  a.number - b.number;

/**
 * INVESTIGATING, and no responder is still investigating: the Admin may
 * resolve it. Exported so the notification that it has become so is judged
 * by this same rule.
 */
export const readyToResolve = (
  incident: Pick<AttentionRow, 'status' | 'responders'>,
): boolean =>
  incident.status === 'INVESTIGATING' &&
  incident.responders.length > 0 &&
  incident.responders.every(({ status }) => status !== 'INVESTIGATING');

/**
 * Sorts the active incidents into the caller's sections. A resolved row is
 * ignored: it waits on nobody. Each section is in the active list's order.
 */
export const classifyAttention = <Row extends AttentionRow>(
  incidents: readonly Row[],
  caller: AttentionCaller,
): Attention<Row> => {
  const active = incidents
    .filter(({ status }) => status !== 'RESOLVED')
    .sort(byUrgency);

  const ownStatus = (incident: Row) =>
    incident.responders.find(
      ({ membership }) => membership.id === caller.membershipId,
    )?.status;

  const needsTeam = (incident: Row): boolean => {
    const team = caller.teams.get(incident.team.id);

    return (
      team !== undefined &&
      ownStatus(incident) === undefined &&
      !incident.responders.some(({ membership }) => team.has(membership.id))
    );
  };

  return {
    manage: caller.canManage
      ? { readyToResolve: active.filter(readyToResolve) }
      : null,
    respond: caller.canRespond
      ? {
          needsYourTeam: active.filter(needsTeam),
          yourResponses: active.filter(
            (incident) => ownStatus(incident) === 'INVESTIGATING',
          ),
        }
      : null,
  };
};
