import type {
  IncidentOccurrenceDayResponse,
  IncidentOccurrenceResponse,
} from "@/lib/api/contracts";
import { startOfUtcDay } from "@/lib/period/period";

/**
 * How incident occurrence is put into words and onto a scale. Presentation
 * only: every figure here is the API's, read as it was given. Nothing is
 * averaged, compared, or counted again — the one sum below is the
 * difference between two counts the API returned, said in words where it
 * declined to give a percentage.
 */

/**
 * Which way the period moved against the one before it, for a glyph. Never
 * a judgement: more incidents is information, not an error, so it takes no
 * colour of its own. Null where there is no movement to point at — no
 * comparison, or nothing before to move from.
 */
export type ChangeDirection = "up" | "down" | "same";

export interface Comparison {
  /** The comparison in a sentence: what assistive technology reads. */
  text: string;
  /**
   * What is shown beside the glyph: "33% vs previous 30 days" where the
   * API gave a percentage, since the glyph says which way; otherwise the
   * sentence itself.
   */
  short: string;
  direction: ChangeDirection | null;
}

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/**
 * The period against the one before it, in the API's own terms:
 *
 *   not comparable     history does not reach back that far — no claim
 *   none before        a percentage from nought is undefined; the fact
 *   a percentage       when the API gave one
 *   a difference       when it did not — too few before to be more than
 *                      noise — the counts themselves, in words
 */
export const describeComparison = ({
  declared,
  days,
  previous,
}: Pick<
  IncidentOccurrenceResponse,
  "declared" | "days" | "previous"
>): Comparison => {
  const than = `the previous ${days.length} days`;

  const sentence = (
    text: string,
    direction: ChangeDirection | null,
  ): Comparison => ({ text, short: text, direction });

  if (!previous.comparable) {
    return sentence(`No comparison yet: history does not cover ${than}`, null);
  }

  if (previous.declared === 0) {
    return sentence(
      declared === 0 ? `None in ${than} either` : `None in ${than}`,
      null,
    );
  }

  if (previous.changePercent !== null) {
    const change = previous.changePercent;
    const short = `${Math.abs(change)}% vs previous ${days.length} days`;

    if (change === 0) return sentence(`Same as ${than}`, "same");

    return change > 0
      ? { text: `${change}% more than ${than}`, short, direction: "up" }
      : { text: `${-change}% fewer than ${than}`, short, direction: "down" };
  }

  const difference = declared - previous.declared;
  const before = `(${previous.declared})`;

  if (difference === 0) return sentence(`Same as ${than} ${before}`, "same");

  return difference > 0
    ? sentence(`${difference} more than ${than} ${before}`, "up")
    : sentence(`${-difference} fewer than ${than} ${before}`, "down");
};

/**
 * The value the chart's top line stands for: a whole number of incidents,
 * never fewer than two — so one incident on a quiet month is a half-height
 * bar, not a wall — and rounded up to a number worth labelling. The average
 * line is on the same scale as the bars, so it is included.
 */
export const chartTop = (days: readonly IncidentOccurrenceDayResponse[]) => {
  const highest = Math.max(
    0,
    ...days.map((day) => Math.max(day.declared, day.rollingAverage ?? 0)),
  );
  const whole = Math.ceil(highest);

  if (whole <= 2) return 2;
  if (whole <= 5) return whole;
  if (whole <= 10) return whole + (whole % 2);

  return Math.ceil(whole / 5) * 5;
};

const SHORT_DAY = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

const TOOLTIP_DAY = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

const FULL_DAY = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

/** "23 Aug" — an axis label. */
export const shortDay = (date: string) => SHORT_DAY.format(startOfUtcDay(date));

/** "Thu 3 Sep" — a tooltip's heading. */
export const tooltipDay = (date: string) =>
  TOOLTIP_DAY.format(startOfUtcDay(date));

const AVERAGE = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });

/** An average as read, to one decimal place: "1.6", "0.1", "2". */
export const formatAverage = (value: number) => AVERAGE.format(value);

/** What was declared on a day, as a phrase: "3 incidents declared". */
export const declaredPhrase = (day: IncidentOccurrenceDayResponse) => {
  if (day.complete) {
    return day.declared === 0
      ? "No incidents declared"
      : `${plural(day.declared, "incident")} declared`;
  }

  return day.declared === 0
    ? "None declared so far"
    : `${plural(day.declared, "incident")} declared so far`;
};

/**
 * One day in a sentence, for anyone who cannot see the bar: the day, what
 * was declared, and the average where there is one. Today says it is today
 * and not over; a day before history says so, rather than "none".
 */
export const describeDay = (day: IncidentOccurrenceDayResponse) => {
  const date = FULL_DAY.format(startOfUtcDay(day.date));

  if (!day.tracked) return `${date}: before this organization's history.`;

  const heading = day.complete ? date : `Today, ${date}`;
  const average =
    day.rollingAverage === null
      ? ""
      : `, 7-day average ${formatAverage(day.rollingAverage)}`;

  return `${heading}: ${declaredPhrase(day)}${average}.`;
};
