import { describe, expect, it } from "vitest";

import {
  DAYS_IN_WEEK,
  monthLabels,
  moveFocus,
  toWeeks,
  WEEKDAYS,
  weekdayOf,
  yearOf,
  yearRange,
  yearWindow,
} from "./calendar";
import type { ActivityDay, ActivityLevel } from "./calendar";

const DAY_MS = 86_400_000;

/** `count` days from `from`, all quiet unless `levels` says otherwise. */
const run = (
  from: string,
  count: number,
  levels: Record<string, ActivityLevel> = {},
): ActivityDay[] =>
  Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.parse(`${from}T00:00:00.000Z`) + index * DAY_MS)
      .toISOString()
      .slice(0, 10);

    return { date, total: levels[date] ? levels[date] * 3 : 0, level: levels[date] ?? 0 };
  });

/** 2026-03-22 is a Sunday; 26 weeks of it end on Saturday 2026-09-19. */
const SUNDAY = "2026-03-22";
const WEEKS = 26;
const SIX_MONTHS = WEEKS * DAYS_IN_WEEK;

describe("weeks", () => {
  it("starts them on Sunday and ends them on Saturday", () => {
    expect(WEEKDAYS[0]).toBe("Sunday");
    expect(WEEKDAYS[DAYS_IN_WEEK - 1]).toBe("Saturday");
    expect(weekdayOf(SUNDAY)).toBe(0);
    expect(weekdayOf("2026-09-19")).toBe(6);
  });

  it("lays 26 weeks from a Sunday out as exactly 26 columns", () => {
    const weeks = toWeeks(run(SUNDAY, SIX_MONTHS));

    expect(weeks).toHaveLength(WEEKS);
    expect(weeks.every((week) => week.length === DAYS_IN_WEEK)).toBe(true);
    expect(weeks[0][0].date).toBe(SUNDAY);
    expect(weeks[0][6].date).toBe("2026-03-28");
    expect(weeks[WEEKS - 1][6].date).toBe("2026-09-19");
  });

  it("puts every date on its own weekday row", () => {
    const weeks = toWeeks(run(SUNDAY, SIX_MONTHS));

    for (const week of weeks) {
      week.forEach((cell, row) => {
        expect(weekdayOf(cell.date)).toBe(row);
      });
    }
  });

  it("runs a column down from Sunday to Saturday, a day at a time", () => {
    const [first] = toWeeks(run(SUNDAY, SIX_MONTHS));

    expect(first.map((cell) => cell.date)).toEqual([
      "2026-03-22",
      "2026-03-23",
      "2026-03-24",
      "2026-03-25",
      "2026-03-26",
      "2026-03-27",
      "2026-03-28",
    ]);
  });

  it("pads a range that does not begin on a Sunday back to one", () => {
    // 2026-03-25 is a Wednesday.
    const weeks = toWeeks(run("2026-03-25", 10));

    expect(weeks[0][0].date).toBe("2026-03-22");
    // The three days before the range have no square at all.
    expect(weeks[0].slice(0, 3).map((cell) => cell.kind)).toEqual([
      "blank",
      "blank",
      "blank",
    ]);
    expect(weeks[0][3]).toMatchObject({ kind: "day", date: "2026-03-25" });
  });

  it("holds nothing for no days at all", () => {
    expect(toWeeks([])).toEqual([]);
  });
});

describe("days that have not happened", () => {
  it("draws a day after today as still to come, not as a quiet one", () => {
    // A whole week of rows, read on the Wednesday.
    const weeks = toWeeks(run(SUNDAY, DAYS_IN_WEEK), { today: "2026-03-25" });

    expect(weeks[0].map((cell) => cell.kind)).toEqual([
      "day",
      "day",
      "day",
      "day",
      "future",
      "future",
      "future",
    ]);
  });

  it("marks today, and only today", () => {
    const weeks = toWeeks(run(SUNDAY, DAYS_IN_WEEK), { today: "2026-03-25" });

    expect(
      weeks[0]
        .filter((cell) => cell.kind === "day")
        .map((cell) => [cell.date, cell.today]),
    ).toEqual([
      ["2026-03-22", false],
      ["2026-03-23", false],
      ["2026-03-24", false],
      ["2026-03-25", true],
    ]);
  });

  it("treats the last day given as today when none is named", () => {
    const weeks = toWeeks(run(SUNDAY, 3));

    expect(weeks[0].slice(0, 3).map((cell) => cell.kind)).toEqual([
      "day",
      "day",
      "day",
    ]);
    // Nothing is known past the last day given, so it is the last day.
    expect(weeks[0][3].kind).toBe("blank");
  });
});

