import { Role } from '../generated/prisma/enums.js';
import { Permission } from './permissions.js';
import { hasPermission, ROLE_PERMISSIONS } from './role-permissions.js';

const ROLES = Object.values(Role);
const PERMISSIONS = Object.values(Permission);

/**
 * The whole policy, spelled out literally. A change to who may do what has to
 * change this table as well, which is the point: it cannot happen by accident.
 */
const EXPECTED: Record<Role, Record<Permission, boolean>> = {
  OWNER: {
    'organization:read': true,
    'organization:update': true,
    'memberships:read': true,
  },
  ADMIN: {
    'organization:read': true,
    'organization:update': true,
    'memberships:read': true,
  },
  MEMBER: {
    'organization:read': true,
    'organization:update': false,
    'memberships:read': true,
  },
};

describe('role permissions', () => {
  it('should cover every role in the enum', () => {
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual([...ROLES].sort());
  });

  describe.each(ROLES)('%s', (role) => {
    it.each(PERMISSIONS)(
      'should match the expected policy for %s',
      (permission) => {
        expect(hasPermission(role, permission)).toBe(
          EXPECTED[role][permission],
        );
      },
    );
  });

  it('should not let a member rename the organization', () => {
    expect(hasPermission('MEMBER', Permission.ORGANIZATION_UPDATE)).toBe(false);
  });

  it('should let every role read the organization and its memberships', () => {
    for (const role of ROLES) {
      expect(hasPermission(role, Permission.ORGANIZATION_READ)).toBe(true);
      expect(hasPermission(role, Permission.MEMBERSHIPS_READ)).toBe(true);
    }
  });

  it('should currently order the roles OWNER ⊇ ADMIN ⊇ MEMBER', () => {
    // A checked property of today's table, not a rule the code relies on.
    const holds = (role: Role) => [...ROLE_PERMISSIONS[role]];

    for (const permission of holds('MEMBER')) {
      expect(hasPermission('ADMIN', permission)).toBe(true);
    }

    for (const permission of holds('ADMIN')) {
      expect(hasPermission('OWNER', permission)).toBe(true);
    }
  });

  it('should grant every declared permission to at least one role', () => {
    for (const permission of PERMISSIONS) {
      expect(ROLES.some((role) => hasPermission(role, permission))).toBe(true);
    }
  });

  it('should grant nothing that is not a declared permission', () => {
    for (const role of ROLES) {
      for (const permission of ROLE_PERMISSIONS[role]) {
        expect(PERMISSIONS).toContain(permission);
      }
    }
  });

  it.each([
    'constructor',
    '__proto__',
    'toString',
    'hasOwnProperty',
    '',
    'owner',
    'SUPERADMIN',
  ])('should deny the unknown role %j', (role) => {
    for (const permission of PERMISSIONS) {
      expect(hasPermission(role as Role, permission)).toBe(false);
    }
  });

  it('should deny a permission that is not declared', () => {
    expect(hasPermission('OWNER', 'organization:delete' as Permission)).toBe(
      false,
    );
  });
});
