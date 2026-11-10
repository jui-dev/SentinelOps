import type { Role } from '../generated/prisma/enums.js';
import { Permission } from './permissions.js';

/**
 * The permissions each membership role holds.
 *
 * Written out in full per role rather than derived from a hierarchy. Today
 * ADMIN ⊇ MEMBER, and a spec asserts exactly that — but as a checked property
 * of this table, not an assumption built into the code, so a later role that
 * does not sit on the ladder is a change here and nowhere else.
 *
 * Keyed by `Role`, so adding an enum value without deciding what it may do is
 * a compile error rather than a role that silently holds nothing.
 *
 * Configuration — members, teams, services, invitations — is governed by
 * ADMIN. Reading teams (`teams:read`) is every role's, scoped by
 * teams.scope.ts to the teams the caller is on now unless they also hold
 * `teams:read-all`, which only ADMIN does: the Admin sees the organization's
 * teams, a MEMBER sees the ones they belong to. That scope is current
 * placement only — responding to an incident, or owning its analysis, does
 * not make the team now responsible for it visible, and neither does a
 * placement the member used to have.
 *
 * So is an incident's lifecycle (`incidents:manage`): declaring it,
 * changing its status, severity, or responsible team, and resolving it.
 * Taking part in the response (`incidents:respond`) is every role's work —
 * posting operational updates — but a MEMBER's is scoped to the incidents
 * their team is responsible for. That scope depends on the incident, so it
 * is IncidentsService's check, not this table's.
 *
 * Writing an incident analysis (`incident-analyses:write`) is every role's
 * too, scoped by IncidentAnalysesService to the analysis's owner unless the
 * caller also runs incidents' lifecycles. Starting one and choosing its owner
 * are part of that lifecycle, `incidents:manage`.
 *
 * Reading incidents (`incidents:read`) is every role's, scoped by
 * incidents.scope.ts to the caller's own incidents unless they also hold
 * `incidents:read-all`, which only ADMIN does: the Admin oversees the whole
 * organization, a MEMBER sees the incidents they are responsible for or
 * took part in.
 *
 * That same `incidents:read-all` is what the organization-wide aggregates
 * require — the summary, the activity calendar, occurrence. A figure counted
 * across every incident cannot be narrowed to a reader, so a MEMBER holding
 * `incidents:read` does not thereby see the organization's totals; giving
 * them a reading of their own is their own surface's work, not this table's.
 *
 * Declaring is ADMIN-only as the current rule, not a settled one: letting a
 * MEMBER declare against services their own teams own may be reconsidered.
 */
export const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<Permission>>> =
  {
    ADMIN: new Set([
      Permission.ORGANIZATION_READ,
      Permission.ORGANIZATION_UPDATE,
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
      Permission.INCIDENTS_MANAGE,
      Permission.INCIDENTS_RESPOND,
      Permission.INCIDENT_ANALYSES_WRITE,
      Permission.NOTIFICATIONS_READ,
    ]),
    MEMBER: new Set([
      Permission.ORGANIZATION_READ,
      Permission.MEMBERSHIPS_READ,
      Permission.TEAMS_READ,
      Permission.SERVICES_READ,
      Permission.INCIDENTS_READ,
      Permission.INCIDENTS_RESPOND,
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
