/**
 * How often incidents are declared, and against which services: the
 * organization's incident occurrence over a period of whole UTC days,
 * compared with the period before it.
 *
 * Occurrence, not activity. An incident occurs once, when it is declared —
 * its row's `created_at` — whatever happens to it afterwards: resolving it,
 * changing its severity, or reassigning it changes nothing here. How much
 * work incidents caused, day by day, is operational activity's question
 * (incidents.activity.ts), answered from the timeline.
 *
 * Postgres counts; this decides what the counts mean. The service reads
 * declarations per UTC day, the previous period's total, and a count per
 * service, all plainly, and every rule lives here, pure and tested:
 *
 *   windows      The current period runs from its first midnight to `asOf`
 *                — now, or the period's end if that came first. The
 *                previous period is the same number of days immediately
 *                before it, cut at the same distance: both cover exactly
 *                the same elapsed time, so a day still in progress cannot
 *                make the present look quieter than the past.
 *
 *   complete     A day is complete once it has ended by `asOf`. Today is
 *                not: it is counted, but it is never incident-free and has
 *                no rolling average, because it is not over.
 *
 *   tracked      Days before the organization had any record — before it
 *                existed, or before its earliest incident, whichever is
 *                first — are not tracked. They are not incident-free: there
 *                is no history to be free of incidents in. The earliest
 *                incident is part of the rule because history can be
 *                imported with its original dates.
 *
 *   rolling      The average of a complete day and the six before it, all
 *                tracked. The six days before the period are read too, so
 *                the line is whole from the period's first day.
 *
 *   comparison   A percentage only against a previous period that was
 *                wholly tracked and had at least `OCCURRENCE_MINIMUM`
 *                incidents. From nought a percentage is undefined; from
 *                very few it is noise. The counts are always given, so a
 *                client says the difference in words instead.
 *
 *   services     Each incident belongs to exactly one service, fixed at
 *                declaration, so the services' counts partition the period
 *                and each share is its count over the period's total. The
 *                busiest `OCCURRENCE_TOP_SERVICES` are named — ties by name,
 *                then id — and the rest summed, so nothing is lost. An
 *                archived service is ranked like any other: its incidents
 *                are history.
 */

import { eachUtcDay, utcDayOf } from './incidents.calendar.js';
import { startOfUtcDay } from './incidents.schemas.js';

const DAY_MS = 86_400_000;

/** How many days a rolling average covers, the day itself included. */
export const ROLLING_DAYS = 7;

/** The fewest previous incidents a percentage change is given against. */
export const OCCURRENCE_MINIMUM = 5;

/** How many services are named before the rest are a count. */
export const OCCURRENCE_TOP_SERVICES = 5;

const addDays = (day: string, days: number): string =>
  utcDayOf(new Date(startOfUtcDay(day).getTime() + days * DAY_MS));

/** A range of instants, as Prisma's `gte`/`lt` filter takes it. */
export interface InstantRange {
  gte: Date;
  lt: Date;
}

export interface OccurrenceWindows {
  /** How many days the period covers, both ends included. */
  days: number;
  /** When counting stops: now, held within the period. */
  asOf: Date;
  /** The period itself, up to `asOf`. */
  current: InstantRange;
  /** The same elapsed time, immediately before. */
  previous: InstantRange & { from: string; to: string };
  /** The period and the days its first rolling average reaches back to. */
  series: InstantRange;
}

/**
 * The instants every read covers, for a period of whole UTC days read at
 * `now`. `asOf` is held within the period, so a period in the past is
 * counted whole, and one that has not started counts nothing.
 */
export const occurrenceWindows = (
  period: { from: string; to: string },
  now: Date,
): OccurrenceWindows => {
  const start = startOfUtcDay(period.from).getTime();
  const end = startOfUtcDay(period.to).getTime() + DAY_MS;
  const days = Math.round((end - start) / DAY_MS);
  const asOf = new Date(Math.min(Math.max(now.getTime(), start), end));
  const span = days * DAY_MS;

  return {
    days,
    asOf,
    current: { gte: new Date(start), lt: asOf },
    previous: {
      from: addDays(period.from, -days),
      to: addDays(period.to, -days),
      gte: new Date(start - span),
      lt: new Date(asOf.getTime() - span),
    },
    series: {
      gte: new Date(start - (ROLLING_DAYS - 1) * DAY_MS),
      lt: asOf,
    },
  };
};

/** What a service is named by; carried through untouched. */
export interface OccurrenceService {
  id: string;
  name: string;
}

