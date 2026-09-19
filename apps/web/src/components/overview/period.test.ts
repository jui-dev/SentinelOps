import { describe, expect, it } from "vitest";

import { formatDays, presetPeriod } from "./period";

describe("the overview's periods", () => {
  // Late evening in New York is already the next day in UTC.
  const now = new Date("2026-09-19T02:30:00.000Z");

  it.each([
    ["today", { from: "2026-09-19", to: "2026-09-19" }],
    ["7d", { from: "2026-09-13", to: "2026-09-19" }],
    ["30d", { from: "2026-08-21", to: "2026-09-19" }],
  ] as const)("makes %s end today, counting today", (preset, expected) => {
    expect(presetPeriod(preset, now)).toEqual(expected);
  });

  it("says days in words", () => {
    expect(formatDays(1)).toBe("1 day");
    expect(formatDays(30)).toBe("30 days");
  });
});