describe("month labels", () => {
  it("names each month above the column it begins in", () => {
    const labels = monthLabels(toWeeks(run(SUNDAY, SIX_MONTHS)));

    // March to September across 26 weeks, each named once.
    expect(labels.map(({ label }) => label)).toHaveLength(7);
    expect(new Set(labels.map(({ label }) => label)).size).toBe(7);
    // Columns rise, and never repeat.
    expect(labels.map(({ week }) => week)).toEqual(
      [...labels.map(({ week }) => week)].sort((a, b) => a - b),
    );
  });

  it("names a month at the column whose Sunday first belongs to it", () => {
    // The week of 2026-03-29 is the first whose Sunday is in a new month
    // only at 2026-04-05; 2026-03-29 is still March.
    const labels = monthLabels(toWeeks(run(SUNDAY, SIX_MONTHS)));
    const april = labels.find(({ label }) => label === "Apr");

    expect(april?.week).toBe(2);
    expect(toWeeks(run(SUNDAY, SIX_MONTHS))[2][0].date).toBe("2026-04-05");
  });

  it("leaves the leftmost column unnamed when its month ends at once", () => {
    // Starting on 2026-03-29, the first column is the last of March and the
    // second begins April: naming both would put the two names side by side.
    const labels = monthLabels(toWeeks(run("2026-03-29", SIX_MONTHS)));

    expect(labels[0]).toMatchObject({ week: 1, label: "Apr" });
  });

  it("names the leftmost column when its month carries on", () => {
    const labels = monthLabels(toWeeks(run(SUNDAY, SIX_MONTHS)));

    expect(labels[0]).toMatchObject({ week: 0, label: "Mar" });
  });
});

describe("moving between days", () => {
  const dates = run(SUNDAY, SIX_MONTHS).map((day) => day.date);

  it("goes a day down the column and a day up it", () => {
    expect(moveFocus(dates, "2026-03-25", "ArrowDown")).toBe("2026-03-26");
    expect(moveFocus(dates, "2026-03-25", "ArrowUp")).toBe("2026-03-24");
  });

  it("carries on into the next column at a week's edge", () => {
    // Saturday down to the next Sunday, and back up again.
    expect(moveFocus(dates, "2026-03-28", "ArrowDown")).toBe("2026-03-29");
    expect(moveFocus(dates, "2026-03-29", "ArrowUp")).toBe("2026-03-28");
  });

  it("goes a week across, keeping the weekday", () => {
    expect(moveFocus(dates, "2026-03-25", "ArrowRight")).toBe("2026-04-01");
    expect(moveFocus(dates, "2026-04-01", "ArrowLeft")).toBe("2026-03-25");
    expect(weekdayOf("2026-03-25")).toBe(weekdayOf("2026-04-01"));
  });

  it("goes to the first day and the last", () => {
    expect(moveFocus(dates, "2026-05-01", "Home")).toBe(SUNDAY);
    expect(moveFocus(dates, "2026-05-01", "End")).toBe("2026-09-19");
  });

  it("stops at either end rather than wrapping round", () => {
    expect(moveFocus(dates, SUNDAY, "ArrowUp")).toBe(SUNDAY);
    expect(moveFocus(dates, SUNDAY, "ArrowLeft")).toBe(SUNDAY);
    expect(moveFocus(dates, "2026-09-19", "ArrowDown")).toBe("2026-09-19");
    expect(moveFocus(dates, "2026-09-19", "ArrowRight")).toBe("2026-09-19");
  });

  it("ignores a key that moves nothing", () => {
    expect(moveFocus(dates, SUNDAY, "PageDown")).toBeUndefined();
    expect(moveFocus(dates, SUNDAY, "a")).toBeUndefined();
    expect(moveFocus([], SUNDAY, "ArrowDown")).toBeUndefined();
  });
});

