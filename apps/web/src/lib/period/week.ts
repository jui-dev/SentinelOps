import { startOfUtcDay } from "./period";

/**
 * How SentinelOps arranges a week: Bangladesh's convention, fixed for now.
 *
 * Weeks start on Saturday and run to Friday, and the weekend is Friday and
 * Saturday. Every calendar that is laid out in weeks follows it, and every
 * view that marks weekends marks these. It is one place on purpose: should
 * it become an organization's choice, this is what that choice replaces.
 *
 * Days are UTC throughout, as everywhere here, so a date's weekday is the
 * one its UTC date falls on.
 */

/** `getUTCDay()` numbering: 0 is Sunday, 6 is Saturday. */
const SATURDAY = 6;
const FRIDAY = 5;

/** The weekday a week begins on, in `getUTCDay()` numbering. */
export const WEEK_STARTS_ON = SATURDAY;

/** The weekend, in `getUTCDay()` numbering. */
export const WEEKEND: ReadonlySet<number> = new Set([FRIDAY, SATURDAY]);

const NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** The weekdays in the order a week runs: Saturday first. */
export const WEEKDAYS = Array.from(
  { length: NAMES.length },
  (_, index) => NAMES[(WEEK_STARTS_ON + index) % NAMES.length],
);

export const DAYS_IN_WEEK = WEEKDAYS.length;

/** Where a UTC date falls in its week: 0 for its first day, Saturday. */
export const weekdayOf = (date: string): number =>
  (startOfUtcDay(date).getUTCDay() - WEEK_STARTS_ON + DAYS_IN_WEEK) % DAYS_IN_WEEK;

/** Whether a UTC date falls on the weekend: a Friday or a Saturday. */
export const isWeekend = (date: string): boolean =>
  WEEKEND.has(startOfUtcDay(date).getUTCDay());
