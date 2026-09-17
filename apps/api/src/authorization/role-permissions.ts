import type { Role } from '../generated/prisma/enums.js';
import { Permission } from './permissions.js';

/**
 * The permissions each membership role holds.
 *
 * Written out in full per role rather than derived from a hierarchy. Today
 * OWNER ⊇ ADMIN ⊇ MEMBER, and a spec asserts exactly that — but as a checked
 * property of this table, not an assumption built into the code, so a later
 * role that does not sit on the ladder is a change here and nowhere else.
 *
 * Keyed by `Role`, so adding an enum value without deciding what it may do is
 * a compile error rather than a role that silently holds nothing.
 */
export const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<Permission>>> =
  {
    OWNER: new Set([
      Permission.ORGANIZATION_READ,
      Permission.ORGANIZATION_UPDATE,
      Permission.MEMBERSHIPS_READ,
    ]),
    ADMIN: new Set([
      Permission.ORGANIZATION_READ,
      Permission.ORGANIZATION_UPDATE,
      Permission.MEMBERSHIPS_READ,
    ]),
    MEMBER: new Set([
      Permission.ORGANIZATION_READ,
      Permission.MEMBERSHIPS_READ,
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
