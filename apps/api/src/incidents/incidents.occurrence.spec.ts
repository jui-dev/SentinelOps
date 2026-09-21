import {
  buildOccurrence,
  OCCURRENCE_MINIMUM,
  OCCURRENCE_TOP_SERVICES,
  occurrenceWindows,
} from './incidents.occurrence.js';
import type { OccurrenceInput } from './incidents.occurrence.js';

/** Thirty days ending Monday 21 September 2026, read at noon that day. */
const period = { from: '2026-08-23', to: '2026-09-21' };
const noon = new Date('2026-09-21T12:00:00.000Z');

interface Service {
  id: string;
  name: string;
}

const service = (id: string, name = id): Service => ({ id, name });

/** An occurrence with nothing in it unless the test says otherwise. */
const build = (
  overrides: Partial<Omit<OccurrenceInput<Service>, 'windows'>> & {
    now?: Date;
  } = {},
) => {
  const { now = noon, ...input } = overrides;
  const at = input.period ?? period;

  return buildOccurrence<Service>({
    period: at,
    windows: occurrenceWindows(at, now),
    trackedSince: new Date('2025-01-01T00:00:00.000Z'),
    daily: [],
    previousDeclared: 0,
    services: [],
    ...input,
  });
};

const day = (occurrence: ReturnType<typeof build>, date: string) => {
  const found = occurrence.days.find((entry) => entry.date === date);

  if (!found) throw new Error(`${date} is not in the period`);

  return found;
};

describe('the windows an occurrence is read over', () => {
  it('should run the period from its first midnight to now', () => {
    const windows = occurrenceWindows(period, noon);

    expect(windows.days).toBe(30);
    expect(windows.asOf).toEqual(noon);
    expect(windows.current).toEqual({
      gte: new Date('2026-08-23T00:00:00.000Z'),
      lt: noon,
    });
  });

  it('should cut the previous period at the same distance, so both cover the same time', () => {
    const { current, previous } = occurrenceWindows(period, noon);

    expect(previous).toEqual({
      from: '2026-07-24',
      to: '2026-08-22',
      gte: new Date('2026-07-24T00:00:00.000Z'),
      lt: new Date('2026-08-22T12:00:00.000Z'),
    });
    expect(previous.lt.getTime() - previous.gte.getTime()).toBe(
      current.lt.getTime() - current.gte.getTime(),
    );
    // Back to back: the previous period ends where the current one starts,
    // less the part of today that has not happened yet.
    expect(previous.gte.getTime() + 30 * 86_400_000).toBe(
      current.gte.getTime(),
    );
  });

  it('should reach six days before the period for the first rolling average', () => {
    expect(occurrenceWindows(period, noon).series).toEqual({
      gte: new Date('2026-08-17T00:00:00.000Z'),
      lt: noon,
    });
  });

  it('should count a period that has ended whole', () => {
    const windows = occurrenceWindows(period, new Date('2026-10-05T08:00:00.000Z'));

    expect(windows.asOf).toEqual(new Date('2026-09-22T00:00:00.000Z'));
    expect(windows.previous.lt).toEqual(new Date('2026-08-23T00:00:00.000Z'));
  });

  it('should count nothing of a period that has not started', () => {
    const windows = occurrenceWindows(period, new Date('2026-08-01T08:00:00.000Z'));

    expect(windows.asOf).toEqual(new Date('2026-08-23T00:00:00.000Z'));
    expect(windows.current.gte).toEqual(windows.current.lt);
  });

  it('should hold exactly the days asked for, across a year and a leap day', () => {
    expect(
      occurrenceWindows({ from: '2023-12-15', to: '2024-03-01' }, noon),
    ).toMatchObject({
      days: 78,
      previous: { from: '2023-09-28', to: '2023-12-14' },
    });
  });
});

describe('declarations day by day', () => {
  it('should hold every day of the period, oldest first, quiet days as zero', () => {
    const occurrence = build({ daily: [{ day: '2026-09-01', declared: 3 }] });

    expect(occurrence.days).toHaveLength(30);
    expect(occurrence.days[0]?.date).toBe('2026-08-23');
    expect(occurrence.days.at(-1)?.date).toBe('2026-09-21');
    expect(day(occurrence, '2026-09-01').declared).toBe(3);
    expect(day(occurrence, '2026-09-02').declared).toBe(0);
  });

  it('should total the period only, not the days read before it', () => {
    const occurrence = build({
      daily: [
        { day: '2026-08-20', declared: 9 },
        { day: '2026-08-23', declared: 2 },
        { day: '2026-09-21', declared: 1 },
      ],
    });

    expect(occurrence.declared).toBe(3);
  });

  it('should count today, but not as complete', () => {
    const occurrence = build({ daily: [{ day: '2026-09-21', declared: 2 }] });
    const today = day(occurrence, '2026-09-21');

    expect(today).toMatchObject({ declared: 2, complete: false });
    expect(day(occurrence, '2026-09-20').complete).toBe(true);
  });

  it('should complete a day at the midnight that ends it', () => {
    const occurrence = build({ now: new Date('2026-09-22T00:00:00.000Z') });

    expect(day(occurrence, '2026-09-21').complete).toBe(true);
  });
});

