import {
  incidentRecipients,
  teamMembershipRecipients,
} from './notifications.recipients.js';
import type {
  IncidentCandidates,
  IncidentNotificationType,
} from './notifications.recipients.js';

/**
 * The worked example. Alice is the Admin and acts. The incident was
 * Payments' and is now Platform's.
 *
 *   Ben   Payments and Platform, still investigating
 *   Cara  Payments, completed her response
 *   Dan   Payments, never responded
 *   Eve   Platform
 *   Gus   a second Admin, on no team
 */
const ALICE = 'alice';
const BEN = 'ben';
const CARA = 'cara';
const DAN = 'dan';
const EVE = 'eve';
const GUS = 'gus';

const candidates = (
  overrides: Partial<IncidentCandidates> = {},
): IncidentCandidates => ({
  actorMembershipId: ALICE,
  teamMemberIds: [BEN, EVE],
  responders: [
    { membershipId: BEN, status: 'INVESTIGATING' },
    { membershipId: CARA, status: 'COMPLETED' },
  ],
  adminIds: [ALICE, GUS],
  newAssigneeIds: [],
  declarerIds: [],
  ...overrides,
});

describe('incidentRecipients', () => {
  it('should tell the responsible team of a declaration, and nobody else', () => {
    expect(
      incidentRecipients(
        'INCIDENT_DECLARED',
        candidates({ teamMemberIds: [ALICE, BEN, CARA, DAN], responders: [] }),
      ),
    ).toEqual([BEN, CARA, DAN]);
  });

  it('should tell the new team and responders still investigating of a reassignment', () => {
    // Cara completed; Dan never responded; Gus is on no team.
    expect(incidentRecipients('INCIDENT_REASSIGNED', candidates())).toEqual([
      BEN,
      EVE,
    ]);
  });

  it('should tell the responsible team and responders still investigating of a severity change', () => {
    // A responder left behind by a reassignment is still told.
    expect(
      incidentRecipients(
        'INCIDENT_SEVERITY_CHANGED',
        candidates({ teamMemberIds: [EVE] }),
      ),
    ).toEqual([BEN, EVE]);
  });

  it('should tell the responsible team and everyone who responded of a resolution', () => {
    expect(
      incidentRecipients(
        'INCIDENT_RESOLVED',
        candidates({
          teamMemberIds: [EVE],
          responders: [
            { membershipId: BEN, status: 'COMPLETED' },
            { membershipId: CARA, status: 'COMPLETED' },
          ],
        }),
      ),
    ).toEqual([BEN, CARA, EVE]);
  });

  it('should tell the Admins that an incident is ready to resolve, and nobody else', () => {
    expect(
      incidentRecipients(
        'INCIDENT_READY_TO_RESOLVE',
        candidates({ actorMembershipId: BEN }),
      ),
    ).toEqual([ALICE, GUS]);
  });

  it('should tell the responsible team that it was opened to them, and nobody else', () => {
    expect(
      incidentRecipients(
        'INCIDENT_OPENED_TO_TEAM',
        candidates({ teamMemberIds: [BEN, DAN] }),
      ),
    ).toEqual([BEN, DAN]);
  });

  it('should tell only the people just assigned, whatever their team', () => {
    // Gus is on no team; the team and responders are not told.
    expect(
      incidentRecipients(
        'INCIDENT_ASSIGNED',
        candidates({ newAssigneeIds: [GUS, DAN] }),
      ),
    ).toEqual([DAN, GUS]);
  });

  it.each<IncidentNotificationType>([
    'INCIDENT_DECLARED',
    'INCIDENT_REASSIGNED',
    'INCIDENT_SEVERITY_CHANGED',
    'INCIDENT_RESOLVED',
    'INCIDENT_READY_TO_RESOLVE',
    'INCIDENT_OPENED_TO_TEAM',
    'INCIDENT_ASSIGNED',
    'INCIDENT_SEVERITY_CONFIRMED',
  ])('should never tell the actor of %s, however they qualify', (type) => {
    // Alice is on the team, responding, assigned, an Admin, and declared it.
    const everywhere = candidates({
      teamMemberIds: [ALICE, EVE],
      responders: [{ membershipId: ALICE, status: 'INVESTIGATING' }],
      newAssigneeIds: [ALICE],
      declarerIds: [ALICE],
    });

    expect(incidentRecipients(type, everywhere)).not.toContain(ALICE);
  });

  it('should tell whoever declared it that their suggested severity was confirmed, and nobody else', () => {
    expect(
      incidentRecipients(
        'INCIDENT_SEVERITY_CONFIRMED',
        candidates({ declarerIds: ['rita'] }),
      ),
    ).toEqual(['rita']);
  });

  it.each(['INCIDENT_SEVERITY_CHANGED', 'INCIDENT_RESOLVED'] as const)(
    'should tell whoever declared it of %s, on no team and never responding',
    (type) => {
      expect(
        incidentRecipients(type, candidates({ declarerIds: ['rita'] })),
      ).toContain('rita');
    },
  );

  it.each([
    'INCIDENT_DECLARED',
    'INCIDENT_REASSIGNED',
    'INCIDENT_OPENED_TO_TEAM',
    'INCIDENT_ASSIGNED',
    'INCIDENT_READY_TO_RESOLVE',
  ] as const)('should not tell whoever declared it of %s', (type) => {
    expect(
      incidentRecipients(type, candidates({ declarerIds: ['rita'] })),
    ).not.toContain('rita');
  });

  it('should tell a member who qualifies twice for one entry once', () => {
    // Ben is on the team and investigating.
    const recipients = incidentRecipients('INCIDENT_REASSIGNED', candidates());

    expect(recipients.filter((id) => id === BEN)).toHaveLength(1);
  });

  it('should tell nobody when only the actor would qualify', () => {
    expect(
      incidentRecipients(
        'INCIDENT_READY_TO_RESOLVE',
        candidates({ adminIds: [ALICE] }),
      ),
    ).toEqual([]);
    expect(
      incidentRecipients(
        'INCIDENT_DECLARED',
        candidates({ teamMemberIds: [ALICE] }),
      ),
    ).toEqual([]);
  });
});

describe('teamMembershipRecipients', () => {
  it('should tell only the member placed or removed', () => {
    expect(teamMembershipRecipients(BEN, ALICE)).toEqual([BEN]);
  });

  it('should tell nobody when they did it themselves', () => {
    expect(teamMembershipRecipients(ALICE, ALICE)).toEqual([]);
  });
});
