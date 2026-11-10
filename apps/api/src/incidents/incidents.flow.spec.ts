import { describe, expect, it } from 'vitest';

import { buildFlow } from './incidents.flow.js';
import type { FlowRow, FlowTeam, FlowWindow } from './incidents.flow.js';

const MIN = 60_000;
const HOUR = 60 * MIN;

const payments: FlowTeam = {
  id: 'team-payments',
  name: 'Payments',
  slug: 'payments',
};
const risk: FlowTeam = { id: 'team-risk', name: 'Risk', slug: 'risk' };

/** Seven days, 4–10 November; now is 14:30 on the 10th. */
const window: FlowWindow = {
  gte: new Date('2026-11-04T00:00:00.000Z'),
  lt: new Date('2026-11-11T00:00:00.000Z'),
  now: new Date('2026-11-10T14:30:00.000Z'),
};

const at = (iso: string) => new Date(iso);

const row = (
  number: number,
  createdAt: string,
  {
    started,
    resolvedAt,
    team = payments,
  }: { started?: string[]; resolvedAt?: string; team?: FlowTeam } = {},
): FlowRow => ({
  id: `incident-${number}`,
  number,
  title: `Incident ${number}`,
  severity: 'SEV2',
  status: resolvedAt
    ? 'RESOLVED'
    : started?.length
      ? 'INVESTIGATING'
      : 'DECLARED',
  createdAt: at(createdAt),
  resolvedAt: resolvedAt ? at(resolvedAt) : null,
  team,
  service: { id: 'service-api', name: 'Payment API', slug: 'payment-api' },
  responders: (started ?? []).map((startedAt) => ({
    startedAt: at(startedAt),
  })),
  updates: [],
});

