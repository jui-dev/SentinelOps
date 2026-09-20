import {
  buildActivityCalendar,
  categoryOf,
  LEVELS,
} from './incidents.activity.js';
import type { ActivityRow } from './incidents.activity.js';
import { CALENDAR_INCIDENT_LIMIT, levelOf } from './incidents.calendar.js';
import type { IncidentActivityType, IncidentSeverity } from './incidents.contract.js';

const incident = (
  number: number,
  severity: IncidentSeverity = 'SEV3',
) => ({ id: `i${number}`, number, severity });

const entry = (
  type: IncidentActivityType,
  at: string,
  {
    number = 1,
    severity = 'SEV3' as IncidentSeverity,
    toValue = null as string | null,
  } = {},
): ActivityRow<ReturnType<typeof incident>> => ({
  type,
  toValue,
  createdAt: new Date(at),
  incident: incident(number, severity),
});

const period = { from: '2026-09-14', to: '2026-09-20' };

/** A day's totals, keyed by date, for the days that had any. */
const busyDays = (rows: ActivityRow<ReturnType<typeof incident>>[]) =>
  Object.fromEntries(
    buildActivityCalendar(rows, period)
      .days.filter((day) => day.total > 0)
      .map((day) => [day.date, day.total]),
  );

describe('what counts as operational activity', () => {
  it.each([
    ['DECLARED', 'declared'],
    ['RESPONSE_STARTED', 'responseStarted'],
    ['UPDATE', 'update'],
    ['RESPONSE_COMPLETED', 'responseCompleted'],
    ['SEVERITY_CHANGED', 'changed'],
    ['TEAM_CHANGED', 'changed'],
  ])('should count %s as %s', (type, category) => {
    expect(categoryOf({ type: type as IncidentActivityType, toValue: null })).toBe(
      category,
    );
  });

  it('should count a resolution', () => {
    expect(
      categoryOf({ type: 'STATUS_CHANGED', toValue: 'RESOLVED' }),
    ).toBe('resolved');
  });

  /**
   * The server writes it a millisecond after the RESPONSE_STARTED that
   * caused it, with the same actor: one act, not two.
   */
  it('should not count the status change a response start causes', () => {
    expect(
      categoryOf({ type: 'STATUS_CHANGED', toValue: 'INVESTIGATING' }),
    ).toBeUndefined();
  });

  it('should not count a status change to a retired status', () => {
    expect(
      categoryOf({ type: 'STATUS_CHANGED', toValue: 'MONITORING' }),
    ).toBeUndefined();
  });
});

describe('activity levels', () => {
  it.each([
    [0, 0],
    [1, 1],
    [2, 1],
    [3, 2],
    [5, 2],
    [6, 3],
    [10, 3],
    [11, 4],
    [40, 4],
  ])(
    'should put %i events of a whole organization at level %i',
    (total, level) => {
      expect(levelOf(total, LEVELS)).toBe(level);
    },
  );
});

