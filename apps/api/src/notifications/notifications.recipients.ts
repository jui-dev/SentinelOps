/**
 * Who is told of an incident's timeline entry: one rule per notification
 * type, and nothing else.
 *
 * Each entry is judged on its own, against the incident as it stands once
 * the change that wrote it has applied. A change that writes several entries
 * — a severity and a team in one request — is several events, each told to
 * its own recipients: someone who qualifies for two is told of both.
 *
 *   INCIDENT_DECLARED          the responsible team
 *   INCIDENT_REASSIGNED        the new responsible team, and every responder
 *                              still investigating, whatever their team
 *   INCIDENT_SEVERITY_CHANGED  the responsible team, and every responder
 *                              still investigating
 *   INCIDENT_RESOLVED          the responsible team, and everyone who
 *                              responded
 *   INCIDENT_READY_TO_RESOLVE  whoever runs incidents' lifecycles (Admins)
 *   INCIDENT_OPENED_TO_TEAM    the responsible team
 *   INCIDENT_ASSIGNED          the people just assigned, and nobody already
 *                              assigned before this choice
 *
 * Never the actor — whoever did it knows — whichever way they would
 * otherwise qualify. Qualifying twice for one entry is still one recipient.
 *
 * Pure: candidates are given, never looked up, so a membership is only ever
 * one the caller read within the incident's own organization.
 *
 * A team placement is simpler, and has its own rule at the end: only the
 * member placed or removed is told.
 */

import type { IncidentResponderStatus } from '../incidents/incidents.contract.js';

export type IncidentNotificationType =
  | 'INCIDENT_DECLARED'
  | 'INCIDENT_REASSIGNED'
  | 'INCIDENT_SEVERITY_CHANGED'
  | 'INCIDENT_RESOLVED'
  | 'INCIDENT_READY_TO_RESOLVE'
  | 'INCIDENT_OPENED_TO_TEAM'
  | 'INCIDENT_ASSIGNED';

/** Who could be told, as membership ids. */
export interface IncidentCandidates {
  /** The acting membership, which is never told. */
  actorMembershipId: string;
  /** Everyone now on the incident's responsible team. */
  teamMemberIds: readonly string[];
  /** Everyone who has responded to it, with where their response stands. */
  responders: readonly {
    membershipId: string;
    status: IncidentResponderStatus;
  }[];
  /** Everyone whose role runs incidents' lifecycles. */
  adminIds: readonly string[];
  /** Everyone this change assigned who was not assigned before it. */
  newAssigneeIds: readonly string[];
}

/** Which candidates each type needs, so no more are read than are used. */
export const CANDIDATES_NEEDED: Record<
  IncidentNotificationType,
  { team: boolean; responders: boolean; admins: boolean; assigned: boolean }
> = {
  INCIDENT_DECLARED: {
    team: true,
    responders: false,
    admins: false,
    assigned: false,
  },
  INCIDENT_REASSIGNED: {
    team: true,
    responders: true,
    admins: false,
    assigned: false,
  },
  INCIDENT_SEVERITY_CHANGED: {
    team: true,
    responders: true,
    admins: false,
    assigned: false,
  },
  INCIDENT_RESOLVED: {
    team: true,
    responders: true,
    admins: false,
    assigned: false,
  },
  INCIDENT_READY_TO_RESOLVE: {
    team: false,
    responders: false,
    admins: true,
    assigned: false,
  },
  INCIDENT_OPENED_TO_TEAM: {
    team: true,
    responders: false,
    admins: false,
    assigned: false,
  },
  INCIDENT_ASSIGNED: {
    team: false,
    responders: false,
    admins: false,
    assigned: true,
  },
};

const investigating = (candidates: IncidentCandidates) =>
  candidates.responders
    .filter(({ status }) => status === 'INVESTIGATING')
    .map(({ membershipId }) => membershipId);

const everyResponder = (candidates: IncidentCandidates) =>
  candidates.responders.map(({ membershipId }) => membershipId);

const RULES: Record<
  IncidentNotificationType,
  (candidates: IncidentCandidates) => readonly string[]
> = {
  INCIDENT_DECLARED: (c) => c.teamMemberIds,
  INCIDENT_REASSIGNED: (c) => [...c.teamMemberIds, ...investigating(c)],
  INCIDENT_SEVERITY_CHANGED: (c) => [...c.teamMemberIds, ...investigating(c)],
  INCIDENT_RESOLVED: (c) => [...c.teamMemberIds, ...everyResponder(c)],
  INCIDENT_READY_TO_RESOLVE: (c) => c.adminIds,
  INCIDENT_OPENED_TO_TEAM: (c) => c.teamMemberIds,
  INCIDENT_ASSIGNED: (c) => c.newAssigneeIds,
};

/** The membership ids to tell of one entry: unique, sorted, never the actor. */
export const incidentRecipients = (
  type: IncidentNotificationType,
  candidates: IncidentCandidates,
): string[] =>
  [...new Set(RULES[type](candidates))]
    .filter((id) => id !== candidates.actorMembershipId)
    .sort();

/**
 * Who is told that a member was placed on or taken off a team: that member,
 * and nobody else — not their teammates, not the Admins. Unless they did it
 * themselves: whoever acts knows.
 */
export const teamMembershipRecipients = (
  memberMembershipId: string,
  actorMembershipId: string,
): string[] =>
  memberMembershipId === actorMembershipId ? [] : [memberMembershipId];
