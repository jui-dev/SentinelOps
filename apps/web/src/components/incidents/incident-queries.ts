"use client";

import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import { organizationPath } from "@/components/app/navigation";
import type {
  IncidentDetailResponse,
  IncidentPeriod,
  IncidentState,
} from "@/lib/api/contracts";
import {
  getIncident,
  getIncidentTimeline,
  listIncidents,
} from "@/lib/api/endpoints";
import { queryKeys } from "@/lib/api/query-keys";

export const incidentsHref = (orgSlug: string) =>
  `${organizationPath(orgSlug)}/incidents`;

export const incidentHref = (orgSlug: string, number: number) =>
  `${incidentsHref(orgSlug)}/${number}`;

/**
 * One state's incidents, a page at a time. `fetchNextPage` follows the API's
 * cursor; there is no page size or total here — both are the API's.
 */
export const useIncidentList = (
  organizationId: string,
  state: IncidentState,
  /** Narrows the list to one period of whole UTC days. */
  period?: IncidentPeriod,
) =>
  useInfiniteQuery({
    queryKey: queryKeys.incidentList(organizationId, state, period),
    queryFn: ({ pageParam }) =>
      listIncidents(organizationId, state, pageParam ?? undefined, period),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.page.cursor,
  });

/**
 * One incident, fetched by number. Not read from a list: lists are paged, so
 * an incident deep in history is in no cached page.
 */
export const useIncident = (organizationId: string, number: number) =>
  useQuery({
    queryKey: queryKeys.incident(organizationId, number),
    queryFn: () => getIncident(organizationId, number),
  });

/**
 * After an incident is declared or changed: its own entry holds the API's
 * answer, and both lists refetch — its status, severity, or team may have
 * moved it between them or within one — as do the overview's counts. Its
 * timeline refetches too: the change may have been recorded there.
 */
export const storeIncident = (
  queryClient: QueryClient,
  organizationId: string,
  incident: IncidentDetailResponse,
) => {
  queryClient.setQueryData(
    queryKeys.incident(organizationId, incident.number),
    incident,
  );
  void queryClient.invalidateQueries({
    queryKey: [...queryKeys.incidents(organizationId), "list"],
  });
  void queryClient.invalidateQueries({
    queryKey: [...queryKeys.incidents(organizationId), "summary"],
  });
  void queryClient.invalidateQueries({
    queryKey: queryKeys.incidentTimeline(organizationId, incident.number),
  });
};

/** One incident's timeline, oldest first. */
export const useIncidentTimeline = (organizationId: string, number: number) =>
  useQuery({
    queryKey: queryKeys.incidentTimeline(organizationId, number),
    queryFn: () => getIncidentTimeline(organizationId, number),
  });

/**
 * Everything incident-shaped in the organization is stale: after a change
 * to what incidents embed — a service's name, criticality, or archival, or a
 * team's name.
 */
export const useInvalidateIncidents = () => {
  const queryClient = useQueryClient();

  return (organizationId: string) =>
    queryClient.invalidateQueries({
      queryKey: queryKeys.incidents(organizationId),
    });
};