describe('the activity calendar', () => {
  it('should hold every day of the period, quiet ones included', () => {
    const calendar = buildActivityCalendar(
      [entry('DECLARED', '2026-09-16T09:00:00Z')],
      period,
    );

    expect(calendar.days.map((day) => day.date)).toEqual([
      '2026-09-14',
      '2026-09-15',
      '2026-09-16',
      '2026-09-17',
      '2026-09-18',
      '2026-09-19',
      '2026-09-20',
    ]);
    expect(calendar.total).toBe(1);
    expect(calendar.activeDays).toBe(1);
    expect(calendar.days[0]).toMatchObject({
      total: 0,
      level: 0,
      incidents: [],
      moreIncidents: 0,
      counts: {
        declared: 0,
        responseStarted: 0,
        update: 0,
        responseCompleted: 0,
        resolved: 0,
        changed: 0,
      },
    });
  });

  it('should break a day down by category', () => {
    const calendar = buildActivityCalendar(
      [
        entry('DECLARED', '2026-09-16T09:00:00Z'),
        entry('RESPONSE_STARTED', '2026-09-16T09:05:00Z'),
        entry('STATUS_CHANGED', '2026-09-16T09:05:00.001Z', {
          toValue: 'INVESTIGATING',
        }),
        entry('UPDATE', '2026-09-16T10:00:00Z'),
        entry('UPDATE', '2026-09-16T11:00:00Z'),
        entry('SEVERITY_CHANGED', '2026-09-16T11:30:00Z'),
        entry('RESPONSE_COMPLETED', '2026-09-16T12:00:00Z'),
        entry('STATUS_CHANGED', '2026-09-16T12:30:00Z', { toValue: 'RESOLVED' }),
      ],
      period,
    );

    const day = calendar.days.find(({ date }) => date === '2026-09-16');

    expect(day?.counts).toEqual({
      declared: 1,
      responseStarted: 1,
      update: 2,
      responseCompleted: 1,
      resolved: 1,
      changed: 1,
    });
    // Eight entries, seven of them events: the pickup is one act.
    expect(day?.total).toBe(7);
    expect(day?.level).toBe(3);
    expect(calendar.total).toBe(7);
  });

  it('should file an entry under the UTC day it was recorded on', () => {
    expect(
      busyDays([
        // Late on the 15th and a minute into the 16th, UTC.
        entry('UPDATE', '2026-09-15T23:59:59.999Z'),
        entry('UPDATE', '2026-09-16T00:00:00.000Z'),
      ]),
    ).toEqual({ '2026-09-15': 1, '2026-09-16': 1 });
  });

  it('should ignore entries outside the period', () => {
    expect(
      busyDays([
        entry('UPDATE', '2026-09-13T23:00:00Z'),
        entry('UPDATE', '2026-09-16T09:00:00Z'),
        entry('UPDATE', '2026-09-21T01:00:00Z'),
      ]),
    ).toEqual({ '2026-09-16': 1 });
  });

  it('should name a day’s incidents once, with how much happened to each', () => {
    const calendar = buildActivityCalendar(
      [
        entry('UPDATE', '2026-09-16T09:00:00Z', { number: 7 }),
        entry('UPDATE', '2026-09-16T10:00:00Z', { number: 7 }),
        entry('UPDATE', '2026-09-16T11:00:00Z', { number: 7 }),
        entry('DECLARED', '2026-09-16T12:00:00Z', { number: 9 }),
        // Another day: the same incident, counted there instead.
        entry('UPDATE', '2026-09-17T09:00:00Z', { number: 7 }),
      ],
      period,
    );

    const day = calendar.days.find(({ date }) => date === '2026-09-16');

    expect(
      day?.incidents.map(({ incident: { number }, events }) => [number, events]),
    ).toEqual([
      [7, 3],
      [9, 1],
    ]);
    expect(day?.moreIncidents).toBe(0);
  });

  it('should order a day’s incidents by events, then severity, then most recent', () => {
    const calendar = buildActivityCalendar(
      [
        entry('UPDATE', '2026-09-16T09:00:00Z', { number: 1, severity: 'SEV4' }),
        entry('UPDATE', '2026-09-16T09:10:00Z', { number: 1, severity: 'SEV4' }),
        entry('UPDATE', '2026-09-16T10:00:00Z', { number: 2, severity: 'SEV3' }),
        entry('UPDATE', '2026-09-16T11:00:00Z', { number: 3, severity: 'SEV1' }),
        entry('UPDATE', '2026-09-16T12:00:00Z', { number: 4, severity: 'SEV3' }),
      ],
      period,
    );

    expect(
      calendar.days
        .find(({ date }) => date === '2026-09-16')
        ?.incidents.map(({ incident: { number } }) => number),
      // Two events first; then the SEV1; then the two SEV3s, later number first.
    ).toEqual([1, 3, 4, 2]);
  });

  it('should name only the busiest few incidents, and count the rest', () => {
    const rows = Array.from({ length: CALENDAR_INCIDENT_LIMIT + 3 }, (_, index) =>
      entry('UPDATE', '2026-09-16T09:00:00Z', { number: index + 1 }),
    );

    const day = buildActivityCalendar(rows, period).days.find(
      ({ date }) => date === '2026-09-16',
    );

    expect(day?.total).toBe(CALENDAR_INCIDENT_LIMIT + 3);
    expect(day?.incidents).toHaveLength(CALENDAR_INCIDENT_LIMIT);
    expect(day?.moreIncidents).toBe(3);
  });

  it('should count a day of nothing but uncounted entries as quiet', () => {
    const calendar = buildActivityCalendar(
      [
        entry('STATUS_CHANGED', '2026-09-16T09:00:00Z', {
          toValue: 'INVESTIGATING',
        }),
      ],
      period,
    );

    expect(calendar.total).toBe(0);
    expect(calendar.activeDays).toBe(0);
    expect(
      calendar.days.find(({ date }) => date === '2026-09-16'),
    ).toMatchObject({ total: 0, level: 0, incidents: [] });
  });

  it('should hold one day for a period of one', () => {
    const calendar = buildActivityCalendar(
      [entry('UPDATE', '2026-09-16T09:00:00Z')],
      { from: '2026-09-16', to: '2026-09-16' },
    );

    expect(calendar.days).toHaveLength(1);
    expect(calendar.days[0].total).toBe(1);
  });

  it('should hold every day of a period spanning a month end', () => {
    const calendar = buildActivityCalendar([], {
      from: '2026-02-27',
      to: '2026-03-02',
    });

    expect(calendar.days.map(({ date }) => date)).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
    expect(calendar.total).toBe(0);
    expect(calendar.activeDays).toBe(0);
  });
});
