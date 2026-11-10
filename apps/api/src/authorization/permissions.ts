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
  /**
   * Read the organization's members: the list, and one member.
   *
   * Scoped by OrganizationsService to the caller, their teammates — anyone
   * on a team they are on now — and the organization's admins, unless the
   * caller also holds `memberships:read-all`. A member outside the scope is
   * answered 404, exactly as a nonexistent one is.
   */
  MEMBERSHIPS_READ: 'memberships:read',
  /**
   * See every member of the organization. A widening capability, as
   * `teams:read-all` is: no route declares it, and the service consults it
   * to decide the scope of `memberships:read`.
   */
  MEMBERSHIPS_READ_ALL: 'memberships:read-all',
  /** Add a person to the organization, with a one-time password. */
  MEMBERS_MANAGE: 'members:manage',
  INVITATIONS_READ: 'invitations:read',
  INVITATIONS_MANAGE: 'invitations:manage',
  /**
   * Read teams: the list, one team, and who is on it.
   *
   * Scoped by teams.scope.ts to the caller's own teams — the ones they have
   * a TeamMembership row on now — unless the caller also holds
   * `teams:read-all`.
   *
   * Current placement only. An incident the caller responded to, or whose
   * analysis they own, keeps that *incident* readable after a reassignment
   * (see `incidents:read`) but says nothing about the team now responsible
   * for it; nor does a placement they once had. Incident visibility and team
   * visibility are separate questions, and this one is answered by the
   * TeamMembership rows as they stand.
   */
  TEAMS_READ: 'teams:read',
  /**
   * See every team in the organization, whoever is on it.
   *
   * A widening capability, as `incidents:read-all` is for one incident at a
   * time: it widens `teams:read` from the caller's own teams to all of them,
   * TeamsService consults it to decide the scope, and no route declares it.
   * The read routes stay on `teams:read`, which both roles hold — a member
   * is not refused the route, their teams are simply the ones they are on —
   * so a team outside the scope is answered 404, exactly as a nonexistent
   * one is, and its existence stays hidden.
   */
  TEAMS_READ_ALL: 'teams:read-all',
  TEAMS_MANAGE: 'teams:manage',
  SERVICES_READ: 'services:read',
  SERVICES_MANAGE: 'services:manage',
  /**
   * Read incidents: lists, one incident, its timeline, and its analysis.
   * Scoped by incidents.scope.ts to the caller's own incidents — their
   * teams', the ones they responded to, and the ones whose analysis they
   * own — unless the caller also holds `incidents:read-all`.
   *
   * Reaches nothing that counts the organization as a whole: an aggregate
   * has no reader to narrow it by, so it is `incidents:read-all` instead.
   */
  INCIDENTS_READ: 'incidents:read',
  /**
   * Oversee every incident in the organization, in both of the ways that
   * can be asked for.
   *
   * One incident at a time, it widens `incidents:read` from the caller's own
   * incidents to all of them: the read services consult it to decide the
   * scope, and no route declares it for that.
   *
   * All of them at once, it is what the organization-wide aggregates
   * declare — the summary, the activity calendar, occurrence. Those count
   * every incident there is, so there is no scope to narrow them to: either
   * the caller oversees the organization or the figures are not theirs to
   * see. A member without it is refused 403.
   *
   * One person at a time, it is also what reading *another member's*
   * operational history takes — their responses, and their activity
   * calendar. A history indexed by a person rather than by an incident
   * cannot be narrowed to a reader either without saying something it does
   * not mean, so it follows the same rule: the member's own always, anyone
   * else's as oversight. The read services decide that, and no route
   * declares it for it — a member asking for someone else's is answered 404,
   * not 403, so the route is the same one and the membership stays hidden.
   */
  INCIDENTS_READ_ALL: 'incidents:read-all',
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
