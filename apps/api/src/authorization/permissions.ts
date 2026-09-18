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
  INVITATIONS_READ: 'invitations:read',
  INVITATIONS_MANAGE: 'invitations:manage',
  TEAMS_READ: 'teams:read',
  TEAMS_MANAGE: 'teams:manage',
  SERVICES_READ: 'services:read',
  SERVICES_MANAGE: 'services:manage',
  INCIDENTS_READ: 'incidents:read',
  /** Declare, change, reassign, and resolve incidents. */
  INCIDENTS_MANAGE: 'incidents:manage',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];
