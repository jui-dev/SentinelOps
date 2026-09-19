import { classifyAttention } from './incidents.attention.js';
import type { AttentionCaller } from './incidents.attention.js';
import type {
  IncidentResponderStatus,
  IncidentSeverity,
  IncidentStatus,
} from './incidents.contract.js';

/**
 * The demo organization's shape: Payments (Priya, Sam), Platform (Lee), Risk
 * (Sam, Jordan). The Admin is on no team unless a case puts them on one.
 */
const PAYMENTS = 'team-payments';
const PLATFORM = 'team-platform';
const RISK = 'team-risk';

const ON_TEAM: Record<string, string[]> = {
  [PAYMENTS]: ['priya', 'sam'],
  [PLATFORM]: ['lee'],
  [RISK]: ['sam', 'jordan'],
};

const teamsOf = (membershipId: string, extra: string[] = []) =>
  new Map(
    Object.entries(ON_TEAM)
      .filter(
        ([team, members]) =>
          members.includes(membershipId) || extra.includes(team),
      )
      .map(([team, members]) => [
        team,
        new Set([...members, ...(extra.includes(team) ? [membershipId] : [])]),
      ]),
  );

const member = (membershipId: string): AttentionCaller => ({
  membershipId,
  canManage: false,
  canRespond: true,
  teams: teamsOf(membershipId),
});

const admin = (onTeams: string[] = []): AttentionCaller => ({
  membershipId: 'admin',
  canManage: true,
  canRespond: true,
  teams: teamsOf('admin', onTeams),
});

const incident = (
  number: number,
  team: string,
  status: IncidentStatus,
  responders: [string, IncidentResponderStatus][] = [],
  severity: IncidentSeverity = 'SEV2',
) => ({
  number,
  severity,
  status,
  team: { id: team },
  responders: responders.map(([id, responderStatus]) => ({
    status: responderStatus,
    membership: { id },
  })),
});

const numbers = (rows: readonly { number: number }[] | undefined) =>
  rows?.map(({ number }) => number);

