import { startOfUtcDay, utcDay } from "@/lib/period/period";

/**
 * Arranging a run of UTC days into calendar weeks, and moving around them.
 *
 * Presentation only. What a day's activity *is*, and which level it earns,
 * is decided by the API that answered — this takes the days as given and
 * decides only where each one sits on screen and where the arrow keys go.
 *
 * Weeks start on Sunday and run to Saturday. That is the calendar
 * SentinelOps shows, and it is independent of how any history was
 * generated: a day is placed by the weekday its own UTC date falls on.
 */

/** How busy a day was, as the activity APIs report it: 0 is quiet. */
export type ActivityLevel = 0 | 1 | 2 | 3 | 4;

/** One day, as both activity APIs answer for it. */
export interface ActivityDay {
  /** The UTC calendar day, `YYYY-MM-DD`. */
  date: string;
  total: number;
  level: ActivityLevel;
}

/**
 * One square, in one of three states.
 *
 *   day     a day that has happened, with what was recorded on it. A quiet
 *           one is still a day: nothing happened, and that is worth seeing.
 *   future  a day of the calendar's range that has not happened yet. Drawn
 *           as part of the year's shape, and never as a quiet day.
 *   blank   no square: the days of the neighbouring years that fill the
 *           first and last columns out to whole weeks.
 */
export type CalendarCell =
  | { kind: "day"; date: string; day: ActivityDay; today: boolean }
  | { kind: "future"; date: string }
  | { kind: "blank"; date: string };

/** Sunday first, as the columns read down. */
export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export const DAYS_IN_WEEK = WEEKDAYS.length;

const DAY_MS = 86_400_000;

const addDays = (day: string, days: number): string =>
  utcDay(new Date(startOfUtcDay(day).getTime() + days * DAY_MS));

/** Which weekday a UTC date falls on, 0 for Sunday. */
export const weekdayOf = (date: string): number =>
  startOfUtcDay(date).getUTCDay();

/**
 * The calendar as whole Sunday-to-Saturday columns, oldest first.
 *
 * `range` is the stretch of days the calendar covers — a whole year, for
 * the Overview — and is padded out to whole weeks at both ends, so every
 * column holds seven squares. It defaults to the span of the days given.
 *
 * Every day of the range gets a square. One the API answered for is a
 * `day`, quiet or not; one later than `today` is `future`, even if a row
 * arrived for it, because a day that has not happened must never read as a
 * quiet one. The padding days either side of the range are `blank`.
 *
 * `today` defaults to the last day given.
 */
export const toWeeks = (
  days: readonly ActivityDay[],
  {
    today,
    range,
  }: { today?: string; range?: { from: string; to: string } } = {},
): CalendarCell[][] => {
  const dates = days.map((day) => day.date).sort();
  const span = range ?? {
    from: dates[0],
    to: dates[dates.length - 1],
  };

  if (span.from === undefined || span.to === undefined) return [];

  const byDate = new Map(days.map((day) => [day.date, day]));
  const until = today ?? dates[dates.length - 1] ?? span.to;

  const start = addDays(span.from, -weekdayOf(span.from));
  const end = addDays(span.to, DAYS_IN_WEEK - 1 - weekdayOf(span.to));

  const weeks: CalendarCell[][] = [];
  let cursor = start;

  while (cursor <= end) {
    const week: CalendarCell[] = [];

    for (let index = 0; index < DAYS_IN_WEEK; index += 1) {
      const day = byDate.get(cursor);
      const inRange = cursor >= span.from && cursor <= span.to;

      if (inRange && cursor > until) {
        week.push({ kind: "future", date: cursor });
      } else if (inRange && day) {
        week.push({ kind: "day", date: cursor, day, today: cursor === until });
      } else {
        week.push({ kind: "blank", date: cursor });
      }

      cursor = addDays(cursor, 1);
    }

    weeks.push(week);
  }

  return weeks;
};