describe('incident-free days', () => {
  it('should count the complete days nothing was declared on', () => {
    const occurrence = build({
      daily: [
        { day: '2026-08-23', declared: 1 },
        { day: '2026-09-10', declared: 4 },
      ],
    });

    // Twenty-nine complete days, two of them with incidents.
    expect(occurrence.completeDays).toBe(29);
    expect(occurrence.incidentFreeDays).toBe(27);
  });

  it('should not call today incident-free while it is still going', () => {
    const occurrence = build({ now: new Date('2026-09-21T23:59:59.999Z') });

    expect(occurrence.incidentFreeDays).toBe(29);
  });

  it('should not call a day incident-free before there was any history', () => {
    const occurrence = build({
      trackedSince: new Date('2026-09-12T15:00:00.000Z'),
    });

    expect(day(occurrence, '2026-09-11').tracked).toBe(false);
    expect(day(occurrence, '2026-09-12').tracked).toBe(true);
    // 12 to 20 September: nine complete, tracked, quiet days.
    expect(occurrence.completeDays).toBe(9);
    expect(occurrence.incidentFreeDays).toBe(9);
    expect(occurrence.trackedFrom).toBe('2026-09-12');
  });

  it('should track nothing without a date to track from', () => {
    const occurrence = build({ trackedSince: null });

    expect(occurrence.trackedFrom).toBeNull();
    expect(occurrence.days.every((entry) => !entry.tracked)).toBe(true);
    expect(occurrence.incidentFreeDays).toBe(0);
    expect(occurrence.completeDays).toBe(0);
  });
});

describe('the seven-day rolling average', () => {
  it('should average a day with the six before it, reaching before the period', () => {
    const occurrence = build({
      daily: [
        { day: '2026-08-17', declared: 7 },
        { day: '2026-08-20', declared: 3 },
        { day: '2026-08-23', declared: 4 },
      ],
    });

    // 17–23 August: 7 + 3 + 4.
    expect(day(occurrence, '2026-08-23').rollingAverage).toBe(2);
    // 18–24 August: the 17th has left the reach.
    expect(day(occurrence, '2026-08-24').rollingAverage).toBe(1);
  });

  it('should average quiet days as zero', () => {
    const occurrence = build({ daily: [{ day: '2026-09-05', declared: 1 }] });

    expect(day(occurrence, '2026-09-05').rollingAverage).toBe(0.14);
    expect(day(occurrence, '2026-09-11').rollingAverage).toBe(0.14);
    expect(day(occurrence, '2026-09-12').rollingAverage).toBe(0);
  });

  it('should have none for today, which is not over', () => {
    const occurrence = build({ daily: [{ day: '2026-09-21', declared: 5 }] });

    expect(day(occurrence, '2026-09-21').rollingAverage).toBeNull();
    expect(day(occurrence, '2026-09-20').rollingAverage).toBe(0);
  });

  it('should have none until seven tracked days are behind it', () => {
    const occurrence = build({
      trackedSince: new Date('2026-09-01T09:00:00.000Z'),
    });

    expect(day(occurrence, '2026-09-06').rollingAverage).toBeNull();
    expect(day(occurrence, '2026-09-07').rollingAverage).toBe(0);
  });
});

