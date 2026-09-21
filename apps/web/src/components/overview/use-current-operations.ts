"use client";

import { useQuery } from "@tanstack/react-query";

import { useMinuteClock } from "@/components/ui/timestamp";
import type { IncidentSummaryResponse } from "@/lib/api/contracts";
import { getIncidentSummary } from "@/lib/api/endpoints";
import { queryKeys } from "@/lib/api/query-keys";
import { lastUtcDays } from "@/lib/period/period";

/**
 * How many whole UTC days the Overview's one period covers, and so what
 * "Resolved incidents" counts. Thirty: long enough that a quiet week does
 * not read as nothing happening, short enough to still be recent work.
 */
export const SUMMARY_DAYS = 30;

/**
 * The state of incident response now, and how much was closed lately.
 *
 * The summary endpoint answers in two halves — the state now, and one
 * period's history — and the Overview reads a figure from each: `current`,
 * which does not depend on the period at all, and the period's `resolved`.
 *
 * So it asks for one period, the last thirty days, and takes both halves of
 * the one answer. Asking twice — once for the state and once for a month —
 * would run the whole transaction again to read a single number out of it.
 * `select` keeps the rest of the period, including its history preview,
 * from reaching the components: which incidents were declared or resolved
 * in a period is Incident history's question, on its own page.
 */
export const useCurrentOperations = (organizationId: string) => {
  const period = lastUtcDays(SUMMARY_DAYS, useMinuteClock());

  return useQuery({
    queryKey: queryKeys.incidentSummary(organizationId, period.from, period.to),
    queryFn: () => getIncidentSummary(organizationId, period),
    select: (summary: IncidentSummaryResponse) => ({
      ...summary.current,
      resolved: summary.period.resolved,
    }),
  });
};

/** What the Overview's sections are handed: the query, not its data. */
export type CurrentOperationsState = ReturnType<typeof useCurrentOperations>;