/** The whole of a calendar year, as the calendar draws it. */
export const yearRange = (year: number): { from: string; to: string } => ({
  from: `${year}-01-01`,
  to: `${year}-12-31`,
});

/** The calendar year a moment falls in, read in UTC as every day here is. */
export const yearOf = (now: Date): number => Number(utcDay(now).slice(0, 4));

/**
 * The days to ask an activity route for: that year, up to today.
 *
 * It stops at today rather than at the last of December — there is no point
 * asking about days that have not happened, and the calendar draws the rest
 * of the year as future days by itself. A year already over is asked for
 * whole, so nothing here assumes the year is the current one.
 *
 * At most 366 days either way, which is exactly what the route allows.
 */
export const yearWindow = (
  year: number,
  now: Date,
): { from: string; to: string } => {
  const today = utcDay(now);
  const range = yearRange(year);

  return { from: range.from, to: today < range.to ? today : range.to };
};

/** A month's name above the column it starts in. */
export interface MonthLabel {
  /** Which column it sits above. */
  week: number;
  /** The month, short: "Mar". */
  label: string;
  /** The month itself, `YYYY-MM`, so one of them can be picked out. */
  month: string;
}

const MONTH = new Intl.DateTimeFormat(undefined, {
  month: "short",
  timeZone: "UTC",
});

/**
 * Where each month begins, for the labels above the grid.
 *
 * A label goes above the first column whose Sunday belongs to a new month.
 * The leftmost column is labelled only when its month holds the next one
 * too — otherwise a month with a single visible column would put its name
 * beside the next month's, and the two would collide.
 */
export const monthLabels = (weeks: readonly CalendarCell[][]): MonthLabel[] => {
  const monthOf = (week: CalendarCell[]) => week[0].date.slice(0, 7);
  const labels: MonthLabel[] = [];

  weeks.forEach((week, index) => {
    const month = monthOf(week);

    if (index > 0 && month === monthOf(weeks[index - 1])) return;
    // The leftmost column's month must last, or its name would crowd the
    // one that follows it.
    if (index === 0 && weeks.length > 1 && monthOf(weeks[1]) !== month) return;

    labels.push({
      week: index,
      label: MONTH.format(startOfUtcDay(week[0].date)),
      month,
    });
  });

  return labels;
};

/** Which way a key moves the focused day. */
export type CalendarMove = "day" | "week" | "start" | "end";

const MOVES: Record<string, { by: CalendarMove; step: number }> = {
  // Down the column is forward in time, up is back: one day either way,
  // carrying on into the next column at a week's edge.
  ArrowDown: { by: "day", step: 1 },
  ArrowUp: { by: "day", step: -1 },
  // Across the columns is the same weekday, a week either side.
  ArrowRight: { by: "week", step: 1 },
  ArrowLeft: { by: "week", step: -1 },
  Home: { by: "start", step: 0 },
  End: { by: "end", step: 0 },
};

/**
 * Where a key takes the focus, or undefined when the key does not move it.
 *
 * `dates` are the focusable days in order, which are the real ones: a
 * placeholder is never focused, so moving never lands on a day that has not
 * happened. Movement is over that run, so one day forward from a Saturday
 * is the next column's Sunday, and a week forward is the same weekday.
 * Both ends clamp rather than wrapping — running off the end of the year
 * and reappearing at the other is disorienting.
 */
export const moveFocus = (
  dates: readonly string[],
  from: string,
  key: string,
): string | undefined => {
  const move = MOVES[key];

  if (!move || dates.length === 0) return undefined;

  if (move.by === "start") return dates[0];
  if (move.by === "end") return dates[dates.length - 1];

  const index = dates.indexOf(from);

  if (index === -1) return undefined;

  const next = index + move.step * (move.by === "week" ? DAYS_IN_WEEK : 1);

  return dates[Math.min(Math.max(next, 0), dates.length - 1)];
};
