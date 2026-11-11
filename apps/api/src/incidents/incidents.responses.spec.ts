import { buildActivityCalendar, LEVELS } from './incidents.activity.js';
import { buildOccurrence, occurrenceWindows } from './incidents.occurrence.js';
import {
  toIncidentActivityResponse,
  toIncidentDetailResponse,
  toIncidentOccurrenceResponse,
  toIncidentResponse,
  toIncidentSummaryResponse,
  toMemberActivityResponse,
  toOperationalActivityResponse,
} from './incidents.responses.js';
import {
  buildMemberActivityCalendar,
  MEMBER_LEVELS,
} from './member-activity.js';

const CREATED = new Date('2026-09-18T12:00:00.000Z');
const UPDATED = new Date('2026-09-18T12:30:00.000Z');
const RESOLVED = new Date('2026-09-18T13:00:00.000Z');

describe('incident responses', () => {
  // Carries columns a careless mapper might spread: the organization, the
  // raw foreign keys, the declarer's email and soft-deletion mark.
  const row = {
    id: 'incident-1',
    organizationId: 'org-1',
    number: 42,
    title: 'Card payments failing',
    summary: null,
    serviceId: 'service-1',
    teamId: 'team-1',
    createdById: 'user-1',
    severity: 'SEV1' as const,
    status: 'RESOLVED' as const,
    responseAccess: 'OPEN' as const,
    assignees: [],
    createdAt: CREATED,
    updatedAt: UPDATED,
    resolvedAt: RESOLVED,
    // Selected for a single incident only; a list item never carries it.
    resolution: 'Rolled back the 12:40 deploy.',
    service: {
      id: 'service-1',
      name: 'Payment API',
      slug: 'payment-api',
      criticality: 'CRITICAL' as const,
      archivedAt: null,
      ownerTeamId: 'team-2',
    },
    team: {
      id: 'team-1',
      name: 'Payments',
      slug: 'payments',
      organizationId: 'org-1',
    },
    createdBy: {
      id: 'user-1',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      deletedAt: new Date(),
    },
    // Identity only: never whether it awaits review, nor its service.
    knownIssue: {
      id: 'known-1',
      name: 'Card payments failing at checkout',
      pendingReview: true,
      serviceId: 'service-1',
    },
  };

  it('should emit exactly the declared fields, identity only on embedded records', () => {
    expect(toIncidentResponse(row)).toStrictEqual({
      responseAccess: 'OPEN',
      assignees: [],
      id: 'incident-1',
      number: 42,
      title: 'Card payments failing',
      summary: null,
      severity: 'SEV1',
      status: 'RESOLVED',
      service: {
        id: 'service-1',
        name: 'Payment API',
        slug: 'payment-api',
        criticality: 'CRITICAL',
        archivedAt: null,
      },
      team: { id: 'team-1', name: 'Payments', slug: 'payments' },
      createdBy: { id: 'user-1', name: 'Ada Lovelace' },
      knownIssue: { id: 'known-1', name: 'Card payments failing at checkout' },
      createdAt: '2026-09-18T12:00:00.000Z',
      updatedAt: '2026-09-18T12:30:00.000Z',
      resolvedAt: '2026-09-18T13:00:00.000Z',
    });
  });

  it('should emit null for an unresolved incident', () => {
    expect(
      toIncidentResponse({ ...row, status: 'DECLARED', resolvedAt: null })
        .resolvedAt,
    ).toBeNull();
  });

  it('should add the responders as membership id, name, and response state only', () => {
    // Carries what a careless mapper might spread: the user's email and id.
    const responder = (
      id: string,
      name: string,
      status: 'INVESTIGATING' | 'COMPLETED',
      completedAt: Date | null,
    ) => ({
      id: `responder-${id}`,
      organizationId: 'org-1',
      status,
      startedAt: CREATED,
      completedAt,
      membership: {
        id,
        role: 'MEMBER',
        user: { id: `user-${id}`, name, email: `${id}@example.com` },
      },
    });

    const detail = toIncidentDetailResponse({
      ...row,
      responders: [
        responder('m-1', 'Priya Shah', 'INVESTIGATING', null),
        responder('m-2', 'Sam Okafor', 'COMPLETED', RESOLVED),
      ],
    });

    expect(detail.resolution).toBe('Rolled back the 12:40 deploy.');
    expect(detail.responders).toStrictEqual([
      {
        membershipId: 'm-1',
        name: 'Priya Shah',
        status: 'INVESTIGATING',
        startedAt: CREATED.toISOString(),
        completedAt: null,
      },
      {
        membershipId: 'm-2',
        name: 'Sam Okafor',
        status: 'COMPLETED',
        startedAt: CREATED.toISOString(),
        completedAt: RESOLVED.toISOString(),
      },
    ]);
  });

  it('should emit a timeline entry with its actor as identity only', () => {
    expect(
      toIncidentActivityResponse({
        id: 'activity-1',
        organizationId: 'org-1',
        incidentId: 'incident-1',
        actorId: 'user-1',
        type: 'SEVERITY_CHANGED',
        message: null,
        fromValue: 'SEV3',
        toValue: 'SEV1',
        createdAt: CREATED,
        actor: {
          id: 'user-1',
          name: 'Ada Lovelace',
          email: 'ada@example.com',
          deletedAt: new Date(),
        },
      } as Parameters<typeof toIncidentActivityResponse>[0]),
    ).toStrictEqual({
      id: 'activity-1',
      type: 'SEVERITY_CHANGED',
      message: null,
      fromValue: 'SEV3',
      toValue: 'SEV1',
      actor: { id: 'user-1', name: 'Ada Lovelace' },
      createdAt: CREATED.toISOString(),
    });
  });
  describe('toIncidentSummaryResponse', () => {
    const team = { id: 'team-1', name: 'Payments', slug: 'payments' };
    const service = (
      id: string,
      name: string,
      criticality: 'CRITICAL' | 'LOW',
    ) => ({
      id,
      name,
      slug: name.toLowerCase(),
      criticality,
      archivedAt: null,
      ownerTeam: team,
    });
    const count = (
      serviceId: string,
      severity: 'SEV1' | 'SEV2' | 'SEV3',
      n: number,
    ) => ({
      serviceId,
      severity,
      _count: { _all: n },
    });
    /** One response still under way: the member, and whose incident it is. */
    /** A response under way; one incident per team unless it says. */
    const responding = (
      membershipId: string,
      teamId: string,
      incidentId = `incident-of-${teamId}`,
    ) => ({
      membershipId,
      incidentId,
      incident: { teamId },
    });

    /**
     * Everything but the responders, for the cases that vary only those.
     * Nothing active: who is investigating is counted from its own rows,
     * so the two do not have to be kept consistent here.
     */
    const WINDOW = { from: '2026-06-22', to: '2026-09-19' };
    const bare = {
      active: [],
      services: [],
      statuses: [],
      typical: { rows: [], window: WINDOW },
      declared: [],
      resolved: 0,
      stillOpen: 0,
      resolutionMedianMs: null,
      period: { from: '2026-09-13', to: '2026-09-19' },
      history: { total: 0, items: [] },
    };

    const summary = toIncidentSummaryResponse({
      active: [
        count('ledger', 'SEV2', 1),
        count('search', 'SEV3', 2),
        count('checkout', 'SEV2', 1),
        count('checkout', 'SEV3', 3),
        count('status', 'SEV2', 1),
      ],
      services: [
        service('search', 'Search', 'CRITICAL'),
        service('ledger', 'Ledger', 'LOW'),
        service('checkout', 'Checkout', 'CRITICAL'),
        service('status', 'Status', 'LOW'),
      ],
      responders: [
        responding('ada', 'payments'),
        responding('grace', 'payments'),
        responding('ada', 'risk'),
      ],
      statuses: [
        { status: 'DECLARED', _count: { _all: 3 } },
        { status: 'INVESTIGATING', _count: { _all: 5 } },
      ],
      typical: {
        rows: [
          // Enough resolutions for a median, which is rounded to the ms.
          { severity: 'SEV2', resolved: 7, median_ms: 21_600_000.4 },
          // Too few: counted, and no median.
          { severity: 'SEV3', resolved: 4, median_ms: 3_600_000 },
        ],
        window: WINDOW,
      },
      declared: [{ severity: 'SEV1', _count: { _all: 4 } }],
      resolved: 3,
      stillOpen: 1,
      resolutionMedianMs: 5_400_000,
      period: { from: '2026-09-13', to: '2026-09-19' },
      history: {
        total: 5,
        items: [
          { incident: row, declaredInPeriod: false, resolvedInPeriod: true },
        ],
      },
    });

    it('should count every level, with none as 0', () => {
      expect(summary.current.active).toBe(8);
      expect(summary.current.activeBySeverity).toEqual({
        SEV1: 0,
        SEV2: 3,
        SEV3: 5,
        SEV4: 0,
      });
      expect(summary.period).toMatchObject({
        from: '2026-09-13',
        to: '2026-09-19',
        declared: 4,
        declaredBySeverity: { SEV1: 4, SEV2: 0, SEV3: 0, SEV4: 0 },
        resolved: 3,
        stillOpen: 1,
        resolutionMedianMs: 5_400_000,
      });
      expect(summary.period.history).toEqual({
        total: 5,
        items: [
          {
            incident: toIncidentResponse(row),
            declaredInPeriod: false,
            resolvedInPeriod: true,
          },
        ],
      });
    });

    it('should order affected services by worst severity, then criticality, then name', () => {
      expect(
        summary.current.affectedServices.map(
          ({ id, activeIncidents, worstSeverity }) => [
            id,
            activeIncidents,
            worstSeverity,
          ],
        ),
      ).toEqual([
        ['checkout', 4, 'SEV2'],
        ['ledger', 1, 'SEV2'],
        ['status', 1, 'SEV2'],
        ['search', 2, 'SEV3'],
      ]);
      expect(summary.current.affectedServices[0]).toEqual({
        id: 'checkout',
        name: 'Checkout',
        slug: 'checkout',
        criticality: 'CRITICAL',
        archivedAt: null,
        ownerTeam: team,
        activeIncidents: 4,
        worstSeverity: 'SEV2',
      });
    });

    /**
     * Responders are people and teams, never rows: the fixture holds three
     * responses, but Ada is on two of them and two of the three are the
     * same team's.
     */
    it('should count a member investigating several incidents once', () => {
      expect(summary.current.responders).toEqual({ active: 2, teams: 2 });
    });

    it('should count every member on one incident', () => {
      const one = toIncidentSummaryResponse({
        ...bare,
        responders: [
          responding('ada', 'payments'),
          responding('grace', 'payments'),
          responding('lin', 'payments'),
        ],
      });

      expect(one.current.responders).toEqual({ active: 3, teams: 1 });
    });

    it('should count the active incidents at each active status', () => {
      expect(summary.current.activeByStatus).toEqual({
        DECLARED: 3,
        INVESTIGATING: 5,
      });
      // A resolved row is not an active one, and there is no third count.
      expect(
        toIncidentSummaryResponse({
          ...bare,
          responders: [],
          statuses: [{ status: 'RESOLVED', _count: { _all: 9 } }],
        }).current.activeByStatus,
      ).toEqual({ DECLARED: 0, INVESTIGATING: 0 });
    });

    /**
     * Five investigating, and someone is still on two of them (Ada and Grace
     * share Payments' incident; Ada is also on Risk's): three are ready.
     */
    it('should count investigating incidents no one is still investigating as ready', () => {
      expect(summary.current.readyToResolve).toBe(3);
      expect(
        toIncidentSummaryResponse({ ...bare, responders: [] }).current
          .readyToResolve,
      ).toBe(0);
    });

    it('should give a typical time only where enough were resolved', () => {
      expect(summary.current.typicalResolution).toEqual({
        from: '2026-06-22',
        to: '2026-09-19',
        minimumSample: 5,
        bySeverity: {
          SEV1: { resolved: 0, medianMs: null },
          SEV2: { resolved: 7, medianMs: 21_600_000 },
          SEV3: { resolved: 4, medianMs: null },
          SEV4: { resolved: 0, medianMs: null },
        },
      });
    });

    it('should hold the minimum exactly, and ignore rows naming no severity', () => {
      const typical = toIncidentSummaryResponse({
        ...bare,
        responders: [],
        typical: {
          rows: [
            { severity: 'SEV1', resolved: 5, median_ms: 1_000 },
            { severity: 'SEV4', resolved: 5, median_ms: null },
            { severity: 'SEV9', resolved: 50, median_ms: 1 },
          ],
          window: WINDOW,
        },
      }).current.typicalResolution.bySeverity;

      expect(typical.SEV1).toEqual({ resolved: 5, medianMs: 1_000 });
      expect(typical.SEV4).toEqual({ resolved: 5, medianMs: null });
      expect(Object.keys(typical)).toEqual(['SEV1', 'SEV2', 'SEV3', 'SEV4']);
    });

    it('should report nobody investigating as nought, not as absent', () => {
      expect(
        toIncidentSummaryResponse({ ...bare, responders: [] }).current
          .responders,
      ).toEqual({ active: 0, teams: 0 });
    });
  });
});

