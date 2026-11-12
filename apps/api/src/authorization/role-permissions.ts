import type { Role } from '../generated/prisma/enums.js';
import { Permission } from './permissions.js';

/**
 * The permissions each membership role holds.
 *
 * Written out in full per role rather than derived from a hierarchy. ADMIN
 * holds everything INCIDENT_MANAGER does, and a spec asserts exactly that —
 * but as a checked property of this table, not an assumption built into the
 * code. The roles do not form a ladder: only RESPONDER works a response.
 *
 * Keyed by `Role`, so adding an enum value without deciding what it may do is
 * a compile error rather than a role that silently holds nothing.
 *
 * One job per role, in the order an incident needs them:
 *
 *   REPORTER          raises incidents (`incidents:declare`), sees the ones
 *                     they declared, and posts updates on them.
 *   INCIDENT_MANAGER  decides on incidents (`incidents:manage`): severity,
 *                     who may respond, the responsible team, resolution, and
 *                     starting the analysis. Oversees every incident and
 *                     every team, and sees every member, so they can assign
 *                     anyone. Declares too.
 *   RESPONDER         works the response (`responses:work`): starts and
 *                     completes their own, on the incidents their teams are
 *                     responsible for or they are assigned to.
 *   ADMIN             sets the organization up — members, roles, teams,
 *                     services, invitations, settings — reads its
 *                     activity log (`activity:read`), and can do
 *                     everything an Incident Manager does. Does not work a
 *                     response.
 *
 * Reading is every role's, scoped by the read services unless the caller
 * also holds the matching `:read-all`: `incidents:read` by incidents.scope.ts
 * (their teams', assigned, responded to, analysis owned, or declared),
 * `teams:read` by teams.scope.ts (current placement only), and
 * `memberships:read` by OrganizationsService (teammates, and whoever decides).
 *
 * `incidents:read-all` is also what the organization-wide aggregates require
 * — the summary, the activity calendar, occurrence. A figure counted across
 * every incident cannot be narrowed to a reader, so a role holding only
 * `incidents:read` does not see the organization's totals.
 *
 * Writing an incident analysis (`incident-analyses:write`) is scoped by
 * IncidentAnalysesService to the analysis's owner, unless the caller also
 * holds `incidents:manage`. A Reporter does not write analyses.
 */
export const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<Permission>>> =
  {
    ADMIN: new Set([
      Permission.ORGANIZATION_READ,
      Permission.ORGANIZATION_UPDATE,
      Permission.ACTIVITY_READ,
      Permission.MEMBERSHIPS_READ,
      Permission.MEMBERSHIPS_READ_ALL,
      Permission.MEMBERS_MANAGE,
      Permission.INVITATIONS_READ,
      Permission.INVITATIONS_MANAGE,
      Permission.TEAMS_READ,
      Permission.TEAMS_READ_ALL,
      Permission.TEAMS_MANAGE,
      Permission.SERVICES_READ,
      Permission.SERVICES_MANAGE,
      Permission.INCIDENTS_READ,
      Permission.INCIDENTS_READ_ALL,
      Permission.INCIDENTS_DECLARE,
      Permission.INCIDENTS_MANAGE,
      Permission.INCIDENTS_RESPOND,
      Permission.INCIDENT_ANALYSES_WRITE,
      Permission.NOTIFICATIONS_READ,
    ]),
    INCIDENT_MANAGER: new Set([
      Permission.ORGANIZATION_READ,
      Permission.MEMBERSHIPS_READ,
      Permission.MEMBERSHIPS_READ_ALL,
      Permission.TEAMS_READ,
      Permission.TEAMS_READ_ALL,
      Permission.SERVICES_READ,
      Permission.INCIDENTS_READ,
      Permission.INCIDENTS_READ_ALL,
      Permission.INCIDENTS_DECLARE,
      Permission.INCIDENTS_MANAGE,
      Permission.INCIDENTS_RESPOND,
      Permission.INCIDENT_ANALYSES_WRITE,
      Permission.NOTIFICATIONS_READ,
    ]),
    REPORTER: new Set([
      Permission.ORGANIZATION_READ,
      Permission.MEMBERSHIPS_READ,
      Permission.TEAMS_READ,
      Permission.SERVICES_READ,
      Permission.INCIDENTS_READ,
      Permission.INCIDENTS_DECLARE,
      Permission.INCIDENTS_RESPOND,
      Permission.NOTIFICATIONS_READ,
    ]),
    RESPONDER: new Set([
      Permission.ORGANIZATION_READ,
      Permission.MEMBERSHIPS_READ,
      Permission.TEAMS_READ,
      Permission.SERVICES_READ,
      Permission.INCIDENTS_READ,
      Permission.INCIDENTS_RESPOND,
      Permission.RESPONSES_WORK,
      Permission.INCIDENT_ANALYSES_WRITE,
      Permission.NOTIFICATIONS_READ,
    ]),
  };

/**
 * Whether `role` holds `permission`.
 *
 * Denies anything it does not recognise. `Object.hasOwn` before the lookup, so
 * a value such as `constructor` or `__proto__` — which a plain index would
 * resolve through the prototype — is simply not a role.
 */
export const hasPermission = (role: Role, permission: Permission): boolean =>
  Object.hasOwn(ROLE_PERMISSIONS, role) &&
  ROLE_PERMISSIONS[role].has(permission);

/**
 * Every permission `role` holds, sorted, for a client to decide what to offer.
 *
 * Read from the same table the guard enforces, so what a client is told and
 * what the API allows cannot diverge. Telling a client is advice, not
 * authority: every route still checks. An unrecognised role holds nothing, as
 * in `hasPermission`.
 */
export const permissionsFor = (role: Role): Permission[] =>
  Object.hasOwn(ROLE_PERMISSIONS, role)
    ? [...ROLE_PERMISSIONS[role]].sort()
    : [];

/**
 * Every role that holds `permission`, for finding who holds it — the
 * Admins an incident ready to resolve is reported to — without spelling a
 * role name. Read from the same table the guard enforces.
 */
export const rolesHolding = (permission: Permission): Role[] =>
  (Object.keys(ROLE_PERMISSIONS) as Role[]).filter((role) =>
    ROLE_PERMISSIONS[role].has(permission),
  );
