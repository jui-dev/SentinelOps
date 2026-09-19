import type { IncidentPeriod } from "@/lib/api/contracts";
import { startOfUtcDay, utcDay } from "@/lib/period/period";

/**
 * The overview's period controls: its presets, the choices its tabs offer,
 * and how it says a period's length. What a period is — whole UTC days —
 * lives in lib/period, shared with every other page that takes one.
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

/** A preset's period: its days up to and including today. */
export const presetPeriod = (
  preset: PeriodPreset,
  now: Date,
): IncidentPeriod => {
  const to = utcDay(now);

  return { from: addDays(to, 1 - PRESET_DAYS[preset]), to };
};

/** "1 day", "7 days". */
export const formatDays = (days: number): string =>
  `${days} ${days === 1 ? "day" : "days"}`;
