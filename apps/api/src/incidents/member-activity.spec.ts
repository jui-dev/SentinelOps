import { levelOf } from './incidents.calendar.js';
import type { IncidentActivityType } from './incidents.contract.js';
import {
  buildMemberActivityCalendar,
  MEMBER_LEVELS,
  memberCategoryOf,
} from './member-activity.js';
import type { MemberActivityRow } from './member-activity.js';

const incident = (number: number) => ({
  id: `i${number}`,
  number,
  severity: 'SEV3' as const,
});

const entry = (
  type: IncidentActivityType,
  at: string,
  number = 1,
): MemberActivityRow<ReturnType<typeof incident>> => ({
  type,
  createdAt: new Date(at),
  incident: incident(number),
});

const period = { from: '2026-09-14', to: '2026-09-20' };

const dayOf = (
  rows: MemberActivityRow<ReturnType<typeof incident>>[],
  date = '2026-09-16',
) =>
  buildMemberActivityCalendar(rows, period).days.find(
    (day) => day.date === date,
  );

describe('what counts as one member’s response activity', () => {
  it.each([
    ['RESPONSE_STARTED', 'responseStarted'],
    ['UPDATE', 'update'],
    ['RESPONSE_COMPLETED', 'responseCompleted'],
  ])('should count %s as %s', (type, category) => {
    expect(memberCategoryOf({ type: type as IncidentActivityType })).toBe(
      category,
    );
  });

  /**
   * Declaring, resolving, reassigning and re-grading are authority over an
   * incident, not participation in its response. The Admin's own updates are
   * participation, and are counted by the rule above.
   */
  it.each(['DECLARED', 'STATUS_CHANGED', 'SEVERITY_CHANGED', 'TEAM_CHANGED'])(
    'should not count %s',
    (type) => {
      expect(
        memberCategoryOf({ type: type as IncidentActivityType }),
      ).toBeUndefined();
    },
  );

  /**
   * The server writes it a millisecond after the member's own
   * RESPONSE_STARTED, attributed to them. Counting it would make one pickup
   * look like two acts.
   */
  it('should not count the status change the member’s own start causes', () => {
    const day = dayOf([
      entry('RESPONSE_STARTED', '2026-09-16T09:00:00Z'),
      entry('STATUS_CHANGED', '2026-09-16T09:00:00.001Z'),
    ]);

    expect(day?.total).toBe(1);
    expect(day?.counts).toEqual({
      responseStarted: 1,
      update: 0,
      responseCompleted: 0,
    });
  });

  /**
   * A whole incident's timeline, as one responder's own entries are read out
   * of it: they started, wrote twice and finished. The declaration and the
   * resolution are on the same incident and are not theirs to count.
   */
  it('should count only the acts of responding, from a whole response', () => {
    const day = dayOf([
      entry('DECLARED', '2026-09-16T08:00:00Z'),
      entry('RESPONSE_STARTED', '2026-09-16T09:00:00Z'),
      entry('STATUS_CHANGED', '2026-09-16T09:00:00.001Z'),
      entry('UPDATE', '2026-09-16T10:00:00Z'),
      entry('UPDATE', '2026-09-16T11:00:00Z'),
      entry('SEVERITY_CHANGED', '2026-09-16T11:15:00Z'),
      entry('RESPONSE_COMPLETED', '2026-09-16T12:00:00Z'),
      entry('STATUS_CHANGED', '2026-09-16T12:30:00Z'),
    ]);

    expect(day?.counts).toEqual({
      responseStarted: 1,
      update: 2,
      responseCompleted: 1,
    });
    expect(day?.total).toBe(4);
    expect(day?.level).toBe(3);
  });

  it('should count an update on its own, with no response started', () => {
    const day = dayOf([entry('UPDATE', '2026-09-16T09:00:00Z')]);

    expect(day?.counts).toEqual({
      responseStarted: 0,
      update: 1,
      responseCompleted: 0,
    });
    expect(day?.total).toBe(1);
  });
});

describe('a member’s activity levels', () => {
  /** A person's bands, far lower than a whole organization's. */
  it.each([
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 2],
    [4, 3],
    [5, 3],
    [6, 4],
    [12, 4],
  ])('should put %i of one member’s events at level %i', (total, level) => {
    expect(levelOf(total, MEMBER_LEVELS)).toBe(level);
  });

  it('should reach a higher band than the organization would for the same day', () => {
    const busy = Array.from({ length: 6 }, (_, index) =>
      entry(
        'UPDATE',
        `2026-09-16T${String(9 + index).padStart(2, '0')}:00:00Z`,
      ),
    );

    // Six events: the top band for a person, the middle one for an
    // organization. The two calendars are never read against each other.
    expect(dayOf(busy)?.level).toBe(4);
  });
});

describe('the member activity calendar', () => {
  it('should hold every day of the period, quiet ones included', () => {
    const calendar = buildMemberActivityCalendar(
      [entry('UPDATE', '2026-09-16T09:00:00Z')],
      period,
    );

    expect(calendar.days).toHaveLength(7);
    expect(calendar.total).toBe(1);
    expect(calendar.activeDays).toBe(1);
    expect(calendar.days[0]).toMatchObject({
      date: '2026-09-14',
      total: 0,
      level: 0,
      incidents: [],
      counts: { responseStarted: 0, update: 0, responseCompleted: 0 },
    });
  });

  it('should file an entry under the UTC day it was recorded on', () => {
    const calendar = buildMemberActivityCalendar(
      [
        entry('UPDATE', '2026-09-15T23:59:59.999Z'),
        entry('UPDATE', '2026-09-16T00:00:00.000Z'),
      ],
      period,
    );

    expect(
      calendar.days.filter((day) => day.total > 0).map((day) => day.date),
    ).toEqual(['2026-09-15', '2026-09-16']);
  });

  it('should name the incidents they worked, with how much they did on each', () => {
    const day = dayOf([
      entry('RESPONSE_STARTED', '2026-09-16T09:00:00Z', 7),
      entry('UPDATE', '2026-09-16T10:00:00Z', 7),
      entry('UPDATE', '2026-09-16T11:00:00Z', 9),
      // Not theirs to count, so incident 4 is not a day they worked.
      entry('DECLARED', '2026-09-16T12:00:00Z', 4),
    ]);

    expect(
      day?.incidents.map(({ incident: { number }, events }) => [
        number,
        events,
      ]),
    ).toEqual([
      [7, 2],
      [9, 1],
    ]);
  });

  it('should be quiet on a day holding nothing they authored themselves', () => {
    const calendar = buildMemberActivityCalendar(
      [
        entry('DECLARED', '2026-09-16T09:00:00Z'),
        entry('STATUS_CHANGED', '2026-09-16T12:00:00Z'),
      ],
      period,
    );

    expect(calendar.total).toBe(0);
    expect(calendar.activeDays).toBe(0);
    expect(dayOf([])).toMatchObject({ total: 0, level: 0, incidents: [] });
  });
});
