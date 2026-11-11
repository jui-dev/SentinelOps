"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type {
  CreateKnownIssueRequest,
  MergeKnownIssueRequest,
  UpdateKnownIssueRequest,
} from "@/lib/api/contracts";
import {
  createKnownIssue,
  listKnownIssues,
  mergeKnownIssue,
  updateKnownIssue,
} from "@/lib/api/endpoints";
import { queryKeys } from "@/lib/api/query-keys";

/**
 * One service's known issues, most frequent first, as declaring offers
 * them. Asked only once a service is chosen; keyed under the organization's
 * known issues, so any change to them refreshes every service's list.
 */
export const useServiceKnownIssues = (
  organizationId: string,
  serviceId: string | undefined,
) =>
  useQuery({
    queryKey: [...queryKeys.knownIssues(organizationId), "service", serviceId],
    queryFn: () => listKnownIssues(organizationId, { serviceId }),
    enabled: Boolean(serviceId),
  });

/** Every service's known issues, archived ones too: the Known issues page. */
export const useAllKnownIssues = (organizationId: string) =>
  useQuery({
    queryKey: [...queryKeys.knownIssues(organizationId), "all"],
    queryFn: () => listKnownIssues(organizationId, { archived: "include" }),
  });

/**
 * After any change to a known issue: every list of them, and the incidents,
 * which name theirs — a merge moves some to another.
 */
const useRefresh = (organizationId: string) => {
  const queryClient = useQueryClient();

  return () => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.knownIssues(organizationId),
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.incidents(organizationId),
    });
  };
};

export const useCreateKnownIssue = (organizationId: string) => {
  const refresh = useRefresh(organizationId);

  return useMutation({
    mutationFn: (body: CreateKnownIssueRequest) =>
      createKnownIssue(organizationId, body),
    onSuccess: refresh,
  });
};

export const useUpdateKnownIssue = (organizationId: string) => {
  const refresh = useRefresh(organizationId);

  return useMutation({
    mutationFn: ({ id, ...body }: UpdateKnownIssueRequest & { id: string }) =>
      updateKnownIssue(organizationId, id, body),
    onSuccess: refresh,
  });
};

export const useMergeKnownIssue = (organizationId: string) => {
  const refresh = useRefresh(organizationId);

  return useMutation({
    mutationFn: ({ id, ...body }: MergeKnownIssueRequest & { id: string }) =>
      mergeKnownIssue(organizationId, id, body),
    onSuccess: refresh,
  });
};
