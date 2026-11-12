import { buildDemoHistory } from './build-demo-history.js';
import type { DemoIncident } from './build-demo-history.js';
import { checkDemoHistory } from './check-demo-history.js';
import {
  ADMIN,
  AWAY,
  JORDAN,
  LEE,
  MANAGER,
  PRIYA,
  REPORTER,
  SAM,
} from './demo-story.js';

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;

/** A Sunday, then each day of the following week. */
const ANCHOR = new Date('2026-09-20T00:00:00.000Z');
const ANCHORS = Array.from(
  { length: 7 },
  (_, i) => new Date(ANCHOR.getTime() + i * DAY),
);

const responsesOf = (incidents: DemoIncident[], persona: string) =>
  incidents.flatMap((incident) =>
    incident.responders
      .filter((response) => response.responder === persona)
      .map((response) => ({ incident, response })),
  );

const averageResponders = (incidents: DemoIncident[]) =>
  incidents.reduce((sum, incident) => sum + incident.responders.length, 0) /
  incidents.length;

describe('buildDemoHistory', () => {
  it.each(ANCHORS)('should break no rule, anchored at %s', (anchor) => {
    expect(checkDemoHistory(buildDemoHistory(anchor), anchor)).toEqual([]);
  });

  it('should give the same history for the same anchor', () => {
    expect(buildDemoHistory(ANCHOR)).toEqual(buildDemoHistory(ANCHOR));
  });

  it('should give the same history a week later for an anchor a week later', () => {
    const later = new Date(ANCHOR.getTime() + WEEK);
    const shifted = (incidents: DemoIncident[], by: number) =>
      JSON.parse(
        JSON.stringify(incidents, (key, value: unknown) =>
          typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)
            ? new Date(new Date(value).getTime() + by).toISOString()
            : value,
        ),
      );

    expect(JSON.parse(JSON.stringify(buildDemoHistory(later)))).toEqual(
      shifted(buildDemoHistory(ANCHOR), WEEK),
    );
  });

  it('should refuse an anchor that is not 00:00 UTC', () => {
    expect(() =>
      buildDemoHistory(new Date('2026-09-20T12:00:00.000Z')),
    ).toThrow();
  });

  it.each(ANCHORS)(
    'should cover about 26 weeks with a believable volume, anchored at %s',
    (anchor) => {
      const incidents = buildDemoHistory(anchor);
      const oldest = incidents[0].createdAt.getTime();

      expect(incidents.length).toBeGreaterThanOrEqual(70);
      expect(incidents.length).toBeLessThanOrEqual(90);
      // The first incident falls in the first of the 26 weeks.
      expect(anchor.getTime() - oldest).toBeGreaterThan(25 * WEEK);
      expect(anchor.getTime() - oldest).toBeLessThanOrEqual(26 * WEEK);
    },
  );

  it('should end with five active incidents, each in its own state', () => {
    const active = buildDemoHistory(ANCHOR).filter(
      (incident) => incident.status !== 'RESOLVED',
    );
    const investigating = (incident: DemoIncident) =>
      incident.responders.filter((r) => r.completedAt === null).length;

    expect(active).toHaveLength(5);
    // Nobody has started: one open to its team, one still waiting for a
    // decision on the Reporter's suggested severity.
    expect(
      active.filter(
        (i) => i.status === 'DECLARED' && i.responseAccess === 'OPEN',
      ),
    ).toHaveLength(1);
    expect(
      active.filter(
        (i) =>
          i.responseAccess === 'PENDING' &&
          !i.severityConfirmed &&
          i.declaredBy === REPORTER,
      ),
    ).toHaveLength(1);
    // Everyone has finished: waiting on the Admin.
    expect(
      active.filter(
        (i) => i.status === 'INVESTIGATING' && investigating(i) === 0,
      ),
    ).toHaveLength(1);
    // One responder finished and one still going.
    expect(
      active.some((i) => i.responders.length === 2 && investigating(i) === 1),
    ).toBe(true);
  });

  it('should have the Reporter raise a share, the Incident Manager decide, and the Admin step in while she is away', () => {
    const incidents = buildDemoHistory(ANCHOR);
    const resolved = incidents.filter((i) => i.status === 'RESOLVED');
    const reported = resolved.filter((i) => i.declaredBy === REPORTER);
    const resolver = (i: DemoIncident) => i.activity.at(-1)!.actor;

    expect(reported.length).toBeGreaterThan(resolved.length * 0.25);
    expect(reported.length).toBeLessThan(resolved.length * 0.55);
    // Each of his confirmed, once, by whoever decided.
    for (const incident of reported) {
      expect(
        incident.activity.filter((e) => e.type === 'SEVERITY_CONFIRMED'),
      ).toHaveLength(1);
    }
    expect(
      resolved.filter((i) => resolver(i) === MANAGER).length,
    ).toBeGreaterThan(resolved.length * 0.8);
    expect(resolved.some((i) => resolver(i) === ADMIN)).toBe(true);
    // Neither works a response.
    expect(responsesOf(incidents, MANAGER)).toEqual([]);
    expect(responsesOf(incidents, REPORTER)).toEqual([]);
  });

  it('should give every member responses, and the Admin none', () => {
    const incidents = buildDemoHistory(ANCHOR);

    for (const persona of [PRIYA, SAM, LEE, JORDAN]) {
      expect(responsesOf(incidents, persona).length).toBeGreaterThanOrEqual(15);
    }

    expect(responsesOf(incidents, ADMIN)).toEqual([]);
  });

  it('should give Sam responses on both his teams, and the most', () => {
    const incidents = buildDemoHistory(ANCHOR);
    const sams = responsesOf(incidents, SAM);
    const teams = new Set(sams.map(({ incident }) => incident.team));

    expect(teams).toEqual(new Set(['Payments', 'Risk']));

    for (const persona of [PRIYA, LEE, JORDAN]) {
      expect(sams.length).toBeGreaterThan(
        responsesOf(incidents, persona).length,
      );
    }
  });

  it('should keep each persona quiet while away', () => {
    const incidents = buildDemoHistory(ANCHOR);
    const historyStart = ANCHOR.getTime() - 26 * WEEK;

    for (const [persona, [from, to]] of Object.entries(AWAY)) {
      const start = historyStart + (from - 1) * WEEK;
      const end = historyStart + to * WEEK;

      expect(
        incidents.flatMap((incident) =>
          incident.activity.filter(
            (event) =>
              event.actor === persona &&
              event.at.getTime() >= start &&
              event.at.getTime() < end &&
              event.type === 'RESPONSE_STARTED',
          ),
        ),
      ).toEqual([]);
    }
  });

  it('should bring more responders to more severe incidents', () => {
    const shared = buildDemoHistory(ANCHOR).filter(
      (incident) => incident.team !== 'Platform',
    );
    const severe = shared.filter((i) => ['SEV1', 'SEV2'].includes(i.severity));
    const minor = shared.filter((i) => ['SEV3', 'SEV4'].includes(i.severity));

    expect(averageResponders(severe)).toBeGreaterThan(
      averageResponders(minor) + 0.4,
    );
  });

  it('should have quiet and busy weeks', () => {
    const incidents = buildDemoHistory(ANCHOR);
    const perWeek = new Map<number, number>();

    for (const incident of incidents) {
      const week = Math.floor(
        (ANCHOR.getTime() - incident.createdAt.getTime()) / WEEK,
      );
      perWeek.set(week, (perWeek.get(week) ?? 0) + 1);
    }

    const counts = Array.from({ length: 26 }, (_, w) => perWeek.get(w) ?? 0);

    expect(Math.min(...counts)).toBeLessThanOrEqual(1);
    expect(Math.max(...counts)).toBeGreaterThanOrEqual(5);
  });

  it('should write a resolution note on every resolved incident', () => {
    const resolved = buildDemoHistory(ANCHOR).filter(
      (incident) => incident.status === 'RESOLVED',
    );

    expect(resolved.every((incident) => incident.resolution)).toBe(true);
    expect(
      resolved.some((incident) =>
        incident.resolution!.startsWith('Same failure mode as INC-'),
      ),
    ).toBe(true);
  });
});