export interface OccurrenceInput<Service extends OccurrenceService> {
  period: { from: string; to: string };
  windows: OccurrenceWindows;
  /**
   * When the organization's history begins: the earlier of its creation and
   * its first incident. Null when there is no organization to date it by.
   */
  trackedSince: Date | null;
  /** Declarations per UTC day across `windows.series`; days with none absent. */
  daily: readonly { day: string; declared: number }[];
  /** Declarations across `windows.previous`. */
  previousDeclared: number;
  /** Declarations per service across `windows.current`. */
  services: readonly { service: Service; declared: number }[];
}

export interface OccurrenceDay {
  /** The UTC calendar day, `YYYY-MM-DD`. */
  date: string;
  declared: number;
  complete: boolean;
  tracked: boolean;
  rollingAverage: number | null;
}

export interface Occurrence<Service extends OccurrenceService> {
  from: string;
  to: string;
  asOf: Date;
  trackedFrom: string | null;
  declared: number;
  incidentFreeDays: number;
  completeDays: number;
  days: OccurrenceDay[];
  previous: {
    from: string;
    to: string;
    declared: number;
    comparable: boolean;
    minimumSample: number;
    changePercent: number | null;
  };
  services: {
    top: (Service & { declared: number; share: number })[];
    others: { services: number; declared: number };
  };
}

/** Busiest first; a tie by name, then by id, so the order never wavers. */
const byDeclared = <Service extends OccurrenceService>(
  a: { service: Service; declared: number },
  b: { service: Service; declared: number },
): number =>
  b.declared - a.declared ||
  a.service.name.localeCompare(b.service.name, 'en') ||
  (a.service.id < b.service.id ? -1 : a.service.id > b.service.id ? 1 : 0);

/** A figure to two decimal places: an average, not a measurement. */
const hundredths = (value: number): number => Math.round(value * 100) / 100;

export const buildOccurrence = <Service extends OccurrenceService>({
  period,
  windows,
  trackedSince,
  daily,
  previousDeclared,
  services,
}: OccurrenceInput<Service>): Occurrence<Service> => {
  const trackedFrom = trackedSince ? utcDayOf(trackedSince) : null;
  const isTracked = (day: string) => trackedFrom !== null && day >= trackedFrom;
  const isComplete = (day: string) =>
    startOfUtcDay(day).getTime() + DAY_MS <= windows.asOf.getTime();

  const counts = new Map(daily.map(({ day, declared }) => [day, declared]));
  const countOf = (day: string) => counts.get(day) ?? 0;

  const rollingAverage = (day: string): number | null => {
    if (!isComplete(day)) return null;

    const reach = eachUtcDay(addDays(day, -(ROLLING_DAYS - 1)), day);

    if (!reach.every(isTracked)) return null;

    return hundredths(
      reach.reduce((sum, date) => sum + countOf(date), 0) / ROLLING_DAYS,
    );
  };

  const days = eachUtcDay(period.from, period.to).map((date) => ({
    date,
    declared: countOf(date),
    complete: isComplete(date),
    tracked: isTracked(date),
    rollingAverage: rollingAverage(date),
  }));

  const declared = days.reduce((sum, day) => sum + day.declared, 0);
  const counted = days.filter((day) => day.complete && day.tracked);

  const comparable =
    trackedFrom !== null && windows.previous.from >= trackedFrom;
  const changePercent =
    comparable && previousDeclared >= OCCURRENCE_MINIMUM
      ? // `|| 0` turns Math.round's -0 into 0: no change has no sign.
        Math.round(((declared - previousDeclared) / previousDeclared) * 100) ||
        0
      : null;

  const ranked = services.filter((row) => row.declared > 0).sort(byDeclared);
  const top = ranked.slice(0, OCCURRENCE_TOP_SERVICES);
  const rest = ranked.slice(OCCURRENCE_TOP_SERVICES);

  return {
    from: period.from,
    to: period.to,
    asOf: windows.asOf,
    trackedFrom,
    declared,
    incidentFreeDays: counted.filter((day) => day.declared === 0).length,
    completeDays: counted.length,
    days,
    previous: {
      from: windows.previous.from,
      to: windows.previous.to,
      declared: previousDeclared,
      comparable,
      minimumSample: OCCURRENCE_MINIMUM,
      changePercent,
    },
    services: {
      top: top.map(({ service, declared: count }) => ({
        ...service,
        declared: count,
        share: declared > 0 ? count / declared : 0,
      })),
      others: {
        services: rest.length,
        declared: rest.reduce((sum, row) => sum + row.declared, 0),
      },
    },
  };
};
