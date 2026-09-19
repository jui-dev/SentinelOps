import { describe, expect, it } from "vitest";

import {
  formatPeriodRange,
  periodDays,
  readPeriodParams,
  utcDay,
} from "./period";

describe("periods", () => {
  it("reads the day in UTC, whatever the local zone", () => {
    // Late evening in New York is already the next day in UTC.
    expect(utcDay(new Date("2026-09-19T02:30:00.000Z"))).toBe("2026-09-19");
  });

  it("counts both ends of a period, across months and leap days", () => {
    expect(periodDays({ from: "2026-09-19", to: "2026-09-19" })).toBe(1);
    expect(periodDays({ from: "2024-02-28", to: "2024-03-01" })).toBe(3);
    expect(periodDays({ from: "2025-09-19", to: "2026-09-19" })).toBe(366);
  });

  describe("a range from a URL", () => {
    it("is no filter when neither end is given", () => {
      expect(readPeriodParams(null, null)).toEqual({ invalid: false });
    });

    it("is a period when both ends make one the API accepts", () => {
      expect(readPeriodParams("2026-09-12", "2026-09-18")).toEqual({
        period: { from: "2026-09-12", to: "2026-09-18" },
        invalid: false,
      });
      expect(readPeriodParams("2025-09-19", "2026-09-19").invalid).toBe(false);
    });

    it.each([
      ["one end alone", "2026-09-12", null],
      ["the other end alone", null, "2026-09-18"],
      ["an end before its start", "2026-09-18", "2026-09-12"],
      ["a date that does not exist", "2026-02-30", "2026-03-02"],
      ["something that is not a date", "yesterday", "2026-09-18"],
      ["367 days", "2025-09-18", "2026-09-19"],
    ])("is invalid with %s", (_, from, to) => {
      expect(readPeriodParams(from, to)).toEqual({ invalid: true });
    });
  });

  it("says a range compactly, naming the year once", () => {
    const range = formatPeriodRange({ from: "2026-09-12", to: "2026-09-18" });

    // The digits, whichever way the locale orders day and month.
    expect(range).toMatch(/12.*18.*2026/);
    expect(range.match(/2026/g)).toHaveLength(1);
    expect(formatPeriodRange({ from: "2025-12-30", to: "2026-01-02" }).match(/20\d\d/g)).toEqual([
      "2025",
      "2026",
    ]);
  });
});
