"use client";

import {
  Search,
  X,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { FilterChip, useReplaceParams } from "@/components/incidents/incident-filters";
import { SEVERITY_LEVELS, SeverityGlyph } from "@/components/incidents/severity";
import { Button } from "@/components/ui/button";
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
 * Search, severity, and which of the period's incidents, in a band of the
 * rail's own ground, as the Incidents page's filters are. Chips apply at
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

  const onSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    set("q", search.trim());
  };

  const severity = searchParams.get("severity") ?? "";
  const show = searchParams.get("show") ?? "";

  return (
    <div
      role="search"
      aria-label="Filter this period's incidents"
      className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-lg border border-line-subtle bg-linear-to-b from-rail-top to-rail-mid p-3"
    >
      <form
        onSubmit={onSearch}
        className="flex w-full items-center gap-2 sm:w-auto sm:basis-72"
      >
        <div className="relative min-w-0 flex-1">
          <label htmlFor="history-search" className="sr-only">
            Search
          </label>
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-fg-subtle"
          />
          <input
            id="history-search"
            name="q"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Title, or INC-42"
            maxLength={200}
            autoComplete="off"
            className="h-9 w-full rounded-md border border-line-control bg-field pr-3 pl-9 text-sm text-fg placeholder:text-fg-subtle focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
          />
        </div>
        <Button icon={Search} type="submit" variant="secondary">
          Search
        </Button>
      </form>
      <div role="group" aria-label="Severity" className="flex flex-wrap gap-1.5">
        <FilterChip pressed={severity === ""} onClick={() => set("severity", "")}>
          Any
        </FilterChip>
        {SEVERITY_LEVELS.map((level) => (
          <FilterChip
            key={level.value}
            pressed={severity === level.value}
            onClick={() =>
              set("severity", severity === level.value ? "" : level.value)
            }
          >
            <SeverityGlyph severity={level.value} />
            {/* The space is for the name ("SEV1 Critical"); flex drops it. */}
            {level.value} <span className="sr-only">{level.label}</span>
          </FilterChip>
        ))}
      </div>
      <span aria-hidden="true" className="hidden h-5 w-px bg-line sm:block" />
      <div role="group" aria-label="Show" className="flex flex-wrap gap-1.5">
        <FilterChip pressed={show === ""} onClick={() => set("show", "")}>
          Everything
          {counts && <ChipCount value={counts.total} />}
        </FilterChip>
        {SHOW_CHOICES.map((choice) => (
          <FilterChip
            key={choice.value}
            pressed={show === choice.value}
            onClick={() =>
              set("show", show === choice.value ? "" : choice.value)
            }
          >
            {choice.label}
            {counts && (
              <ChipCount
                value={choice.value === "open" ? counts.open : counts.resolved}
              />
            )}
          </FilterChip>
        ))}
      </div>
      {active && (
        <span className="ml-auto">
          <Button icon={X}
            variant="quiet"
            size="sm"
            onClick={() =>
              replace((params) => PARAMS.forEach((name) => params.delete(name)))
            }
          >
            Clear filters
          </Button>
        </span>
      )}
    </div>
  );
}

/** A chip's count: quieter than its label, and read as part of its name. */
function ChipCount({ value }: { value: number }) {
  return (
    <>
      {" "}
      <span className="numeric text-xs opacity-75">{value}</span>
    </>
  );
}
