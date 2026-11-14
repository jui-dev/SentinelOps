import type { ActivityAction, ActivityArea } from './activity.contract.js';

/**
 * The area each action belongs to. The recorder sets an entry's area from
 * this table, never from a caller, so the two cannot disagree. Keyed by
 * every action, so a new one without an area is a compile error.
 */
export const ACTION_AREA: Readonly<Record<ActivityAction, ActivityArea>> = {
  MEMBER_ADDED: 'PEOPLE',
  ROLE_CHANGED: 'PEOPLE',
  PASSWORD_RESET: 'PEOPLE',
  MEMBER_REMOVED: 'PEOPLE',
  MEMBER_RESTORED: 'PEOPLE',
  INVITATION_SENT: 'PEOPLE',
  INVITATION_REVOKED: 'PEOPLE',
  INVITATION_ACCEPTED: 'PEOPLE',
  TEAM_CREATED: 'TEAMS',
  TEAM_UPDATED: 'TEAMS',
  TEAM_DELETED: 'TEAMS',
  TEAM_MEMBER_ADDED: 'TEAMS',
  TEAM_MEMBER_REMOVED: 'TEAMS',
  SERVICE_CREATED: 'SERVICES',
  SERVICE_UPDATED: 'SERVICES',
  SERVICE_DELETED: 'SERVICES',
  KNOWN_ISSUE_CREATED: 'KNOWN_ISSUES',
  KNOWN_ISSUE_UPDATED: 'KNOWN_ISSUES',
  KNOWN_ISSUE_MERGED: 'KNOWN_ISSUES',
  ORGANIZATION_UPDATED: 'ORGANIZATION',
  SIGNED_IN: 'SECURITY',
  SIGN_IN_FAILED: 'SECURITY',
  SIGN_IN_BLOCKED: 'SECURITY',
  PASSWORD_CHANGED: 'SECURITY',
};

/** The areas of the Changes view: everything but sign-ins and passwords. */
export const CHANGE_AREAS = [
  'PEOPLE',
  'TEAMS',
  'SERVICES',
  'KNOWN_ISSUES',
  'ORGANIZATION',
] as const satisfies readonly ActivityArea[];

export type ChangeArea = (typeof CHANGE_AREAS)[number];

/**
 * A short code to point at one entry by — the last eight hex digits of its
 * id, in two groups: `ACT-7F3K-21AB`. The id's tail is its random part, so
 * two entries of one organization sharing a code is vanishingly unlikely;
 * the code identifies, the id addresses.
 */
export const referenceOf = (id: string): string => {
  const tail = id.replace(/-/g, '').slice(-8).toUpperCase();

  return `ACT-${tail.slice(0, 4)}-${tail.slice(4)}`;
};
