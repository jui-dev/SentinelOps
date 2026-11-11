/**
 * The wire contract for notifications.
 *
 * Declared rather than inferred from Prisma models, for the reason
 * auth.contract.ts gives: an inferred type grows a field with every migration.
 */

import type {
  IncidentSeverity,
  IncidentStatus,
} from '../incidents/incidents.contract.js';

/**
 * What a notification tells its recipient — the database enum's values. The
 * client words each one; nothing rendered is stored or sent.
 */
export type NotificationType =
  | 'INCIDENT_DECLARED'
  | 'INCIDENT_REASSIGNED'
  | 'INCIDENT_SEVERITY_CHANGED'
  | 'INCIDENT_RESOLVED'
  | 'INCIDENT_READY_TO_RESOLVE'
  | 'INCIDENT_OPENED_TO_TEAM'
  | 'INCIDENT_ASSIGNED'
  | 'TEAM_MEMBERSHIP_ADDED'
  | 'TEAM_MEMBERSHIP_REMOVED';

/**
 * One notification, as its recipient sees it.
 *
 * Two kinds of state, deliberately apart. `incident` is the incident as it
 * stands now — its title, severity, and status may have moved on since.
 * `change` is what the notification reports, as it was recorded at the time.
 *
 * Identity only: the actor is a name, never an email, and a departed actor is
 * still named. The resolution note is not here — a notification identifies
 * the incident and what happened to it; the incident's own page holds what
 * was written.
 */
export interface NotificationResponse {
  id: string;
  type: NotificationType;
  createdAt: string;
  /** When the recipient acknowledged it; null while unread. */
  readAt: string | null;
  /** Who did what it reports. */
  actor: { id: string; name: string };
  /** The incident now. Set for INCIDENT_ types; null for TEAM_ types. */
  incident: {
    number: number;
    title: string;
    severity: IncidentSeverity;
    status: IncidentStatus;
    service: { name: string; slug: string };
  } | null;
  /**
   * The values the change moved between, as recorded: SEVERITY_CHANGED from
   * one severity to another, REASSIGNED from one team's name to another's
   * (names as they were then), DECLARED to the severity it was declared at.
   * Null for the types whose change carries no values.
   */
  change: { from: string | null; to: string | null } | null;
  /** The team placed on or taken off. Set for TEAM_ types only. */
  team: { id: string; name: string } | null;
}

/**
 * One page of the caller's notifications, newest first. `cursor` fetches the
 * next page; null when this is the last.
 */
export interface NotificationPage {
  items: NotificationResponse[];
  page: { cursor: string | null; hasMore: boolean };
}

/** How many of the caller's notifications are unread. */
export interface NotificationUnreadCountResponse {
  count: number;
}
