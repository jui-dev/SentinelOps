import { Role } from '../generated/prisma/enums.js';
import { Permission } from './permissions.js';
import {
  hasPermission,
  permissionsFor,
  ROLE_PERMISSIONS,
} from './role-permissions.js';

const ROLES = Object.values(Role);
const PERMISSIONS = Object.values(Permission);

/**
 * The whole policy, spelled out literally. A change to who may do what has to
 * change this table as well, which is the point: it cannot happen by accident.
 */
const EXPECTED: Record<Role, Record<Permission, boolean>> = {
  ADMIN: {
    'organization:read': true,
    'organization:update': true,
    'memberships:read': true,
    'members:manage': true,
    'invitations:read': true,
    'invitations:manage': true,
    'teams:read': true,
    'teams:manage': true,
    'services:read': true,
    'services:manage': true,
    'incidents:read': true,
    'incidents:manage': true,
    'incidents:respond': true,
    'notifications:read': true,
  },
  MEMBER: {
    'organization:read': true,
    'organization:update': false,
    'memberships:read': true,
    'members:manage': false,
    'invitations:read': false,
    'invitations:manage': false,
    'teams:read': true,
    'teams:manage': false,
    'services:read': true,
    'services:manage': false,
    'incidents:read': true,
    'incidents:manage': false,
    'incidents:respond': true,
    'notifications:read': true,
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

  it('should not let a member add people to the organization', () => {
    expect(hasPermission('MEMBER', Permission.MEMBERS_MANAGE)).toBe(false);
    expect(hasPermission('ADMIN', Permission.MEMBERS_MANAGE)).toBe(true);
  });

  it('should not let a member see or manage invitations', () => {
    // Open invitations name people who are not members yet.
    expect(hasPermission('MEMBER', Permission.INVITATIONS_READ)).toBe(false);
    expect(hasPermission('MEMBER', Permission.INVITATIONS_MANAGE)).toBe(false);
  });

  it('should let every role read teams, but only admins manage them', () => {
    for (const role of ROLES) {
      expect(hasPermission(role, Permission.TEAMS_READ)).toBe(true);
    }

    expect(hasPermission('MEMBER', Permission.TEAMS_MANAGE)).toBe(false);
  });

  it('should let every role read services, but only admins manage them', () => {
    // Owning a service grants the owning team nothing: this is the whole rule.
    for (const role of ROLES) {
      expect(hasPermission(role, Permission.SERVICES_READ)).toBe(true);
    }

    expect(hasPermission('MEMBER', Permission.SERVICES_MANAGE)).toBe(false);
  });

  it('should let every role read and respond to incidents', () => {
    for (const role of ROLES) {
      expect(hasPermission(role, Permission.INCIDENTS_READ)).toBe(true);
      expect(hasPermission(role, Permission.INCIDENTS_RESPOND)).toBe(true);
    }
  });

  it("should let only admins run an incident's lifecycle", () => {
    // Declaring, changing, assigning people, and resolving.
    expect(hasPermission('ADMIN', Permission.INCIDENTS_MANAGE)).toBe(true);
    expect(hasPermission('MEMBER', Permission.INCIDENTS_MANAGE)).toBe(false);
  });

  it('should let every role read and acknowledge its own notifications', () => {
    for (const role of ROLES) {
      expect(hasPermission(role, Permission.NOTIFICATIONS_READ)).toBe(true);
    }
  });

  it('should let a notification reveal only what its reader may already read', () => {
    // A notification embeds an incident's title and state and a team's
    // name. A role that could read notifications but not incidents or teams
    // would read them through its inbox.
    for (const role of ROLES) {
      if (hasPermission(role, Permission.NOTIFICATIONS_READ)) {
        expect(hasPermission(role, Permission.INCIDENTS_READ)).toBe(true);
        expect(hasPermission(role, Permission.TEAMS_READ)).toBe(true);
      }
    }
  });

  it('should let every role read the organization and its memberships', () => {
    for (const role of ROLES) {
      expect(hasPermission(role, Permission.ORGANIZATION_READ)).toBe(true);
      expect(hasPermission(role, Permission.MEMBERSHIPS_READ)).toBe(true);
    }
  });

  it('should have exactly two roles, ADMIN and MEMBER', () => {
    expect([...ROLES].sort()).toEqual(['ADMIN', 'MEMBER']);
  });

  it('should currently order the roles ADMIN ⊇ MEMBER', () => {
    // A checked property of today's table, not a rule the code relies on.
    for (const permission of ROLE_PERMISSIONS.MEMBER) {
      expect(hasPermission('ADMIN', permission)).toBe(true);
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
    'OWNER',
    'owner',
    'SUPERADMIN',
  ])('should deny the unknown role %j', (role) => {
    for (const permission of PERMISSIONS) {
      expect(hasPermission(role as Role, permission)).toBe(false);
    }
  });

  it('should deny a permission that is not declared', () => {
    expect(hasPermission('ADMIN', 'organization:delete' as Permission)).toBe(
      false,
    );
  });

  describe('permissionsFor', () => {
    it.each(ROLES)('should list exactly what %s holds, sorted', (role) => {
      const expected = PERMISSIONS.filter(
        (permission) => EXPECTED[role][permission],
      ).sort();

      expect(permissionsFor(role)).toEqual(expected);
    });

    it('should agree with hasPermission for every role and permission', () => {
      for (const role of ROLES) {
        for (const permission of PERMISSIONS) {
          expect(permissionsFor(role).includes(permission)).toBe(
            hasPermission(role, permission),
          );
        }
      }
    });

    it('should return a copy the caller cannot use to change the policy', () => {
      permissionsFor('MEMBER').push(Permission.ORGANIZATION_UPDATE);

      expect(hasPermission('MEMBER', Permission.ORGANIZATION_UPDATE)).toBe(
        false,
      );
    });

    it.each(['constructor', '__proto__', 'OWNER', 'owner', ''])(
      'should list nothing for the unknown role %j',
      (role) => {
        expect(permissionsFor(role as Role)).toEqual([]);
      },
    );
  });
});
