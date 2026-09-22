/**
 * What a member may do within an organization, named by operation rather than
 * by role.
 *
 * Routes declare one of these with `@RequirePermission()`; which roles hold it
 * is decided in one place, role-permissions.ts. A route therefore never spells
 * a role name, and changing who may do something is a change to that table,
 * not to every route that does it.
 *
 * A permission is added with the route that needs it. An entry nothing
 * enforces is a promise the code does not keep.
 */
export const Permission = {
  ORGANIZATION_READ: 'organization:read',
  ORGANIZATION_UPDATE: 'organization:update',
  MEMBERSHIPS_READ: 'memberships:read',
  /** Add a person to the organization, with a one-time password. */
  MEMBERS_MANAGE: 'members:manage',
  INVITATIONS_READ: 'invitations:read',
  INVITATIONS_MANAGE: 'invitations:manage',
  TEAMS_READ: 'teams:read',
  TEAMS_MANAGE: 'teams:manage',
  SERVICES_READ: 'services:read',
  SERVICES_MANAGE: 'services:manage',
  INCIDENTS_READ: 'incidents:read',
  /**
   * Run an incident's lifecycle: declare it, change it, reassign it, and
   * resolve it. Whoever holds it also oversees every incident's response,
   * and may respond to any.
   */
  INCIDENTS_MANAGE: 'incidents:manage',
  /**
   * Take part in an incident's response: post operational updates. Scoped by
   * IncidentsService to the incidents the caller's team is responsible for —
   * a permission this table grants to a role, and the service narrows to
   * the incident.
   */
  INCIDENTS_RESPOND: 'incidents:respond',
  /**
   * Write an incident analysis: its sections, and publishing it. Scoped by
   * IncidentAnalysesService to the analysis's owner, unless the caller also
   * holds `incidents:manage` — a permission this table grants to a role, and
   * the service narrows to the analysis, as `incidents:respond` is narrowed
   * to the incident. Starting an analysis and choosing its owner are
   * `incidents:manage`; reading one is `incidents:read`.
   */
  INCIDENT_ANALYSES_WRITE: 'incident-analyses:write',
  /**
   * Read one's own notifications, and acknowledge them. Only ever the
   * caller's own: NotificationsService scopes every query to the admitted
   * membership, so this grants nothing about anyone else's. Acknowledging
   * changes nothing another member can see, so it needs no permission of its
   * own.
   */
  NOTIFICATIONS_READ: 'notifications:read',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];