describe('operational activity responses', () => {
  // Carries columns a careless mapper might spread: the organization, the
  // raw foreign keys, and prose a calendar has no business emitting.
  const incident = {
    id: 'incident-1',
    organizationId: 'org-1',
    number: 42,
    title: 'Card payments failing',
    summary: 'Declines since 14:02',
    resolution: 'Rolled back the 12:40 deploy.',
    serviceId: 'service-1',
    severity: 'SEV1' as const,
    status: 'RESOLVED' as const,
    service: {
      id: 'service-1',
      name: 'Payment API',
      slug: 'payment-api',
      criticality: 'CRITICAL' as const,
    },
  };

  const period = { from: '2026-09-18', to: '2026-09-19' };

  const activity = toOperationalActivityResponse(
    buildActivityCalendar(
      [
        {
          type: 'DECLARED' as const,
          toValue: 'SEV1',
          createdAt: new Date('2026-09-18T12:00:00.000Z'),
          incident,
        },
        {
          type: 'UPDATE' as const,
          toValue: null,
          createdAt: new Date('2026-09-18T12:30:00.000Z'),
          incident,
        },
      ],
      period,
    ),
    period,
  );

  it('should name the period and the levels a legend reads', () => {
    expect(activity.from).toBe('2026-09-18');
    expect(activity.to).toBe('2026-09-19');
    expect(activity.total).toBe(2);
    expect(activity.activeDays).toBe(1);
    expect(activity.thresholds).toEqual([...LEVELS]);
  });

  it('should emit every day of the period, quiet ones included', () => {
    expect(activity.days.map(({ date }) => date)).toEqual([
      '2026-09-18',
      '2026-09-19',
    ]);
    expect(activity.days[1]).toStrictEqual({
      date: '2026-09-19',
      total: 0,
      level: 0,
      counts: {
        declared: 0,
        responseStarted: 0,
        update: 0,
        responseCompleted: 0,
        resolved: 0,
        changed: 0,
      },
      incidents: [],
      moreIncidents: 0,
    });
  });

  it('should name a day’s incidents by identity alone, never their prose', () => {
    expect(activity.days[0]).toStrictEqual({
      date: '2026-09-18',
      total: 2,
      level: 1,
      counts: {
        declared: 1,
        responseStarted: 0,
        update: 1,
        responseCompleted: 0,
        resolved: 0,
        changed: 0,
      },
      incidents: [
        {
          id: 'incident-1',
          number: 42,
          title: 'Card payments failing',
          severity: 'SEV1',
          status: 'RESOLVED',
          service: { name: 'Payment API', slug: 'payment-api' },
          events: 2,
        },
      ],
      moreIncidents: 0,
    });
  });
});

