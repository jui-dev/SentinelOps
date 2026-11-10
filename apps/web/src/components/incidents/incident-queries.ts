"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import { organizationPath } from "@/components/app/navigation";
import { useOrganization } from "@/components/organizations/organization-scope";
import { ApiErrorCode } from "@/lib/api/contracts";
import type {
  IncidentAttentionResponse,
  IncidentDetailResponse,
  IncidentFilters,
  IncidentPeriod,
  IncidentResponse,
  IncidentState,
  UpdateIncidentRequest,
} from "@/lib/api/contracts";
import {
  getIncident,
  getIncidentAttention,
  getIncidentParts,
  getIncidentTimeline,
  listIncidents,
  listMemberResponses,
  updateIncident,
} from "@/lib/api/endpoints";
import { isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";

export const incidentsHref = (orgSlug: string) =>
  `${organizationPath(orgSlug)}/incidents`;

export const incidentHref = (orgSlug: string, number: number) =>
  `${incidentsHref(orgSlug)}/${number}`;

/**
 * Incident history: part of the Incidents domain, so the rail keeps
 * Incidents current while it is open. A period may be named in the address.
 */
export const incidentHistoryHref = (
  orgSlug: string,
  period?: IncidentPeriod,
) =>
  `${incidentsHref(orgSlug)}/history${
    period ? `?from=${period.from}&to=${period.to}` : ""
  }`;

/**
 * How often a page others are working on is asked again while it is open:
 * the Incidents list, and an active incident with its timeline. Not while
 * the tab is hidden (TanStack's default); returning to it refetches what is
 * stale. Others' work changes these without anything happening in this tab.
 */
export const LIVE_POLL_MS = 15_000;

/**
 * One state's incidents, a page at a time. `fetchNextPage` follows the API's
 * cursor; there is no page size or total here — both are the API's.
 */
export const useIncidentList = (
  organizationId: string,
  state: IncidentState,
  /** Narrows the list to one period of whole UTC days. */
  period?: IncidentPeriod,
  /** Narrows it further: severity, service, team, and search. */
  filters: IncidentFilters = {},
  /** False asks nothing yet — while the filters are still being worked out. */
  enabled = true,
  /** Asks again every `LIVE_POLL_MS`: for the one view that keeps it live. */
  poll = false,
) =>
  useInfiniteQuery({
    queryKey: queryKeys.incidentList(organizationId, state, period, filters),
    refetchInterval: poll ? LIVE_POLL_MS : false,
    queryFn: ({ pageParam }) =>
      listIncidents(
        organizationId,
        state,
        pageParam ?? undefined,
        period,
        filters,
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.page.cursor,
    enabled,
  });

/**
 * One member's responses, a page at a time, the most recently started
 * first. `fetchNextPage` follows the API's cursor.
 */
export const useMemberResponses = (
  organizationId: string,
  membershipId: string,
) =>
  useInfiniteQuery({
    queryKey: queryKeys.memberResponses(organizationId, membershipId),
    queryFn: ({ pageParam }) =>
      listMemberResponses(organizationId, membershipId, pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.page.cursor,
  });

/**
 * One incident, fetched by number. Not read from a list: lists are paged, so
 * an incident deep in history is in no cached page.
 */
export const useIncident = (
  organizationId: string,
  number: number,
  { live = false }: { live?: boolean } = {},
) =>
  useQuery({
    queryKey: queryKeys.incident(organizationId, number),
    queryFn: () => getIncident(organizationId, number),
    // Live while it is active: once resolved it no longer changes.
    refetchInterval: (query) =>
      live && query.state.data?.status !== "RESOLVED" ? LIVE_POLL_MS : false,
  });

/** How often attention is asked again while something shows it. */
export const ATTENTION_POLL_MS = 30_000;

/**
 * The active incidents waiting on the caller now. Others' work — a
 * declaration, a teammate starting, the last response completing — changes
 * it without anything happening in this tab, so it is asked again every
 * `ATTENTION_POLL_MS`, and not while the tab is hidden (TanStack's default);
 * returning to the tab refetches it once it is stale. The caller's own
 * actions refetch it at once (see storeIncident).
 *
 * One component polls: the navigation rail, with `poll: true`, which is
 * mounted throughout the organization's workspace. TanStack runs an
 * interval per polling component, so any other reader — the Overview —
 * leaves `poll` off and takes each answer from the shared cache.
 *
 * `enabled: false` asks nothing: for chrome outside the organization scope,
 * until it knows the organization and that the caller reads incidents.
 */
/**
 * The caller's active incidents counted by their own part in each, kept
 * live as the Incidents page's lists are: it sizes that page's tabs and pills.
 */
export const useIncidentParts = (organizationId: string, enabled = true) =>
  useQuery({
    queryKey: queryKeys.incidentParts(organizationId),
    queryFn: () => getIncidentParts(organizationId),
    refetchInterval: LIVE_POLL_MS,
    enabled,
  });

export const useIncidentAttention = (
  organizationId: string,
  { enabled = true, poll = false }: { enabled?: boolean; poll?: boolean } = {},
) =>
  useQuery({
    queryKey: queryKeys.incidentAttention(organizationId),
    queryFn: () => getIncidentAttention(organizationId),
    refetchInterval: poll ? ATTENTION_POLL_MS : false,
    enabled,
  });

/**
 * How many incidents are waiting on the caller: every list their
 * permissions give them — ready to resolve, their teams' unclaimed ones,
 * their own responses under way — each incident once, however many lists
 * hold it (resolvable and reassigned to their team is one incident).
 */
export const attentionCount = ({
  manage,
  respond,
}: IncidentAttentionResponse): number =>
  new Set(
    [
      ...(manage?.readyToResolve ?? []),
      ...(respond?.needsYourTeam ?? []),
      ...(respond?.yourResponses ?? []),
    ].map(({ id }) => id),
  ).size;

/**
 * After an incident is declared or changed: its own entry holds the API's
 * answer, and both lists refetch — its status, severity, or team may have
 * moved it between them or within one — as do the overview's counts, and its
 * activity, since each of these writes a timeline entry, and how often
 * incidents occur, which a declaration changes. Its
 * timeline refetches too: the change may have been recorded there. So does
 * the caller's attention: declaring, reassigning, resolving, starting, or
 * completing each moves an incident into or out of someone's lists. And
 * members' responses: a start or a completion is one, and every response
 * embeds its incident.
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
    queryKey: [...queryKeys.incidents(organizationId), "activity"],
  });
  void queryClient.invalidateQueries({
    queryKey: [...queryKeys.incidents(organizationId), "occurrence"],
  });
  void queryClient.invalidateQueries({
    queryKey: queryKeys.incidentTimeline(organizationId, incident.number),
  });
  void queryClient.invalidateQueries({
    queryKey: queryKeys.incidentAttention(organizationId),
  });
  void queryClient.invalidateQueries({
    queryKey: [...queryKeys.incidents(organizationId), "member-responses"],
  });
};

/** One incident's timeline, oldest first; asked again while `live`. */
export const useIncidentTimeline = (
  organizationId: string,
  number: number,
  { live = false }: { live?: boolean } = {},
) =>
  useQuery({
    queryKey: queryKeys.incidentTimeline(organizationId, number),
    queryFn: () => getIncidentTimeline(organizationId, number),
    refetchInterval: live ? LIVE_POLL_MS : false,
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

/**
 * Changes the incident. The API's answer replaces the cached incident and the
 * lists refetch. Refused because it was resolved or has gone meanwhile: the
 * incident is fetched again, so the page shows why.
 */
export const useUpdateIncident = (incident: IncidentResponse) => {
  const organization = useOrganization();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: UpdateIncidentRequest) =>
      updateIncident(organization.id, incident.number, body),
    onSuccess: (updated) =>
      storeIncident(queryClient, organization.id, updated),
    onError: (error) => {
      if (isApiError(error, 404) || isApiError(error, 409)) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.incidents(organization.id),
        });
      }
    },
  });
};

/** A change refused because someone resolved the incident meanwhile. */
export const resolvedMeanwhile = (error: unknown) =>
  isApiError(error, 409) && error.code === ApiErrorCode.INCIDENT_RESOLVED;

export const RESOLVED_MEANWHILE_MESSAGE =
  "This incident was resolved by someone else, so it can no longer be changed. It has been refreshed.";
