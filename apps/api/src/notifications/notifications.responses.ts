import type {
  IncidentSeverity,
  IncidentStatus,
} from '../incidents/incidents.contract.js';
import type {
  NotificationResponse,
  NotificationType,
} from './notifications.contract.js';

/**
 * A notification as NotificationsService selects it. Structural rather than
 * a Prisma type, so this mapping is tested without a database.
 */
export interface NotificationRow {
  id: string;
  type: NotificationType;
  createdAt: Date;
  readAt: Date | null;
  actor: { id: string; name: string };
  /** The timeline entry an INCIDENT_ type reports; null for TEAM_ types. */
  activity: {
    fromValue: string | null;
    toValue: string | null;
    incident: {
      number: number;
      title: string;
      severity: IncidentSeverity;
      status: IncidentStatus;
      service: { name: string; slug: string };
    };
  } | null;
  team: { id: string; name: string } | null;
}

/**
 * Which types report values that changed. A resolution's entry moves the
 * status to RESOLVED, which its type already says; the entry behind
 * "ready to resolve" is a response completing, which carries no values.
 */
const REPORTS_CHANGE: ReadonlySet<NotificationType> = new Set([
  'INCIDENT_DECLARED',
  'INCIDENT_REASSIGNED',
  'INCIDENT_SEVERITY_CHANGED',
  // The suggestion, and the severity it was settled at.
  'INCIDENT_SEVERITY_CONFIRMED',
]);

export const toNotificationResponse = (
  row: NotificationRow,
): NotificationResponse => ({
  id: row.id,
  type: row.type,
  createdAt: row.createdAt.toISOString(),
  readAt: row.readAt?.toISOString() ?? null,
  actor: { id: row.actor.id, name: row.actor.name },
  incident: row.activity
    ? {
        number: row.activity.incident.number,
        title: row.activity.incident.title,
        severity: row.activity.incident.severity,
        status: row.activity.incident.status,
        service: {
          name: row.activity.incident.service.name,
          slug: row.activity.incident.service.slug,
        },
      }
    : null,
  change:
    row.activity && REPORTS_CHANGE.has(row.type)
      ? { from: row.activity.fromValue, to: row.activity.toValue }
      : null,
  team: row.team ? { id: row.team.id, name: row.team.name } : null,
});
