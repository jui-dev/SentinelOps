"use client";

import { useQuery } from "@tanstack/react-query";

import { useMinuteClock } from "@/components/ui/timestamp";
import { getIncidentOccurrence } from "@/lib/api/endpoints";
import { queryKeys } from "@/lib/api/query-keys";
import { lastUtcDays } from "@/lib/period/period";

import { SUMMARY_DAYS } from "./use-current-operations";

/**
 * How often incidents were declared over the Overview's last thirty days,
 * and against which services — the answer Recent operational health reads.
 *
 * The same thirty whole UTC days, ending today, as the summary row's
 * "Resolved incidents": one "last 30 days" on the page, never two. It
 * follows the minute clock, so the period moves on at UTC midnight.
 *
 * Its own request, not a part of the summary's. The state now and how
 * often incidents occur are separate questions, answered separately, so
 * either can fail without taking the other with it.
 *
 * The answer is handed on as the API gave it. Every figure — the
 * comparison, incident-free days, the rolling average, the ranking — is the
 * API's judgement, and nothing here recomputes one.
 */
export const useIncidentOccurrence = (organizationId: string) => {
  const period = lastUtcDays(SUMMARY_DAYS, useMinuteClock());

  return useQuery({
    queryKey: queryKeys.incidentOccurrence(
      organizationId,
      period.from,
      period.to,
    ),
    queryFn: () => getIncidentOccurrence(organizationId, period),
  });
};

/** What the section is handed: the query, not its data. */
export type IncidentOccurrenceState = ReturnType<typeof useIncidentOccurrence>;