describe('member activity responses', () => {
  const incident = {
    id: 'incident-1',
    organizationId: 'org-1',
    number: 42,
    title: 'Card payments failing',
    summary: 'Declines since 14:02',
    resolution: 'Rolled back the 12:40 deploy.',
    severity: 'SEV1' as const,
    status: 'RESOLVED' as const,
    service: { id: 'service-1', name: 'Payment API', slug: 'payment-api' },
  };

  const period = { from: '2026-09-18', to: '2026-09-19' };

  const activity = toMemberActivityResponse(
    buildMemberActivityCalendar(
      [
        {
          type: 'RESPONSE_STARTED' as const,
          createdAt: new Date('2026-09-18T12:00:00.000Z'),
          incident,
        },
        {
          type: 'UPDATE' as const,
          createdAt: new Date('2026-09-18T12:30:00.000Z'),
          incident,
        },
        // Theirs, on their own incident, and not an act of responding.
        {
          type: 'DECLARED' as const,
          createdAt: new Date('2026-09-18T11:00:00.000Z'),
          incident,
        },
      ],
      period,
    ),
    period,
  );

  it('should carry a person’s own levels, never the organization’s', () => {
    expect(activity.thresholds).toEqual([...MEMBER_LEVELS]);
    expect(activity.thresholds).not.toEqual([...LEVELS]);
  });

  it('should emit only the three acts of responding', () => {
    expect(activity.total).toBe(2);
    expect(activity.activeDays).toBe(1);
    expect(activity.days[0]).toStrictEqual({
      date: '2026-09-18',
      total: 2,
      level: 2,
      counts: { responseStarted: 1, update: 1, responseCompleted: 0 },
      incidents: [
        {
          id: 'incident-1',
          number: 42,
          title: 'Card payments failing',
          severity: 'SEV1',
          status: 'RESOLVED',
          service: { name: 'Payment API', slug: 'payment-api' },
          events: 2,
        },
      ],
      moreIncidents: 0,
    });
  });

  it('should emit every day of the period, quiet ones included', () => {
    expect(activity.days.map(({ date }) => date)).toEqual([
      '2026-09-18',
      '2026-09-19',
    ]);
    expect(activity.days[1]).toStrictEqual({
      date: '2026-09-19',
      total: 0,
      level: 0,
      counts: { responseStarted: 0, update: 0, responseCompleted: 0 },
      incidents: [],
      moreIncidents: 0,
    });
  });
});

