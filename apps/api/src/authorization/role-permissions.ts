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
 * ADMIN. Incident response is everyone's work: a MEMBER holds
 * `incidents:manage`, because the engineer who notices a failure must be able
 * to declare it and move it to resolution without finding an admin first.
 * It remains a distinct permission so a later, narrower role (a read-only
 * stakeholder) is a change to this table alone.
 */
export const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<Permission>>> =
  {
    ADMIN: new Set([
      Permission.ORGANIZATION_READ,
      Permission.ORGANIZATION_UPDATE,
      Permission.MEMBERSHIPS_READ,
      Permission.MEMBERS_MANAGE,
      Permission.INVITATIONS_READ,
      Permission.INVITATIONS_MANAGE,
      Permission.TEAMS_READ,
      Permission.TEAMS_MANAGE,
      Permission.SERVICES_READ,
      Permission.SERVICES_MANAGE,
      Permission.INCIDENTS_READ,
      Permission.INCIDENTS_MANAGE,
    ]),
    MEMBER: new Set([
      Permission.ORGANIZATION_READ,
      Permission.MEMBERSHIPS_READ,
      Permission.TEAMS_READ,
      Permission.SERVICES_READ,
      Permission.INCIDENTS_READ,
      Permission.INCIDENTS_MANAGE,
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
