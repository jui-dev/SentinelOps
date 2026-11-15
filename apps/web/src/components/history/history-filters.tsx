"use client";

import { X } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { useReplaceParams } from "@/components/incidents/incident-filters";
import { SEVERITY_LEVELS, SeverityGlyph } from "@/components/incidents/severity";
import { Button } from "@/components/ui/button";
import {
  FilterBar,
  FilterDivider,
  FilterGroup,
  FilterOption,
  FilterSearch,
} from "@/components/ui/filter-bar";
import type {
  IncidentHistoryFilters,
  IncidentHistoryShow,
  IncidentSeverity,
} from "@/lib/api/contracts";

/**
 * The history's filters, held in the page's URL beside its period, so a
 * narrowed history can be linked to and returned to: `q`, `severity`, and
 * `show` — `open` or `resolved`.
 */
const PARAMS = ["q", "severity", "show"] as const;

const SHOW_CHOICES: readonly { value: IncidentHistoryShow; label: string }[] = [
  { value: "open", label: "Still open" },
  { value: "resolved", label: "Resolved" },
];

const isSeverity = (value: string): value is IncidentSeverity =>
  SEVERITY_LEVELS.some((level) => level.value === value);

const isShow = (value: string): value is IncidentHistoryShow =>
  SHOW_CHOICES.some((choice) => choice.value === value);

/**
 * The filters the URL asks for, as the API takes them. A severity or a
 * `show` that can never apply is taken out of the URL, as a period the API
 * would refuse is.
 */
export const useHistoryFilters = () => {
  const searchParams = useSearchParams();
  const replace = useReplaceParams();

  const q = searchParams.get("q")?.trim() || undefined;
  const severity = searchParams.get("severity") ?? undefined;
  const show = searchParams.get("show") ?? undefined;

  const invalid = [
    ...(severity !== undefined && !isSeverity(severity) ? ["severity"] : []),
    ...(show !== undefined && !isShow(show) ? ["show"] : []),
  ];

  useEffect(() => {
    if (invalid.length > 0) {
      replace((params) => invalid.forEach((name) => params.delete(name)));
    }
    // Whether the address is wrong is what decides whether anything happens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invalid.join()]);

  const filters: IncidentHistoryFilters = {
    ...(q && { q }),
    ...(severity && isSeverity(severity) && { severity }),
    ...(show && isShow(show) && { show }),
  };

  return { filters, active: Object.keys(filters).length > 0 };
};

/**
 * Search, severity, and which of the period's incidents, in the filter bar
 * every list shares. Chips apply at
 * once, one of each at a time; the search when it is submitted. Each `show`
 * chip carries the period's own count, so what a choice leaves is known
 * before it is made.
 */
export function HistoryFilterBar({
  counts,
  active,
}: {
  /** The period's counts, once known: everything, still open, resolved. */
  counts?: { total: number; open: number; resolved: number };
  active: boolean;
}) {
  const searchParams = useSearchParams();
  const replace = useReplaceParams();

  const q = searchParams.get("q") ?? "";
  const [search, setSearch] = useState(q);
  const [shownQ, setShownQ] = useState(q);

  // The URL changed from elsewhere — cleared, or a link followed.
  if (q !== shownQ) {
    setShownQ(q);
    setSearch(q);
  }

  const set = (name: (typeof PARAMS)[number], value: string) =>
    replace((params) => {
      if (value) params.set(name, value);
      else params.delete(name);
    });


  const severity = searchParams.get("severity") ?? "";
  const show = searchParams.get("show") ?? "";

  return (
    <FilterBar
      label="Filter this period's incidents"
      end={
        active && (
          <Button
            icon={X}
            variant="quiet"
            size="sm"
            onClick={() =>
              replace((params) => PARAMS.forEach((name) => params.delete(name)))
            }
          >
            Clear filters
          </Button>
        )
      }
    >
      <FilterSearch
        id="history-search"
        label="Search"
        value={search}
        onChange={setSearch}
        onSubmit={() => set("q", search.trim())}
        placeholder="Title, or INC-42"
        maxLength={200}
      />
      <FilterDivider />
      <FilterGroup label="Severity">
        <FilterOption pressed={severity === ""} onClick={() => set("severity", "")}>
          Any
        </FilterOption>
        {SEVERITY_LEVELS.map((level) => (
          <FilterOption
            key={level.value}
            pressed={severity === level.value}
            onClick={() =>
              set("severity", severity === level.value ? "" : level.value)
            }
          >
            <SeverityGlyph severity={level.value} />
            {/* The space is for the name ("SEV1 Critical"); flex drops it. */}
            {level.value} <span className="sr-only">{level.label}</span>
          </FilterOption>
        ))}
      </FilterGroup>
      <FilterGroup label="Show">
        <FilterOption
          pressed={show === ""}
          onClick={() => set("show", "")}
          count={counts?.total}
        >
          Everything
        </FilterOption>
        {SHOW_CHOICES.map((choice) => (
          <FilterOption
            key={choice.value}
            pressed={show === choice.value}
            onClick={() =>
              set("show", show === choice.value ? "" : choice.value)
            }
            count={
              counts && (choice.value === "open" ? counts.open : counts.resolved)
            }
          >
            {choice.label}
          </FilterOption>
        ))}
      </FilterGroup>
    </FilterBar>
  );
}
