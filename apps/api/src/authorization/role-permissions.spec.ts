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
    'activity:read': true,
    'memberships:read': true,
    'memberships:read-all': true,
    'members:manage': true,
    'invitations:read': true,
    'invitations:manage': true,
    'teams:read': true,
    'teams:read-all': true,
    'teams:manage': true,
    'services:read': true,
    'services:manage': true,
    'incidents:read': true,
    'incidents:read-all': true,
    'incidents:declare': true,
    'incidents:manage': true,
    'incidents:respond': true,
    'responses:work': false,
    'incident-analyses:write': true,
    'notifications:read': true,
  },
  INCIDENT_MANAGER: {
    'organization:read': true,
    'organization:update': false,
    'activity:read': false,
    'memberships:read': true,
    'memberships:read-all': true,
    'members:manage': false,
    'invitations:read': false,
    'invitations:manage': false,
    'teams:read': true,
    'teams:read-all': true,
    'teams:manage': false,
    'services:read': true,
    'services:manage': false,
    'incidents:read': true,
    'incidents:read-all': true,
    'incidents:declare': true,
    'incidents:manage': true,
    'incidents:respond': true,
    'responses:work': false,
    'incident-analyses:write': true,
    'notifications:read': true,
  },
  REPORTER: {
    'organization:read': true,
    'organization:update': false,
    'activity:read': false,
    'memberships:read': true,
    'memberships:read-all': false,
    'members:manage': false,
    'invitations:read': false,
    'invitations:manage': false,
    'teams:read': true,
    'teams:read-all': false,
    'teams:manage': false,
    'services:read': true,
    'services:manage': false,
    'incidents:read': true,
    'incidents:read-all': false,
    'incidents:declare': true,
    'incidents:manage': false,
    'incidents:respond': true,
    'responses:work': false,
    'incident-analyses:write': false,
    'notifications:read': true,
  },
  RESPONDER: {
    'organization:read': true,
    'organization:update': false,
    'activity:read': false,
    'memberships:read': true,
    'memberships:read-all': false,
    'members:manage': false,
    'invitations:read': false,
    'invitations:manage': false,
    'teams:read': true,
    'teams:read-all': false,
    'teams:manage': false,
    'services:read': true,
    'services:manage': false,
    'incidents:read': true,
    'incidents:read-all': false,
    'incidents:declare': false,
    'incidents:manage': false,
    'incidents:respond': true,
    'responses:work': true,
    'incident-analyses:write': true,
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

  it('should have exactly four roles', () => {
    expect([...ROLES].sort()).toEqual([
      'ADMIN',
      'INCIDENT_MANAGER',
      'REPORTER',
      'RESPONDER',
    ]);
  });

  it('should let only admins set the organization up', () => {
    for (const permission of [
      Permission.ORGANIZATION_UPDATE,
      Permission.MEMBERS_MANAGE,
      Permission.INVITATIONS_READ,
      Permission.INVITATIONS_MANAGE,
      Permission.TEAMS_MANAGE,
      Permission.SERVICES_MANAGE,
    ]) {
      expect(ROLES.filter((role) => hasPermission(role, permission))).toEqual([
        'ADMIN',
      ]);
    }
  });

  it('should let only admins read the activity log', () => {
    expect(
      ROLES.filter((role) => hasPermission(role, Permission.ACTIVITY_READ)),
    ).toEqual(['ADMIN']);
  });

  it('should let admins and incident managers decide on incidents, and nobody else', () => {
    expect(
      ROLES.filter((role) => hasPermission(role, Permission.INCIDENTS_MANAGE)),
    ).toEqual(['ADMIN', 'INCIDENT_MANAGER']);
  });

  it('should let everyone but responders declare', () => {
    expect(
      ROLES.filter((role) => hasPermission(role, Permission.INCIDENTS_DECLARE)),
    ).toEqual(['ADMIN', 'INCIDENT_MANAGER', 'REPORTER']);
  });

  it('should let only responders work a response', () => {
    expect(
      ROLES.filter((role) => hasPermission(role, Permission.RESPONSES_WORK)),
    ).toEqual(['RESPONDER']);
  });

  it('should give admins everything an incident manager holds', () => {
    // A checked property of today's table, not a rule the code relies on.
    for (const permission of ROLE_PERMISSIONS.INCIDENT_MANAGER) {
      expect(hasPermission('ADMIN', permission)).toBe(true);
    }
  });

  it('should let whoever decides on incidents oversee every incident, team and member', () => {
    // Deciding is done on an incident its decider can read, and assigning
    // anyone needs everyone in view.
    for (const role of ROLES) {
      if (hasPermission(role, Permission.INCIDENTS_MANAGE)) {
        expect(hasPermission(role, Permission.INCIDENTS_READ_ALL)).toBe(true);
        expect(hasPermission(role, Permission.TEAMS_READ_ALL)).toBe(true);
        expect(hasPermission(role, Permission.MEMBERSHIPS_READ_ALL)).toBe(true);
      }
    }
  });

  it('should let every role read incidents, teams, services, the organization and its members', () => {
    for (const role of ROLES) {
      expect(hasPermission(role, Permission.INCIDENTS_READ)).toBe(true);
      expect(hasPermission(role, Permission.TEAMS_READ)).toBe(true);
      expect(hasPermission(role, Permission.SERVICES_READ)).toBe(true);
      expect(hasPermission(role, Permission.ORGANIZATION_READ)).toBe(true);
      expect(hasPermission(role, Permission.MEMBERSHIPS_READ)).toBe(true);
    }
  });

  it('should let every role post updates, which the service narrows', () => {
    for (const role of ROLES) {
      expect(hasPermission(role, Permission.INCIDENTS_RESPOND)).toBe(true);
    }
  });

  it('should keep analyses from reporters', () => {
    expect(hasPermission('REPORTER', Permission.INCIDENT_ANALYSES_WRITE)).toBe(
      false,
    );
  });

  it('should let an analysis writer read the incident it analyses', () => {
    for (const role of ROLES) {
      if (hasPermission(role, Permission.INCIDENT_ANALYSES_WRITE)) {
        expect(hasPermission(role, Permission.INCIDENTS_READ)).toBe(true);
      }
    }
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
      permissionsFor('RESPONDER').push(Permission.ORGANIZATION_UPDATE);

      expect(hasPermission('RESPONDER', Permission.ORGANIZATION_UPDATE)).toBe(
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