describe('checkDemoHistory', () => {
  const broken = (change: (incidents: DemoIncident[]) => void) => {
    const incidents = structuredClone(buildDemoHistory(ANCHOR));

    change(incidents);

    return checkDemoHistory(incidents, ANCHOR);
  };
  const resolvedWith = (incidents: DemoIncident[], responders: number) =>
    incidents.find(
      (incident) =>
        incident.status === 'RESOLVED' &&
        incident.responders.length === responders,
    )!;

  it('should catch a responder who is not on the team', () => {
    expect(
      broken((incidents) => {
        const incident = incidents.find((i) => i.team === 'Platform')!;
        const start = incident.activity.find(
          (event) => event.type === 'RESPONSE_STARTED',
        )!;

        incident.responders[0].responder = PRIYA;
        start.actor = PRIYA;
      }),
    ).not.toEqual([]);
  });

  it('should catch an update after its author completed', () => {
    expect(
      broken((incidents) => {
        const incident = resolvedWith(incidents, 1);
        const update = incident.activity.find(
          (event) => event.type === 'UPDATE' && event.actor !== ADMIN,
        );
        const resolution = incident.activity.at(-1)!;

        // Just before the resolution, after every completion.
        incident.activity.splice(incident.activity.length - 1, 0, {
          ...(update ?? resolution),
          type: 'UPDATE',
          actor: incident.responders[0].responder,
          at: new Date(resolution.at.getTime() - 1),
        });
      }),
    ).not.toEqual([]);
  });

  it('should catch a resolution while someone is still investigating', () => {
    expect(
      broken((incidents) => {
        const incident = resolvedWith(incidents, 2);
        const who = incident.responders[0];

        who.completedAt = null;
        incident.activity = incident.activity.filter(
          (event) =>
            !(
              event.type === 'RESPONSE_COMPLETED' &&
              event.actor === who.responder
            ),
        );
      }),
    ).not.toEqual([]);
  });

  it('should catch entries out of order', () => {
    expect(
      broken((incidents) => {
        const { activity } = incidents[0];

        [activity[1], activity[2]] = [activity[2], activity[1]];
      }),
    ).not.toEqual([]);
  });

  it('should catch a start without its timeline entry', () => {
    expect(
      broken((incidents) => {
        const incident = resolvedWith(incidents, 2);
        const second = incident.responders[1].responder;

        incident.activity = incident.activity.filter(
          (event) =>
            !(event.type === 'RESPONSE_STARTED' && event.actor === second),
        );
      }),
    ).not.toEqual([]);
  });

  it('should catch anything after the anchor', () => {
    expect(
      checkDemoHistory(
        buildDemoHistory(ANCHOR),
        new Date(ANCHOR.getTime() - DAY),
      ),
    ).not.toEqual([]);
  });
});
