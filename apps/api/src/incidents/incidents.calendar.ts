/**
 * The mechanics a day-by-day calendar of incident activity is built from:
 * which UTC day an entry falls on, how many days a period holds, how busy a
 * day was, and which incidents it touched.
 *
 * Mechanics only. What counts as activity, and what it is called, is a
 * domain's own judgement and is never decided here — the organization's
 * operational activity (incidents.activity.ts) and one member's response
 * activity (member-activity.ts) each bring their own categories, their own
 * rule for reading an entry, and their own intensity bands. This file knows
 * about days and counts, and nothing about either.
 *
 * Pure, like incidents.history.ts: entries are structural rather than Prisma
 * types, incidents are generic, and no date is formatted for the wire.
 */

import type { IncidentSeverity } from './incidents.contract.js';

/** How busy a day was: 0 is quiet, 4 the busiest band. */
export type CalendarLevel = 0 | 1 | 2 | 3 | 4;

/**
 * The lowest total each level above 0 begins at, ascending. A domain sets
 * its own: one member's busy day is quiet for a whole organization.
 */
export type LevelThresholds = readonly [number, number, number, number];

/** How many of a day's incidents are named before the rest are a count. */
export const CALENDAR_INCIDENT_LIMIT = 6;

/** Which band a day's total falls in, against a domain's thresholds. */
export const levelOf = (
  total: number,
  thresholds: LevelThresholds,
): CalendarLevel => {
  if (total >= thresholds[3]) return 4;
  if (total >= thresholds[2]) return 3;
  if (total >= thresholds[1]) return 2;
  if (total >= thresholds[0]) return 1;

  return 0;
};

const DAY_MS = 86_400_000;

/** The UTC calendar day an instant falls on. */
export const utcDayOf = (moment: Date): string =>
  moment.toISOString().slice(0, 10);

const startOfUtcDay = (day: string): Date => new Date(`${day}T00:00:00.000Z`);

/** Every day from `from` to `to`, both included, oldest first. */
export const eachUtcDay = (from: string, to: string): string[] => {
  const days: string[] = [];
  const last = startOfUtcDay(to).getTime();

  for (
    let moment = startOfUtcDay(from).getTime();
    moment <= last;
    moment += DAY_MS
  ) {
    days.push(utcDayOf(new Date(moment)));
  }

  return days;
};

/** What a day's incidents are named and ordered by. */
export interface CalendarIncident {
  id: string;
  number: number;
  severity: IncidentSeverity;
}

/** One timeline entry, as a calendar needs to read it. */
export interface CalendarEntry<Incident extends CalendarIncident> {
  createdAt: Date;
  incident: Incident;
}

/** An incident something happened to on a day, and how much. */
export interface DayIncident<Incident extends CalendarIncident> {
  incident: Incident;
  events: number;
}

export interface CalendarDay<
  Category extends string,
  Incident extends CalendarIncident,
> {
  /** The UTC calendar day, `YYYY-MM-DD`. */
  date: string;
  total: number;
  level: CalendarLevel;
  /** Every one of the domain's categories, zero-filled. */
  counts: Record<Category, number>;
  /** The busiest first, at most the limit the domain asked for. */
  incidents: DayIncident<Incident>[];
  /** Incidents touched that day beyond the ones named. */
  moreIncidents: number;
}

export interface Calendar<
  Category extends string,
  Incident extends CalendarIncident,
> {
  /** Every day of the period, oldest first — quiet days included. */
  days: CalendarDay<Category, Incident>[];
  total: number;
  activeDays: number;
}

/** What a domain brings: its categories, how it reads an entry, its bands. */
export interface CalendarSpec<
  Category extends string,
  Entry,
> {
  categories: readonly Category[];
  /** The entry's category, or undefined when it is not activity at all. */
  categoryOf: (entry: Entry) => Category | undefined;
  thresholds: LevelThresholds;
  incidentLimit?: number;
}

/** Most severe first — the order the database enum declares them in. */
const SEVERITY_ORDER: readonly IncidentSeverity[] = [
  'SEV1',
  'SEV2',
  'SEV3',
  'SEV4',
];

/** The busiest first, then the most severe, then the most recent. */
const byActivity = <Incident extends CalendarIncident>(
  a: DayIncident<Incident>,
  b: DayIncident<Incident>,
): number =>
  b.events - a.events ||
  SEVERITY_ORDER.indexOf(a.incident.severity) -
    SEVERITY_ORDER.indexOf(b.incident.severity) ||
  b.incident.number - a.incident.number;

/**
 * The period's calendar, from the entries recorded in it.
 *
 * Every day between the ends is present, so nothing downstream has to fill
 * gaps: a quiet day is a day with a zero total, not a missing one. Entries
 * outside the period, and entries the domain does not count, are ignored —
 * a caller may hand over a period's entries unfiltered.
 *
 * An incident is named on a day when at least one counted entry about it was
 * recorded that day, however many; `events` is how many.
 */
export const buildCalendar = <
  Category extends string,
  Incident extends CalendarIncident,
  Entry extends CalendarEntry<Incident>,
>(
  entries: readonly Entry[],
  period: { from: string; to: string },
  spec: CalendarSpec<Category, Entry>,
): Calendar<Category, Incident> => {
  const limit = spec.incidentLimit ?? CALENDAR_INCIDENT_LIMIT;

  const emptyCounts = () =>
    Object.fromEntries(spec.categories.map((category) => [category, 0])) as
      Record<Category, number>;

  const days = new Map<
    string,
    {
      counts: Record<Category, number>;
      total: number;
      incidents: Map<string, DayIncident<Incident>>;
    }
  >();

  for (const date of eachUtcDay(period.from, period.to)) {
    days.set(date, { counts: emptyCounts(), total: 0, incidents: new Map() });
  }

  let total = 0;

  for (const entry of entries) {
    const category = spec.categoryOf(entry);

    if (category === undefined) continue;

    const day = days.get(utcDayOf(entry.createdAt));

    if (!day) continue;

    day.counts[category] += 1;
    day.total += 1;
    total += 1;

    const seen = day.incidents.get(entry.incident.id);

    if (seen) seen.events += 1;
    else day.incidents.set(entry.incident.id, { incident: entry.incident, events: 1 });
  }

  let activeDays = 0;

  const calendar = [...days].map(([date, day]) => {
    if (day.total > 0) activeDays += 1;

    const incidents = [...day.incidents.values()].sort(byActivity);

    return {
      date,
      total: day.total,
      level: levelOf(day.total, spec.thresholds),
      counts: day.counts,
      incidents: incidents.slice(0, limit),
      moreIncidents: Math.max(incidents.length - limit, 0),
    };
  });

  return { days: calendar, total, activeDays };
};