describe('operational attention', () => {
  describe('ready to resolve', () => {
    it('should hold an investigated incident once no responder is still investigating', () => {
      const incidents = [
        incident(1, PAYMENTS, 'INVESTIGATING', [
          ['priya', 'COMPLETED'],
          ['sam', 'COMPLETED'],
        ]),
      ];

      expect(
        numbers(classifyAttention(incidents, admin()).manage?.readyToResolve),
      ).toEqual([1]);
    });

    it('should not hold one while any responder is still investigating', () => {
      const incidents = [
        incident(1, PAYMENTS, 'INVESTIGATING', [
          ['priya', 'COMPLETED'],
          ['sam', 'INVESTIGATING'],
        ]),
      ];

      expect(
        classifyAttention(incidents, admin()).manage?.readyToResolve,
      ).toEqual([]);
    });

    it('should not hold a declared incident: nobody has investigated it', () => {
      expect(
        classifyAttention([incident(1, PAYMENTS, 'DECLARED')], admin()).manage
          ?.readyToResolve,
      ).toEqual([]);
    });

    it('should follow the resolution rule after a reassignment, as the API does', () => {
      // Payments completed, then the Admin moved it to Platform: resolving
      // is allowed, and Platform is also told it needs them.
      const incidents = [
        incident(1, PLATFORM, 'INVESTIGATING', [['priya', 'COMPLETED']]),
      ];

      expect(
        numbers(classifyAttention(incidents, admin()).manage?.readyToResolve),
      ).toEqual([1]);
      expect(
        numbers(
          classifyAttention(incidents, member('lee')).respond?.needsYourTeam,
        ),
      ).toEqual([1]);
    });

    it('should be null without incidents:manage', () => {
      const incidents = [
        incident(1, PAYMENTS, 'INVESTIGATING', [['priya', 'COMPLETED']]),
      ];

      expect(classifyAttention(incidents, member('sam')).manage).toBeNull();
    });
  });

  describe('needs your team', () => {
    it("should hold a declared incident for every member of its team, and no one else's", () => {
      const incidents = [incident(1, PAYMENTS, 'DECLARED')];

      for (const id of ['priya', 'sam']) {
        expect(
          numbers(
            classifyAttention(incidents, member(id)).respond?.needsYourTeam,
          ),
        ).toEqual([1]);
      }

      for (const id of ['lee', 'jordan']) {
        expect(
          classifyAttention(incidents, member(id)).respond?.needsYourTeam,
        ).toEqual([]);
      }
    });

    it('should leave every member of the team once one of them has started', () => {
      const incidents = [
        incident(1, PAYMENTS, 'INVESTIGATING', [['priya', 'INVESTIGATING']]),
      ];

      expect(
        classifyAttention(incidents, member('priya')).respond?.needsYourTeam,
      ).toEqual([]);
      expect(
        classifyAttention(incidents, member('sam')).respond?.needsYourTeam,
      ).toEqual([]);
    });

    it("should stay claimed once the team's responders have completed", () => {
      const incidents = [
        incident(1, PAYMENTS, 'INVESTIGATING', [['priya', 'COMPLETED']]),
      ];

      expect(
        classifyAttention(incidents, member('sam')).respond?.needsYourTeam,
      ).toEqual([]);
    });

    it('should come to the new team on a reassignment, even with the old responders still listed', () => {
      // Payments' Priya is still investigating; the incident is Platform's now.
      const incidents = [
        incident(1, PLATFORM, 'INVESTIGATING', [['priya', 'INVESTIGATING']]),
      ];

      expect(
        numbers(
          classifyAttention(incidents, member('lee')).respond?.needsYourTeam,
        ),
      ).toEqual([1]);
      expect(
        classifyAttention(incidents, member('sam')).respond?.needsYourTeam,
      ).toEqual([]);
    });

    it('should count a responder on the new team as the team having started', () => {
      // Sam is on both Payments and Risk; moved to Risk, he has it covered.
      const incidents = [
        incident(1, RISK, 'INVESTIGATING', [['sam', 'COMPLETED']]),
      ];

      expect(
        classifyAttention(incidents, member('jordan')).respond?.needsYourTeam,
      ).toEqual([]);
    });

    it("should hold every one of the caller's teams' incidents", () => {
      const incidents = [
        incident(1, PAYMENTS, 'DECLARED'),
        incident(2, RISK, 'DECLARED'),
        incident(3, PLATFORM, 'DECLARED'),
      ];

      expect(
        numbers(
          classifyAttention(incidents, member('sam')).respond?.needsYourTeam,
        ),
      ).toEqual([1, 2]);
    });

    it('should hold nothing for someone on no team', () => {
      expect(
        classifyAttention([incident(1, PAYMENTS, 'DECLARED')], admin()).respond
          ?.needsYourTeam,
      ).toEqual([]);
    });

    it('should hold the teams an Admin is on, beside what they resolve', () => {
      const incidents = [
        incident(1, PLATFORM, 'DECLARED'),
        incident(2, PAYMENTS, 'INVESTIGATING', [['priya', 'COMPLETED']]),
      ];
      const attention = classifyAttention(incidents, admin([PLATFORM]));

      expect(numbers(attention.respond?.needsYourTeam)).toEqual([1]);
      expect(numbers(attention.manage?.readyToResolve)).toEqual([2]);
    });
  });

  describe('your active responses', () => {
    it("should hold the caller's own investigating responses, and nobody else's", () => {
      const incidents = [
        incident(1, PAYMENTS, 'INVESTIGATING', [
          ['priya', 'INVESTIGATING'],
          ['sam', 'COMPLETED'],
        ]),
      ];

      expect(
        numbers(
          classifyAttention(incidents, member('priya')).respond?.yourResponses,
        ),
      ).toEqual([1]);
      expect(
        classifyAttention(incidents, member('sam')).respond?.yourResponses,
      ).toEqual([]);
    });

    it('should keep a response after the incident moves to another team', () => {
      const incidents = [
        incident(1, PLATFORM, 'INVESTIGATING', [['priya', 'INVESTIGATING']]),
      ];

      expect(
        numbers(
          classifyAttention(incidents, member('priya')).respond?.yourResponses,
        ),
      ).toEqual([1]);
    });

    it('should be null without incidents:respond', () => {
      const reader: AttentionCaller = { ...member('priya'), canRespond: false };

      expect(
        classifyAttention([incident(1, PAYMENTS, 'DECLARED')], reader).respond,
      ).toBeNull();
    });
  });

  it('should ignore resolved incidents in every section', () => {
    const incidents = [
      incident(1, PAYMENTS, 'RESOLVED', [['priya', 'COMPLETED']]),
      incident(2, PLATFORM, 'RESOLVED'),
    ];

    expect(classifyAttention(incidents, admin([PLATFORM]))).toEqual({
      manage: { readyToResolve: [] },
      respond: { needsYourTeam: [], yourResponses: [] },
    });
  });

  it('should order each section most severe first, then by number, without reordering its input', () => {
    const incidents = [
      incident(5, PAYMENTS, 'DECLARED', [], 'SEV3'),
      incident(9, PAYMENTS, 'DECLARED', [], 'SEV1'),
      incident(2, PAYMENTS, 'DECLARED', [], 'SEV3'),
      incident(7, PAYMENTS, 'DECLARED', [], 'SEV4'),
    ];

    expect(
      numbers(
        classifyAttention(incidents, member('priya')).respond?.needsYourTeam,
      ),
    ).toEqual([9, 2, 5, 7]);
    expect(numbers(incidents)).toEqual([5, 9, 2, 7]);
  });
});