describe('the comparison with the previous period', () => {
  const daily = Array.from({ length: 6 }, (_, index) => ({
    day: `2026-09-0${index + 1}`,
    declared: 1,
  }));

  it('should give the change as a whole percentage', () => {
    const fewer = build({ daily, previousDeclared: 7 });
    const more = build({ daily, previousDeclared: 5 });

    expect(fewer.declared).toBe(6);
    expect(fewer.previous).toMatchObject({
      from: '2026-07-24',
      to: '2026-08-22',
      declared: 7,
      comparable: true,
      minimumSample: OCCURRENCE_MINIMUM,
      changePercent: -14,
    });
    expect(more.previous.changePercent).toBe(20);
  });

  it('should call the same count no change, without a sign', () => {
    expect(
      Object.is(build({ daily, previousDeclared: 6 }).previous.changePercent, 0),
    ).toBe(true);
  });

  it('should give no percentage from nought', () => {
    const occurrence = build({ daily, previousDeclared: 0 });

    expect(occurrence.previous).toMatchObject({
      declared: 0,
      comparable: true,
      changePercent: null,
    });
  });

  it(`should give no percentage from fewer than ${OCCURRENCE_MINIMUM}, only the counts`, () => {
    const below = build({ daily, previousDeclared: OCCURRENCE_MINIMUM - 1 });

    expect(below.previous).toMatchObject({
      declared: OCCURRENCE_MINIMUM - 1,
      changePercent: null,
    });
    expect(
      build({ daily, previousDeclared: OCCURRENCE_MINIMUM }).previous
        .changePercent,
    ).not.toBeNull();
  });

  it('should not compare against a period that was not wholly tracked', () => {
    const partly = build({
      daily,
      previousDeclared: 8,
      trackedSince: new Date('2026-07-25T00:00:00.000Z'),
    });
    const wholly = build({
      daily,
      previousDeclared: 8,
      trackedSince: new Date('2026-07-24T23:00:00.000Z'),
    });

    expect(partly.previous).toMatchObject({
      comparable: false,
      changePercent: null,
    });
    expect(wholly.previous).toMatchObject({ comparable: true, changePercent: -25 });
  });
});

describe('the services incidents were declared against', () => {
  const counts = (
    ...rows: [string, number][]
  ): { service: Service; declared: number }[] =>
    rows.map(([name, declared]) => ({
      service: service(name.toLowerCase(), name),
      declared,
    }));

  it('should rank the busiest first, with each share of the period', () => {
    const occurrence = build({
      daily: [{ day: '2026-09-01', declared: 10 }],
      services: counts(['Search', 2], ['Payment API', 5], ['Authentication', 3]),
    });

    expect(occurrence.services.top).toEqual([
      { id: 'payment api', name: 'Payment API', declared: 5, share: 0.5 },
      { id: 'authentication', name: 'Authentication', declared: 3, share: 0.3 },
      { id: 'search', name: 'Search', declared: 2, share: 0.2 },
    ]);
    expect(occurrence.services.others).toEqual({ services: 0, declared: 0 });
  });

  it('should break a tie by name, then by id', () => {
    const occurrence = build({
      daily: [{ day: '2026-09-01', declared: 6 }],
      services: [
        { service: service('b', 'Search'), declared: 2 },
        { service: service('z', 'Checkout'), declared: 2 },
        { service: service('a', 'Search'), declared: 2 },
      ],
    });

    expect(occurrence.services.top.map(({ id }) => id)).toEqual(['z', 'a', 'b']);
  });

  it(`should name ${OCCURRENCE_TOP_SERVICES} and count the rest, losing nothing`, () => {
    const occurrence = build({
      daily: [{ day: '2026-09-01', declared: 21 }],
      services: counts(
        ['A', 6],
        ['B', 5],
        ['C', 4],
        ['D', 2],
        ['E', 1],
        ['F', 1],
        ['G', 2],
      ),
    });

    expect(occurrence.services.top.map(({ name }) => name)).toEqual([
      'A',
      'B',
      'C',
      'D',
      'G',
    ]);
    // D and G tie, and are named in name order; E and F, tied behind them,
    // fall past the fifth place and are counted instead.
    expect(occurrence.services.others).toEqual({ services: 2, declared: 2 });

    const named = occurrence.services.top.reduce(
      (sum, row) => sum + row.declared,
      0,
    );

    expect(named + occurrence.services.others.declared).toBe(
      occurrence.declared,
    );
  });

  it('should give shares that add up to the whole period across every service', () => {
    const occurrence = build({
      daily: [{ day: '2026-09-01', declared: 7 }],
      services: counts(['A', 3], ['B', 2], ['C', 1], ['D', 1]),
    });

    expect(
      occurrence.services.top.reduce((sum, row) => sum + row.share, 0),
    ).toBeCloseTo(1);
  });

  it('should carry a service through as it was given, archived or not', () => {
    const archived = {
      id: 'legacy',
      name: 'Legacy Gateway',
      archivedAt: new Date('2026-09-10T00:00:00.000Z'),
    };
    const occurrence = buildOccurrence({
      period,
      windows: occurrenceWindows(period, noon),
      trackedSince: new Date('2025-01-01T00:00:00.000Z'),
      daily: [{ day: '2026-09-01', declared: 1 }],
      previousDeclared: 0,
      services: [{ service: archived, declared: 1 }],
    });

    expect(occurrence.services.top).toEqual([
      { ...archived, declared: 1, share: 1 },
    ]);
  });

  it('should name no service in a period with no incidents', () => {
    const occurrence = build({ services: counts(['A', 0]) });

    expect(occurrence.declared).toBe(0);
    expect(occurrence.services.top).toEqual([]);
    expect(occurrence.services.others).toEqual({ services: 0, declared: 0 });
  });
});