describe("a calendar year", () => {
  /** 2026 is not a leap year: 365 days, 1 January a Thursday. */
  const YEAR = 2026;
  const DAYS_IN_2026 = 365;

  it("knows the year a moment falls in, in UTC", () => {
    expect(yearOf(new Date("2026-09-20T12:00:00.000Z"))).toBe(2026);
    // The last instant of the year, and the first of the next.
    expect(yearOf(new Date("2026-12-31T23:59:59.999Z"))).toBe(2026);
    expect(yearOf(new Date("2027-01-01T00:00:00.000Z"))).toBe(2027);
  });

  it("spans January to December", () => {
    expect(yearRange(YEAR)).toEqual({ from: "2026-01-01", to: "2026-12-31" });
  });

  it("asks only for the days that have happened", () => {
    expect(yearWindow(YEAR, new Date("2026-09-20T12:00:00.000Z"))).toEqual({
      from: "2026-01-01",
      to: "2026-09-20",
    });
  });

  it("asks a year that is over for the whole of it", () => {
    expect(yearWindow(2025, new Date("2026-09-20T12:00:00.000Z"))).toEqual({
      from: "2025-01-01",
      to: "2025-12-31",
    });
  });

  it("never asks for more days than the route allows", () => {
    // A leap year, asked for whole: 366 days, which is the limit exactly.
    const window = yearWindow(2028, new Date("2029-01-02T00:00:00.000Z"));
    const days =
      (Date.parse(`${window.to}T00:00:00Z`) -
        Date.parse(`${window.from}T00:00:00Z`)) /
        86_400_000 +
      1;

    expect(days).toBe(366);
  });

  it("lays the whole year out as whole weeks, past and future alike", () => {
    // Only the year so far has rows; the rest is still to come.
    const sofar = run("2026-01-01", 262);
    const weeks = toWeeks(sofar, {
      today: "2026-09-19",
      range: yearRange(YEAR),
    });

    // 1 January 2026 is a Thursday, so the first column opens in December.
    expect(weeks[0][0].date).toBe("2025-12-28");
    expect(weeks.at(-1)?.at(-1)?.date).toBe("2027-01-02");
    expect(weeks.every((week) => week.length === DAYS_IN_WEEK)).toBe(true);

    const cells = weeks.flat();

    // Every day of the year has a square, and none of them is blank.
    const ofYear = cells.filter((cell) => cell.date.startsWith("2026-"));

    expect(ofYear).toHaveLength(DAYS_IN_2026);
    expect(ofYear.some((cell) => cell.kind === "blank")).toBe(false);

    // The days of the neighbouring years are not drawn.
    expect(
      cells
        .filter((cell) => !cell.date.startsWith("2026-"))
        .every((cell) => cell.kind === "blank"),
    ).toBe(true);
  });

  it("tells the year's past days from the ones still to come", () => {
    const weeks = toWeeks(run("2026-01-01", 262), {
      today: "2026-09-19",
      range: yearRange(YEAR),
    });
    const ofYear = weeks.flat().filter((cell) => cell.date.startsWith("2026-"));

    expect(ofYear.filter((cell) => cell.kind === "day")).toHaveLength(262);
    expect(ofYear.filter((cell) => cell.kind === "future")).toHaveLength(
      DAYS_IN_2026 - 262,
    );
    // The first of them is the day after today, and the last is New Year's Eve.
    const future = ofYear.filter((cell) => cell.kind === "future");

    expect(future[0].date).toBe("2026-09-20");
    expect(future.at(-1)?.date).toBe("2026-12-31");
  });

  it("names all twelve months, each above where it begins", () => {
    const labels = monthLabels(
      toWeeks(run("2026-01-01", 262), {
        today: "2026-09-19",
        range: yearRange(YEAR),
      }),
    );

    expect(labels.map(({ label }) => label)).toEqual([
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ]);
    expect(labels.map(({ month }) => month)).toEqual(
      Array.from(
        { length: 12 },
        (_, index) => `2026-${String(index + 1).padStart(2, "0")}`,
      ),
    );
    // Each name sits above a column whose Sunday is in its own month.
    expect(labels.map(({ week }) => week)).toEqual(
      [...labels.map(({ week }) => week)].sort((a, b) => a - b),
    );
  });
});
