"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";

import { useOrganization } from "@/components/organizations/organization-scope";
import { ApiErrorCode, Permission } from "@/lib/api/contracts";
import type {
  EditIncidentAnalysisRequest,
  IncidentAnalysisResponse,
  PublishIncidentAnalysisRequest,
  ReassignIncidentAnalysisOwnerRequest,
  StartIncidentAnalysisRequest,
} from "@/lib/api/contracts";
import {
  editIncidentAnalysis,
  getIncidentAnalysis,
  publishIncidentAnalysis,
  reassignIncidentAnalysisOwner,
  startIncidentAnalysis,
} from "@/lib/api/endpoints";
import { isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";

/**
 * One incident's analysis: reading it, starting it, and the three writes to
 * a draft — its sections, its owner, and publishing it.
 *
 * One cache entry per incident, `incidentAnalysis`, holds the analysis, or
 * null when none has been started. Whatever shows the analysis reads it
 * there, and every write stores the API's answer there, so two views of one
 * analysis never disagree.
 *
 * Each write names the version it was based on, and the API refuses one
 * based on any other: nothing is overwritten that the writer had not read.
 * Refused, the analysis is fetched again — the authoritative state — and
 * the error stays on the mutation, for the view to say what happened. The
 * text the writer had not yet saved is the view's, never the cache's, so
 * nothing here can lose it.
 */

/**
 * Which of two states of one analysis to keep: the later version. A write's
 * answer and a fetch that began before it can arrive in either order; the
 * cache only ever moves forward, so an answer older than what it holds —
 * a draft the caller has since saved or published — never replaces it.
 */
export const laterAnalysis = (
  held: IncidentAnalysisResponse | null | undefined,
  next: IncidentAnalysisResponse | null,
): IncidentAnalysisResponse | null =>
  held && next && held.version > next.version ? held : next;

/**
 * The incident's analysis; null when none has been started. An incident
 * that is not there is still an error: only ANALYSIS_NOT_STARTED — which
 * the API gives once it has found the incident — means "none yet".
 *
 * Fetched again on returning to the tab once stale, as every query is, so
 * a change someone else made meanwhile is seen before the next write is
 * refused for it. `enabled: false` asks nothing: an active incident has no
 * analysis to ask about.
 */
export const useIncidentAnalysis = (
  organizationId: string,
  number: number,
  { enabled = true }: { enabled?: boolean } = {},
) =>
  useQuery({
    queryKey: queryKeys.incidentAnalysis(organizationId, number),
    queryFn: async () => {
      try {
        return await getIncidentAnalysis(organizationId, number);
      } catch (error) {
        if (
          isApiError(error, 404) &&
          error.code === ApiErrorCode.ANALYSIS_NOT_STARTED
        ) {
          return null;
        }

        throw error;
      }
    },
    structuralSharing: (held, next) =>
      laterAnalysis(
        held as IncidentAnalysisResponse | null | undefined,
        next as IncidentAnalysisResponse | null,
      ),
    enabled,
  });

/** Stores a write's answer, unless the cache already holds a later version. */
const storeAnalysis = (
  queryClient: QueryClient,
  organizationId: string,
  number: number,
  analysis: IncidentAnalysisResponse,
) =>
  queryClient.setQueryData<IncidentAnalysisResponse | null>(
    queryKeys.incidentAnalysis(organizationId, number),
    (held) => laterAnalysis(held, analysis),
  );

/** Fetches the analysis again: after a refusal, what it says now is the answer. */
const refetchAnalysis = (
  queryClient: QueryClient,
  organizationId: string,
  number: number,
) =>
  queryClient.invalidateQueries({
    queryKey: queryKeys.incidentAnalysis(organizationId, number),
  });

/**
 * Why the API refused a write to an analysis, for a view to explain it; or
 * undefined for anything else — a network failure, a validation error, or
 * an incident or member that has gone.
 *
 *   changed           someone else's write was accepted since this one's
 *                     version; nothing of this one was applied
 *   published         it was published meanwhile, and is final
 *   not-owner         the caller no longer may write it: it has another owner
 *   not-started       it has no analysis to write
 *   already-started   someone else started it first
 *   summary-required  publishing needs a summary
 *   not-resolved      the incident is not resolved, so no analysis can begin
 */
export type AnalysisRefusal =
  | "changed"
  | "published"
  | "not-owner"
  | "not-started"
  | "already-started"
  | "summary-required"
  | "not-resolved";

const REFUSALS: Record<string, AnalysisRefusal> = {
  [ApiErrorCode.ANALYSIS_CHANGED]: "changed",
  [ApiErrorCode.ANALYSIS_PUBLISHED]: "published",
  [ApiErrorCode.NOT_ANALYSIS_OWNER]: "not-owner",
  [ApiErrorCode.ANALYSIS_NOT_STARTED]: "not-started",
  [ApiErrorCode.ANALYSIS_ALREADY_STARTED]: "already-started",
  [ApiErrorCode.ANALYSIS_SUMMARY_REQUIRED]: "summary-required",
  [ApiErrorCode.INCIDENT_NOT_RESOLVED]: "not-resolved",
};

export const analysisRefusalOf = (
  error: unknown,
): AnalysisRefusal | undefined =>
  isApiError(error) && error.code !== undefined && Object.hasOwn(REFUSALS, error.code)
    ? REFUSALS[error.code]
    : undefined;

/**
 * After a write is refused: whatever it was refused for, the analysis is
 * fetched again. A new owner that is no longer a member stales the list of
 * members the owner was chosen from; an incident that has gone, or is not
 * resolved after all, stales the incident — and, beneath it, the analysis.
 */
const recover = (
  queryClient: QueryClient,
  organizationId: string,
  number: number,
  error: unknown,
) => {
  if (!isApiError(error) || error.statusCode >= 500) return;

  if (error.code === ApiErrorCode.MEMBERSHIP_NOT_FOUND) {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.memberships(organizationId),
      exact: true,
    });
  }

  if (
    error.code === ApiErrorCode.INCIDENT_NOT_FOUND ||
    error.code === ApiErrorCode.INCIDENT_NOT_RESOLVED
  ) {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.incident(organizationId, number),
    });
    return;
  }

  void refetchAnalysis(queryClient, organizationId, number);
};

