import type { IncidentPeriod } from "@/lib/api/contracts";
import { startOfUtcDay, utcDay } from "@/lib/period/period";

/**
 * Incident history's period controls: its presets, the choices its tabs
 * offer, and how it says a period's length. What a period is — whole UTC
 * days — lives in lib/period, shared with every other page that takes one.
 */

export type PeriodPreset = "today" | "7d" | "30d";
export type PeriodChoice = PeriodPreset | "custom";

export const PERIOD_CHOICES: ReadonlyArray<{
  value: PeriodChoice;
  label: string;
}> = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "custom", label: "Custom" },
];

const PRESET_DAYS: Record<PeriodPreset, number> = {
  today: 1,
  "7d": 7,
  "30d": 30,
};

const DAY_MS = 86_400_000;

const addDays = (day: string, days: number): string =>
  utcDay(new Date(startOfUtcDay(day).getTime() + days * DAY_MS));

/** What the page shows when its address names no period. */
export const DEFAULT_PRESET: PeriodPreset = "7d";

/** A preset's period: its days up to and including today. */
export const presetPeriod = (
  preset: PeriodPreset,
  now: Date,
): IncidentPeriod => {
  const to = utcDay(now);

  return { from: addDays(to, 1 - PRESET_DAYS[preset]), to };
};

/**
 * The preset a period *is*, if it is one of them, so a period arrived at by
 * link selects the tab a person would have clicked to reach it. Anything
 * else — a range not ending today, or of another length — is custom.
 */
export const presetFor = (
  period: IncidentPeriod,
  now: Date,
): PeriodPreset | undefined =>
  (Object.keys(PRESET_DAYS) as PeriodPreset[]).find((preset) => {
    const candidate = presetPeriod(preset, now);

    return candidate.from === period.from && candidate.to === period.to;
  });

/** "1 day", "7 days". */
export const formatDays = (days: number): string =>
  `${days} ${days === 1 ? "day" : "days"}`;
