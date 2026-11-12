"use client";

import {
  keepPreviousData,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";

import type { ActivityFilters } from "@/lib/api/contracts";
import { getActivityEntry, listActivity } from "@/lib/api/endpoints";
import { queryKeys } from "@/lib/api/query-keys";

/**
 * The activity log, a page at a time, newest first. Changing a filter keeps
 * the rows on screen until the new ones arrive, so the table does not flash
 * empty between them. `fetchNextPage` shows older entries.
 */
export const useActivity = (
  organizationId: string,
  view: "changes" | "security",
  filters: ActivityFilters,
) =>
  useInfiniteQuery({
    queryKey: queryKeys.activityList(organizationId, view, { ...filters }),
    queryFn: ({ pageParam }) =>
      listActivity(organizationId, view, filters, pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    placeholderData: keepPreviousData,
  });

/** One entry in full, for its details window. */
export const useActivityEntry = (organizationId: string, entryId: string) =>
  useQuery({
    queryKey: queryKeys.activityEntry(organizationId, entryId),
    queryFn: () => getActivityEntry(organizationId, entryId),
  });
