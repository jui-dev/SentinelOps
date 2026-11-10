import { describe, expect, it } from "vitest";

import { DAYS_IN_WEEK, isWeekend, WEEKDAYS, weekdayOf } from "./week";

describe("the week, as Bangladesh keeps it", () => {
  it("runs Saturday to Friday", () => {
    expect(WEEKDAYS).toEqual([
      "Saturday",
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
    ]);
    expect(DAYS_IN_WEEK).toBe(7);
  });

  it("places a date by its own UTC weekday, Saturday first", () => {
    // 7 November 2026 is a Saturday; the 13th is the Friday after.
    expect(weekdayOf("2026-11-07")).toBe(0);
    expect(weekdayOf("2026-11-08")).toBe(1);
    expect(weekdayOf("2026-11-13")).toBe(6);
  });

  it("keeps Friday and Saturday as the weekend, and Sunday as a working day", () => {
    expect(isWeekend("2026-11-06")).toBe(true);
    expect(isWeekend("2026-11-07")).toBe(true);
    expect(isWeekend("2026-11-08")).toBe(false);
    expect(isWeekend("2026-11-05")).toBe(false);
  });
});