describe('buildFlow', () => {
  it('should wait from declaration to the first start, whoever started first', () => {
    const flow = buildFlow(
      [
        row(1, '2026-11-08T09:00:00.000Z', {
          // Listed out of order: the earliest start ends the wait.
          started: ['2026-11-08T10:30:00.000Z', '2026-11-08T09:42:00.000Z'],
          resolvedAt: '2026-11-08T13:00:00.000Z',
        }),
      ],
      [payments],
      window,
    );
    const [incident] = flow.teams[0].incidents;

    expect(incident.startedAt).toEqual(at('2026-11-08T09:42:00.000Z'));
    expect(incident.waitMs).toBe(42 * MIN);
  });

  it('should keep a wait running to now while nobody has started, and to the resolution if it never was', () => {
    const flow = buildFlow(
      [
        row(1, '2026-11-10T12:15:00.000Z'),
        row(2, '2026-11-06T10:00:00.000Z', {
          resolvedAt: '2026-11-06T11:00:00.000Z',
        }),
      ],
      [payments],
      window,
    );

    expect(
      flow.teams[0].incidents.map(({ row: { number }, waitMs }) => [
        number,
        waitMs,
      ]),
    ).toEqual([
      // Still waiting: 12:15 to now.
      [1, 2 * HOUR + 15 * MIN],
      // Resolved without anyone starting: the wait ended with it.
      [2, HOUR],
    ]);
    expect(flow.figures.waitingNow).toBe(1);
  });

  it('should take the median wait of started incidents only', () => {
    const flow = buildFlow(
      [
        row(1, '2026-11-05T10:00:00.000Z', {
          started: ['2026-11-05T10:10:00.000Z'],
        }),
        row(2, '2026-11-06T10:00:00.000Z', {
          started: ['2026-11-06T10:40:00.000Z'],
        }),
        row(3, '2026-11-07T10:00:00.000Z', {
          started: ['2026-11-07T12:00:00.000Z'],
        }),
        // Waiting: a long wait, but not a finished one.
        row(4, '2026-11-08T10:00:00.000Z'),
      ],
      [payments],
      window,
    );

    expect(flow.figures.typicalWaitMs).toBe(40 * MIN);
    expect(flow.figures.started).toBe(3);
    // The longest wait is the one still running, and says so.
    expect(flow.figures.longestWait).toEqual({
      ms: window.now.getTime() - at('2026-11-08T10:00:00.000Z').getTime(),
      number: 4,
      waiting: true,
    });
  });

  it('should average the middle two of an even count, and give no median without a start', () => {
    const even = buildFlow(
      [
        row(1, '2026-11-05T10:00:00.000Z', {
          started: ['2026-11-05T10:10:00.000Z'],
        }),
        row(2, '2026-11-06T10:00:00.000Z', {
          started: ['2026-11-06T10:30:00.000Z'],
        }),
      ],
      [payments],
      window,
    );
    const none = buildFlow(
      [row(1, '2026-11-10T14:00:00.000Z')],
      [payments],
      window,
    );

    expect(even.figures.typicalWaitMs).toBe(20 * MIN);
    expect(none.figures).toMatchObject({ typicalWaitMs: null, started: 0 });
  });

  it('should find the most running at once, counting an ending before a beginning at the same instant', () => {
    const flow = buildFlow(
      [
        row(1, '2026-11-10T09:00:00.000Z', {
          started: ['2026-11-10T09:10:00.000Z'],
        }),
        row(2, '2026-11-10T11:00:00.000Z', {
          started: ['2026-11-10T11:05:00.000Z'],
          resolvedAt: '2026-11-10T12:00:00.000Z',
        }),
        // Declared the instant 2 was resolved: two at once, not three.
        row(3, '2026-11-10T12:00:00.000Z'),
        // From 14:05, three at once.
        row(4, '2026-11-10T14:05:00.000Z'),
      ],
      [payments],
      window,
    );

    expect(flow.figures.mostAtOnce).toEqual({
      count: 3,
      at: at('2026-11-10T14:05:00.000Z'),
    });
  });

  it('should clip an incident declared before the window to its start', () => {
    const flow = buildFlow(
      [
        row(1, '2026-11-01T09:00:00.000Z', {
          started: ['2026-11-01T09:30:00.000Z'],
          resolvedAt: '2026-11-04T06:00:00.000Z',
        }),
      ],
      [payments],
      window,
    );

    expect(flow.figures.mostAtOnce).toEqual({ count: 1, at: window.gte });
  });

  it('should group by team in the order given, keep a quiet team, and leave out a team not given', () => {
    const flow = buildFlow(
      [
        row(1, '2026-11-10T09:00:00.000Z'),
        row(2, '2026-11-09T09:00:00.000Z', { team: risk }),
        row(3, '2026-11-09T10:00:00.000Z', {
          team: { id: 'team-other', name: 'Other', slug: 'other' },
        }),
      ],
      [risk, payments, { id: 'team-data', name: 'Data', slug: 'data' }],
      window,
    );

    expect(
      flow.teams.map(({ team, incidents }) => [
        team.name,
        incidents.map(({ row: { number } }) => number),
      ]),
    ).toEqual([
      ['Risk', [2]],
      ['Payments', [1]],
      ['Data', []],
    ]);
    expect(flow.teams[2].figures).toEqual({
      typicalWaitMs: null,
      started: 0,
      mostAtOnce: null,
      longestWait: null,
      waitingNow: 0,
    });
    // The organization's figures count only the teams given.
    expect(flow.figures.waitingNow).toBe(2);
  });

  it('should list what is waiting, then what is worked, then what is resolved, newest first in each', () => {
    const flow = buildFlow(
      [
        row(1, '2026-11-05T09:00:00.000Z', {
          started: ['2026-11-05T09:10:00.000Z'],
          resolvedAt: '2026-11-05T12:00:00.000Z',
        }),
        row(2, '2026-11-09T09:00:00.000Z', {
          started: ['2026-11-09T09:10:00.000Z'],
        }),
        row(3, '2026-11-08T09:00:00.000Z'),
        row(4, '2026-11-10T09:00:00.000Z'),
        row(5, '2026-11-07T09:00:00.000Z', {
          started: ['2026-11-07T09:10:00.000Z'],
          resolvedAt: '2026-11-07T12:00:00.000Z',
        }),
      ],
      [payments],
      window,
    );

    expect(
      flow.teams[0].incidents.map(({ row: { number } }) => number),
    ).toEqual([4, 3, 2, 5, 1]);
  });
});