/** The four writes share their cache behaviour: the answer is stored, a refusal recovered from. */
const useAnalysisWrite = <Body>(
  organizationId: string,
  number: number,
  write: (
    organizationId: string,
    number: number,
    body: Body,
  ) => Promise<IncidentAnalysisResponse>,
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: Body) => write(organizationId, number, body),
    onSuccess: (analysis) =>
      storeAnalysis(queryClient, organizationId, number, analysis),
    onError: (error) => recover(queryClient, organizationId, number, error),
  });
};

/**
 * Starts the resolved incident's analysis, owned by the caller or by the
 * member named. Someone else having started it first is refused
 * (already-started), and theirs is fetched.
 */
export const useStartIncidentAnalysis = (
  organizationId: string,
  number: number,
) =>
  useAnalysisWrite<StartIncidentAnalysisRequest | undefined>(
    organizationId,
    number,
    startIncidentAnalysis,
  );

/** Saves the sections named, based on the version the caller last read. */
export const useEditIncidentAnalysis = (organizationId: string, number: number) =>
  useAnalysisWrite<EditIncidentAnalysisRequest>(
    organizationId,
    number,
    editIncidentAnalysis,
  );

/** Hands the draft to another member, based on the version the caller last read. */
export const useReassignIncidentAnalysisOwner = (
  organizationId: string,
  number: number,
) =>
  useAnalysisWrite<ReassignIncidentAnalysisOwnerRequest>(
    organizationId,
    number,
    reassignIncidentAnalysisOwner,
  );

/** Publishes the draft exactly as it stands at the version the caller last read. */
export const usePublishIncidentAnalysis = (
  organizationId: string,
  number: number,
) =>
  useAnalysisWrite<PublishIncidentAnalysisRequest>(
    organizationId,
    number,
    publishIncidentAnalysis,
  );

/**
 * What the caller may do with one incident's analysis, from their
 * permissions and the analysis as last read — the API's own rules, so the
 * view offers only what would be accepted. Advice, like `useCan`: the API
 * decides every write.
 *
 *   canStart     none started yet, and the caller runs incidents'
 *                lifecycles (`incidents:manage`). Whether the incident is
 *                resolved is the view's to know: the analysis is only
 *                asked for once it is.
 *   canWrite     a draft, which the caller may edit and publish: they hold
 *                `incident-analyses:write`, and own it or hold
 *                `incidents:manage` — the API's mayWriteAnalysis.
 *   canReassign  a draft, and the caller holds `incidents:manage`.
 *   isOwner      the caller's membership owns it, draft or published.
 *
 * `analysis` undefined — not yet known — allows nothing.
 */
export interface AnalysisAccess {
  canStart: boolean;
  canWrite: boolean;
  canReassign: boolean;
  isOwner: boolean;
}

export const analysisAccess = (
  caller: { membershipId: string; permissions: readonly string[] },
  analysis: IncidentAnalysisResponse | null | undefined,
): AnalysisAccess => {
  const manages = caller.permissions.includes(Permission.INCIDENTS_MANAGE);
  const writes = caller.permissions.includes(
    Permission.INCIDENT_ANALYSES_WRITE,
  );
  const isOwner = analysis?.owner.membershipId === caller.membershipId;
  const draft = analysis?.status === "DRAFT";

  return {
    canStart: analysis === null && manages,
    canWrite: draft && writes && (manages || isOwner),
    canReassign: draft && manages,
    isOwner,
  };
};

/** `analysisAccess` for the caller's membership in the current organization. */
export const useAnalysisAccess = (
  analysis: IncidentAnalysisResponse | null | undefined,
): AnalysisAccess => {
  const { membership } = useOrganization();

  return analysisAccess(
    { membershipId: membership.id, permissions: membership.permissions },
    analysis,
  );
};
