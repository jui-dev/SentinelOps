import type { IncidentPeriod } from "@/lib/api/contracts";

/**
 * Periods of whole UTC days, both ends included, as `YYYY-MM-DD`: what the
 * API's incident periods are, wherever the web client uses one — the
 * overview's selected period, a range narrowing the Incidents page.
 *
 * UTC like every other SentinelOps time — the strip's clock, every table's
 * dates — so a day means the same day to everyone, and the API is asked for
 * exactly the days shown.
 */

/** The longest period, in days. The API refuses anything longer. */
export const MAX_PERIOD_DAYS = 366;

const DAY_MS = 86_400_000;

/** The UTC calendar day `date` falls on. */
export const utcDay = (date: Date): string => date.toISOString().slice(0, 10);

/** Midnight UTC at the start of `day`. */
export const startOfUtcDay = (day: string): Date =>
  new Date(`${day}T00:00:00.000Z`);

/**
 * The last `days` whole UTC days up to and including the one `now` falls
 * on: `lastUtcDays(1, now)` is today alone, `lastUtcDays(30, now)` the
 * thirty days ending today.
 *
 * Both ends included, like every period here, so the count is the number of
 * days shown rather than a distance between two dates.
 */
export const lastUtcDays = (days: number, now: Date): IncidentPeriod => {
  const to = utcDay(now);

  return {
    from: utcDay(new Date(startOfUtcDay(to).getTime() - (days - 1) * DAY_MS)),
    to,
  };
};

/** How many days a period covers, both ends included. */
export const periodDays = ({ from, to }: IncidentPeriod): number =>
  Math.round(
    (startOfUtcDay(to).getTime() - startOfUtcDay(from).getTime()) / DAY_MS,
  ) + 1;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Whether the string is a date that exists, not merely one shaped like one. */
const isRealDay = (day: string): boolean =>
  ISO_DAY.test(day) && utcDay(startOfUtcDay(day)) === day;

/**
 * A period from a URL's `from` and `to`, as the API would accept it.
 *
 * Neither is no filter. Anything else the API would refuse — one end alone,
 * a date that does not exist, an end before its start, or more days than
 * the limit — is `invalid`, so the page can put the URL right rather than
 * show something the address bar disagrees with.
 */
export const readPeriodParams = (
  from: string | null,
  to: string | null,
): { period?: IncidentPeriod; invalid: boolean } => {
  if (from === null && to === null) return { invalid: false };

  if (
    from === null ||
    to === null ||
    !isRealDay(from) ||
    !isRealDay(to) ||
    from > to ||
    periodDays({ from, to }) > MAX_PERIOD_DAYS
  ) {
    return { invalid: true };
  }

  return { period: { from, to }, invalid: false };
};

/**
 * A period as a person reads it, in their locale's own range form:
 * "12–18 Sep 2026", "Sep 12 – 18, 2026", naming a shared month or year once.
 */
export const formatPeriodRange = ({ from, to }: IncidentPeriod): string =>
  new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).formatRange(startOfUtcDay(from), startOfUtcDay(to));