describe('incident occurrence responses', () => {
  const period = { from: '2026-09-20', to: '2026-09-21' };
  const now = new Date('2026-09-21T12:00:00.000Z');

  // Carries columns a careless mapper might spread: the organization, the
  // owning team, and prose an occurrence has no business emitting.
  const service = (id: string, archivedAt: Date | null) => ({
    id,
    organizationId: 'org-1',
    ownerTeamId: 'team-1',
    description: 'Takes card payments.',
    name: id === 'service-1' ? 'Payment API' : 'Legacy Gateway',
    slug: id === 'service-1' ? 'payment-api' : 'legacy-gateway',
    criticality: 'CRITICAL' as const,
    archivedAt,
  });

  const occurrence = toIncidentOccurrenceResponse(
    buildOccurrence({
      period,
      windows: occurrenceWindows(period, now),
      trackedSince: new Date('2026-09-01T08:00:00.000Z'),
      daily: [{ day: '2026-09-20', declared: 3 }],
      previousDeclared: 4,
      services: [
        { service: service('service-1', null), declared: 2 },
        {
          service: service('service-2', new Date('2026-09-10T09:30:00.000Z')),
          declared: 1,
        },
      ],
    }),
  );

  it('should give instants as ISO strings, and days as dates', () => {
    expect(occurrence).toMatchObject({
      from: '2026-09-20',
      to: '2026-09-21',
      asOf: '2026-09-21T12:00:00.000Z',
      trackedFrom: '2026-09-01',
      declared: 3,
      incidentFreeDays: 0,
      completeDays: 1,
      previous: {
        from: '2026-09-18',
        to: '2026-09-19',
        declared: 4,
        comparable: true,
        minimumSample: 5,
        changePercent: null,
      },
    });
    expect(occurrence.days).toEqual([
      {
        date: '2026-09-20',
        declared: 3,
        complete: true,
        tracked: true,
        rollingAverage: 0.43,
      },
      {
        date: '2026-09-21',
        declared: 0,
        complete: false,
        tracked: true,
        rollingAverage: null,
      },
    ]);
  });

  it('should name each service by identity alone, archived ones with when', () => {
    expect(occurrence.services).toEqual({
      top: [
        {
          id: 'service-1',
          name: 'Payment API',
          slug: 'payment-api',
          criticality: 'CRITICAL',
          archivedAt: null,
          declared: 2,
          share: 2 / 3,
        },
        {
          id: 'service-2',
          name: 'Legacy Gateway',
          slug: 'legacy-gateway',
          criticality: 'CRITICAL',
          archivedAt: '2026-09-10T09:30:00.000Z',
          declared: 1,
          share: 1 / 3,
        },
      ],
      others: { services: 0, declared: 0 },
    });
  });
});
