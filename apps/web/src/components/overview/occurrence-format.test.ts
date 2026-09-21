import { describe, expect, it } from "vitest";

import type {
  IncidentOccurrenceDayResponse,
  IncidentOccurrenceResponse,
} from "@/lib/api/contracts";

import {
  chartTop,
  declaredPhrase,
  describeComparison,
  describeDay,
  formatAverage,
} from "./occurrence-format";

const thirty = Array.from({ length: 30 }, () => ({}));

const compare = (
  declared: number,
  previous: Partial<IncidentOccurrenceResponse["previous"]>,
) =>
  describeComparison({
    declared,
    days: thirty as IncidentOccurrenceDayResponse[],
    previous: {
      from: "2026-07-22",
      to: "2026-08-20",
      declared: 0,
      comparable: true,
      minimumSample: 5,
      changePercent: null,
      ...previous,
    },
  });

const day = (
  overrides: Partial<IncidentOccurrenceDayResponse> = {},
): IncidentOccurrenceDayResponse => ({
  date: "2026-09-03",
  declared: 0,
  complete: true,
  tracked: true,
  rollingAverage: null,
  ...overrides,
});

describe("the comparison with the previous period", () => {
  it("gives the API's percentage, either way, short beside its glyph and whole in words", () => {
    expect(compare(16, { declared: 12, changePercent: 33 })).toEqual({
      text: "33% more than the previous 30 days",
      short: "33% vs previous 30 days",
      direction: "up",
    });
    expect(compare(6, { declared: 7, changePercent: -14 })).toEqual({
      text: "14% fewer than the previous 30 days",
      short: "14% vs previous 30 days",
      direction: "down",
    });
    expect(compare(8, { declared: 8, changePercent: 0 })).toEqual({
      text: "Same as the previous 30 days",
      short: "Same as the previous 30 days",
      direction: "same",
    });
  });

  it("says the difference in counts where the API gave no percentage", () => {
    expect(compare(8, { declared: 3 })).toEqual({
      text: "5 more than the previous 30 days (3)",
      // Never shortened into something that looks like a percentage.
      short: "5 more than the previous 30 days (3)",
      direction: "up",
    });
    expect(compare(1, { declared: 4 }).text).toBe(
      "3 fewer than the previous 30 days (4)",
    );
    expect(compare(2, { declared: 2 }).text).toBe(
      "Same as the previous 30 days (2)",
    );
  });

  it("never makes a percentage from nought", () => {
    // No glyph: there is nothing before to have moved from.
    expect(compare(3, { declared: 0 })).toEqual({
      text: "None in the previous 30 days",
      short: "None in the previous 30 days",
      direction: null,
    });
    expect(compare(0, { declared: 0 })).toEqual({
      text: "None in the previous 30 days either",
      short: "None in the previous 30 days either",
      direction: null,
    });
  });

  it("makes no claim when history does not reach the previous period", () => {
    expect(compare(5, { declared: 0, comparable: false })).toEqual({
      text: "No comparison yet: history does not cover the previous 30 days",
      short: "No comparison yet: history does not cover the previous 30 days",
      direction: null,
    });
    // Even with a count to hand: a partly tracked period is not compared.
    expect(compare(5, { declared: 9, comparable: false }).direction).toBeNull();
  });
});

describe("the top of the chart's scale", () => {
  it("is never below two, so one incident is not a wall", () => {
    expect(chartTop([day()])).toBe(2);
    expect(chartTop([day({ declared: 1 })])).toBe(2);
  });

  it("is the highest day, bar or average, rounded up to a whole count", () => {
    expect(chartTop([day({ declared: 3 })])).toBe(3);
    expect(chartTop([day({ declared: 1, rollingAverage: 2.4 })])).toBe(3);
    expect(chartTop([day({ declared: 7 })])).toBe(8);
    expect(chartTop([day({ declared: 23 })])).toBe(25);
  });
});

describe("a day in words", () => {
  it("says what was declared, and that today is not over", () => {
    expect(declaredPhrase(day())).toBe("No incidents declared");
    expect(declaredPhrase(day({ declared: 1 }))).toBe("1 incident declared");
    expect(declaredPhrase(day({ declared: 1, complete: false }))).toBe(
      "1 incident declared so far",
    );
    expect(declaredPhrase(day({ complete: false }))).toBe(
      "None declared so far",
    );
  });

  it("reads the average as given, to one decimal place", () => {
    expect(formatAverage(1.57)).toBe("1.6");
    expect(formatAverage(0.14)).toBe("0.1");
    expect(formatAverage(2)).toBe("2");
  });

  it("describes a day whole, and one before history as exactly that", () => {
    expect(describeDay(day({ declared: 2, rollingAverage: 0.43 }))).toBe(
      "Thursday, September 3: 2 incidents declared, 7-day average 0.4.",
    );
    expect(describeDay(day({ tracked: false }))).toBe(
      "Thursday, September 3: before this organization's history.",
    );
  });
});
