/**
 * Response flow: how a set of teams' incidents ran over the last few days —
 * how long each waited for someone to start, how long it was then worked,
 * and when the teams had the most on at once.
 *
 * A team-level reading, never a personal one. Every figure is about the
 * incidents and the teams responsible for them now; who started first, or
 * how fast any one person was, is not computed and cannot be read back out.
 * The caller's own updates are carried on each incident only so they can see
 * where their own work fell.
 *
 * Pure: rows, teams, and the window are given; nothing is looked up.
 *
 *   wait   declaration → the first responder's start. While nobody has
 *          started, it runs to the incident's resolution or, unresolved, to
 *          now: an incident still waiting is the wait that matters most.
 *   work   the first start → resolution, or now while it is not resolved.
 */

import type { IncidentSeverity, IncidentStatus } from './incidents.contract.js';

export interface FlowRow {
  id: string;
  number: number;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  createdAt: Date;
  resolvedAt: Date | null;
  team: { id: string; name: string; slug: string };
  service: { id: string; name: string; slug: string };
  responders: readonly { startedAt: Date }[];
  /** The caller's own updates on it, inside the window. */
  updates: readonly { createdAt: Date }[];
}

export interface FlowTeam {
  id: string;
  name: string;
  slug: string;
}

/**
 * The window, as instants: its first midnight, the one after its last day,
 * and the moment counting stops — now, or the window's end if that came
 * first.
 */
export interface FlowWindow {
  gte: Date;
  lt: Date;
  now: Date;
}

export interface FlowFigures {
  /** Median wait of the incidents someone has started; null with none. */
  typicalWaitMs: number | null;
  /** How many incidents the typical wait is the middle of. */
  started: number;
  /** The most incidents running at one instant, and when that began. */
  mostAtOnce: { count: number; at: Date } | null;
  /** The longest wait, whose it was, and whether it is still running. */
  longestWait: { ms: number; number: number; waiting: boolean } | null;
  /** Unresolved incidents nobody has started. */
  waitingNow: number;
}

export interface FlowIncident {
  row: FlowRow;
  /** The first responder's start, or null while nobody has started. */
  startedAt: Date | null;
  waitMs: number;
}

export interface Flow {
  figures: FlowFigures;
  teams: { team: FlowTeam; figures: FlowFigures; incidents: FlowIncident[] }[];
}

const earliest = (dates: readonly Date[]): Date | null =>
  dates.reduce<Date | null>(
    (first, date) => (!first || date < first ? date : first),
    null,
  );

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return Math.round(
    sorted.length % 2 === 1
      ? sorted[middle]
      : (sorted[middle - 1] + sorted[middle]) / 2,
  );
};

/** One incident, with when it was first started and how long it waited. */
const toFlowIncident = (row: FlowRow, now: Date): FlowIncident => {
  const startedAt = earliest(row.responders.map(({ startedAt }) => startedAt));
  const waitEnd = startedAt ?? row.resolvedAt ?? now;

  return {
    row,
    startedAt,
    waitMs: Math.max(0, waitEnd.getTime() - row.createdAt.getTime()),
  };
};

const isWaiting = ({ row, startedAt }: FlowIncident) =>
  startedAt === null && row.resolvedAt === null;

/**
 * The most incidents running at once inside the window: each runs from its
 * declaration to its resolution (now, unresolved), clipped to the window. At
 * the same instant an ending is counted before a beginning, so an incident
 * resolved as another is declared does not make two.
 */
const mostAtOnce = (
  incidents: readonly FlowIncident[],
  window: FlowWindow,
): FlowFigures['mostAtOnce'] => {
  const events: { at: number; change: 1 | -1 }[] = [];

  for (const { row } of incidents) {
    const start = Math.max(row.createdAt.getTime(), window.gte.getTime());
    const end = Math.min(
      (row.resolvedAt ?? window.now).getTime(),
      window.now.getTime(),
    );

    if (end <= start) continue;

    events.push({ at: start, change: 1 }, { at: end, change: -1 });
  }

  events.sort((a, b) => a.at - b.at || a.change - b.change);

  let running = 0;
  let best: { count: number; at: number } | null = null;

  for (const event of events) {
    running += event.change;

    if (event.change === 1 && (!best || running > best.count)) {
      best = { count: running, at: event.at };
    }
  }

  return best && { count: best.count, at: new Date(best.at) };
};

const figuresOf = (
  incidents: readonly FlowIncident[],
  window: FlowWindow,
): FlowFigures => {
  const startedWaits = incidents
    .filter(({ startedAt }) => startedAt !== null)
    .map(({ waitMs }) => waitMs);
  const longest = incidents.reduce<FlowIncident | null>(
    (worst, incident) =>
      !worst ||
      incident.waitMs > worst.waitMs ||
      (incident.waitMs === worst.waitMs &&
        incident.row.number > worst.row.number)
        ? incident
        : worst,
    null,
  );

  return {
    typicalWaitMs: median(startedWaits),
    started: startedWaits.length,
    mostAtOnce: mostAtOnce(incidents, window),
    longestWait: longest && {
      ms: longest.waitMs,
      number: longest.row.number,
      waiting: isWaiting(longest),
    },
    waitingNow: incidents.filter(isWaiting).length,
  };
};

/** Waiting, then being worked, then resolved; newest first within each. */
const rank = (incident: FlowIncident) =>
  isWaiting(incident) ? 0 : incident.row.resolvedAt === null ? 1 : 2;

/**
 * The flow of `rows` over `window`, grouped by each incident's responsible
 * team now, in the order `teams` gives. Every team given has a group, even
 * one with no incidents — "all clear" is an answer too — and an incident
 * whose team is not given is left out.
 */
export const buildFlow = (
  rows: readonly FlowRow[],
  teams: readonly FlowTeam[],
  window: FlowWindow,
): Flow => {
  const known = new Set(teams.map(({ id }) => id));
  const incidents = rows
    .filter((row) => known.has(row.team.id))
    .map((row) => toFlowIncident(row, window.now))
    .sort(
      (a, b) =>
        rank(a) - rank(b) ||
        b.row.createdAt.getTime() - a.row.createdAt.getTime() ||
        b.row.number - a.row.number,
    );

  return {
    figures: figuresOf(incidents, window),
    teams: teams.map((team) => {
      const own = incidents.filter(({ row }) => row.team.id === team.id);

      return { team, figures: figuresOf(own, window), incidents: own };
    }),
  };
};
