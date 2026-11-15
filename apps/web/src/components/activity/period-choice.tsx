"use client";

import { FilterGroup, FilterOption } from "@/components/ui/filter-bar";

import { PERIODS } from "./activity-meta";
import type { PeriodValue } from "./activity-meta";

/** Shortest first, so the track reads as a scale: 24 hours … All time. */
const ORDER: readonly PeriodValue[] = ["24h", "7d", "30d", "90d", "all"];

/**
 * How far back the log looks, as one track in the filter bar — each choice
 * is seen at once, not hidden in a menu. "Last" is the group's to say.
 */
export function PeriodChoice({
  value,
  onChange,
}: {
  value: PeriodValue;
  onChange: (value: PeriodValue) => void;
}) {
  return (
    <FilterGroup label="Period">
      {ORDER.map((each) => (
        <FilterOption key={each} pressed={value === each} onClick={() => onChange(each)}>
          {PERIODS.find(({ value: v }) => v === each)!.label.replace(/^Last /, "")}
        </FilterOption>
      ))}
    </FilterGroup>
  );
}
