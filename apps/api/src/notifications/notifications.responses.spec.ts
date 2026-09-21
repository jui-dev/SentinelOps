import type { NotificationType } from './notifications.contract.js';
import { toNotificationResponse } from './notifications.responses.js';
import type { NotificationRow } from './notifications.responses.js';

const CREATED = new Date('2026-09-18T12:00:00.000Z');
const READ = new Date('2026-09-18T12:05:00.000Z');

const incident = {
  number: 104,
  title: 'Login failures',
  severity: 'SEV1' as const,
  status: 'INVESTIGATING' as const,
  service: { name: 'Authentication', slug: 'authentication' },
};

const incidentRow = (
  type: NotificationType,
  fromValue: string | null,
  toValue: string | null,
): NotificationRow => ({
  id: 'notification-1',
  type,
  createdAt: CREATED,
  readAt: null,
  actor: { id: 'user-1', name: 'Ada Lovelace' },
  activity: { fromValue, toValue, incident },
  team: null,
});

const teamRow = (type: NotificationType): NotificationRow => ({
  id: 'notification-2',
  type,
  createdAt: CREATED,
  readAt: READ,
  actor: { id: 'user-1', name: 'Ada Lovelace' },
  activity: null,
  team: { id: 'team-1', name: 'Payments' },
});

describe('toNotificationResponse', () => {
  it('should carry the incident as it stands, and the change as recorded', () => {
    expect(
      toNotificationResponse(
        incidentRow('INCIDENT_SEVERITY_CHANGED', 'SEV2', 'SEV1'),
      ),
    ).toEqual({
      id: 'notification-1',
      type: 'INCIDENT_SEVERITY_CHANGED',
      createdAt: '2026-09-18T12:00:00.000Z',
      readAt: null,
      actor: { id: 'user-1', name: 'Ada Lovelace' },
      incident: {
        number: 104,
        title: 'Login failures',
        severity: 'SEV1',
        status: 'INVESTIGATING',
        service: { name: 'Authentication', slug: 'authentication' },
      },
      change: { from: 'SEV2', to: 'SEV1' },
      team: null,
    });
  });

  it.each([
    ['INCIDENT_DECLARED', null, 'SEV2', { from: null, to: 'SEV2' }],
    [
      'INCIDENT_REASSIGNED',
      'Payments',
      'Platform',
      { from: 'Payments', to: 'Platform' },
    ],
    ['INCIDENT_SEVERITY_CHANGED', 'SEV3', 'SEV2', { from: 'SEV3', to: 'SEV2' }],
  ] as const)(
    'should report the values %s changed',
    (type, fromValue, toValue, change) => {
      expect(
        toNotificationResponse(incidentRow(type, fromValue, toValue)).change,
      ).toEqual(change);
    },
  );

  it.each([
    // The resolution's entry moves the status to RESOLVED, which the type
    // already says.
    ['INCIDENT_RESOLVED', 'INVESTIGATING', 'RESOLVED'],
    // A response completing carries no values.
    ['INCIDENT_READY_TO_RESOLVE', null, null],
  ] as const)(
    'should report no change for %s, but still the incident',
    (type, fromValue, toValue) => {
      const response = toNotificationResponse(
        incidentRow(type, fromValue, toValue),
      );

      expect(response.change).toBeNull();
      expect(response.incident?.number).toBe(104);
      expect(response.team).toBeNull();
    },
  );

  it.each(['TEAM_MEMBERSHIP_ADDED', 'TEAM_MEMBERSHIP_REMOVED'] as const)(
    'should carry the team, and no incident or change, for %s',
    (type) => {
      expect(toNotificationResponse(teamRow(type))).toEqual({
        id: 'notification-2',
        type,
        createdAt: '2026-09-18T12:00:00.000Z',
        readAt: '2026-09-18T12:05:00.000Z',
        actor: { id: 'user-1', name: 'Ada Lovelace' },
        incident: null,
        change: null,
        team: { id: 'team-1', name: 'Payments' },
      });
    },
  );

  it('should copy only the contract, whatever else the row carries', () => {
    const row = {
      ...incidentRow('INCIDENT_DECLARED', null, 'SEV1'),
      organizationId: 'org-1',
      recipientMembershipId: 'membership-1',
      actor: { id: 'user-1', name: 'Ada', email: 'ada@example.com' },
    };

    const body = JSON.stringify(toNotificationResponse(row));

    expect(body).not.toContain('ada@example.com');
    expect(body).not.toContain('organizationId');
    expect(body).not.toContain('recipientMembershipId');
  });
});
