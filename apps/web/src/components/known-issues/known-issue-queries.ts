"use client";

import { useQuery } from "@tanstack/react-query";

import { listKnownIssues } from "@/lib/api/endpoints";
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
