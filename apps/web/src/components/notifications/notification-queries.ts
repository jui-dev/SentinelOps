"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { InfiniteData, QueryClient } from "@tanstack/react-query";

import type {
  NotificationResponse,
  NotificationUnreadCountResponse,
  Page,
} from "@/lib/api/contracts";
import {
  getUnreadNotificationCount,
  listNotifications,
  markNotificationRead,
  markNotificationsReadThrough,
} from "@/lib/api/endpoints";
import { isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";

/**
 * The caller's notifications in one organization: how many are unread, the
 * pages of them, and acknowledging them.
 *
 * Everything is keyed by organization, so another organization's count or
 * rows are never shown, and switching organizations starts clean. The
 * caller is never told of their own actions, so nothing they do elsewhere
 * stales these: they change by polling and by acknowledging.
 */

/** How often the unread count is asked again while something shows it. */
export const NOTIFICATION_POLL_MS = 30_000;

type NotificationPages = InfiniteData<Page<NotificationResponse>, string | null>;

/**
 * How many of the caller's notifications are unread. Others' changes add
 * to it without anything happening in this tab, so with `poll` it is asked
 * again every `NOTIFICATION_POLL_MS` — not while the tab is hidden
 * (TanStack's default), and once more on returning to it.
 *
 * One component polls: the bell, mounted throughout the organization.
 * `enabled: false` asks nothing: until the organization is known and the
 * caller may read notifications.
 */
export const useUnreadNotificationCount = (
  organizationId: string,
  { enabled = true, poll = false }: { enabled?: boolean; poll?: boolean } = {},
) =>
  useQuery({
    queryKey: queryKeys.unreadNotificationCount(organizationId),
    queryFn: () => getUnreadNotificationCount(organizationId),
    refetchInterval: poll ? NOTIFICATION_POLL_MS : false,
    enabled,
  });

/**
 * The caller's notifications, a page at a time, newest first;
 * `fetchNextPage` follows the API's cursor.
 *
 * Fetched afresh whenever something showing it mounts — the panel opening —
 * and otherwise left alone: not on window focus, and never by polling, so an
 * open list does not reshuffle under the pointer. Whether more have arrived
 * meanwhile is the unread count's to say.
 */
export const useNotificationList = (
  organizationId: string,
  { enabled = true }: { enabled?: boolean } = {},
) =>
  useInfiniteQuery({
    queryKey: queryKeys.notificationList(organizationId),
    queryFn: ({ pageParam }) =>
      listNotifications(organizationId, pageParam ?? undefined),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.page.cursor,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    enabled,
  });

/** Every loaded notification, in list order, each passed through `update`. */
const updateLoaded = (
  queryClient: QueryClient,
  organizationId: string,
  update: (notification: NotificationResponse) => NotificationResponse,
) =>
  queryClient.setQueryData<NotificationPages>(
    queryKeys.notificationList(organizationId),
    (data) =>
      data && {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          items: page.items.map(update),
        })),
      },
  );

const setUnreadCount = (
  queryClient: QueryClient,
  organizationId: string,
  update: (count: number) => number,
) =>
  queryClient.setQueryData<NotificationUnreadCountResponse>(
    queryKeys.unreadNotificationCount(organizationId),
    (data) => data && { count: update(data.count) },
  );

/**
 * Acknowledges one notification — the one the caller has just chosen, and
 * is on their way to. Optimistic, so the row and the count change at once
 * while navigation goes ahead without waiting: the row reads as read, and
 * the count goes down by one. The API's answer then replaces the row, with
 * the time it recorded, and the count is asked again.
 *
 * If it fails — the network, or a notification that has gone with its team
 * — nothing is said: the list and the count are fetched again, and the row
 * reads as unread once more if it still exists. An already-read
 * notification is not anticipated; the API leaves it as it was.
 */
export const useMarkNotificationRead = (organizationId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (notification: NotificationResponse) =>
      markNotificationRead(organizationId, notification.id),
    onMutate: async (notification) => {
      if (notification.readAt !== null) return;

      // A fetch in flight would land over the change being anticipated.
      await queryClient.cancelQueries({
        queryKey: queryKeys.notifications(organizationId),
      });

      const readAt = new Date().toISOString();
      let marked = false;

      updateLoaded(queryClient, organizationId, (row) => {
        if (row.id !== notification.id || row.readAt !== null) return row;

        marked = true;

        return { ...row, readAt };
      });

      if (marked) {
        setUnreadCount(queryClient, organizationId, (count) =>
          Math.max(0, count - 1),
        );
      }
    },
    onSuccess: (read) =>
      updateLoaded(queryClient, organizationId, (row) =>
        row.id === read.id ? read : row,
      ),
    onError: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.notifications(organizationId),
      }),
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.unreadNotificationCount(organizationId),
      }),
  });
};

/**
 * "Mark all as read": acknowledges every notification up to and including
 * `through`, the newest one loaded. The API leaves anything newer unread —
 * one that arrived while the list was open, and was never seen — so this
 * marks read only the rows at or below `through` in the loaded list, and
 * takes the unread count from the API's answer.
 *
 * A `through` that has gone meanwhile (its team deleted) is 404: the list
 * and the count are fetched again, and the error is left on the mutation
 * for the panel to say the list changed.
 */
export const useMarkNotificationsReadThrough = (organizationId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (through: string) =>
      markNotificationsReadThrough(organizationId, through),
    onSuccess: ({ count }, through) => {
      const readAt = new Date().toISOString();
      let reached = false;

      // Newest first: from `through` on, every row is at or before it.
      updateLoaded(queryClient, organizationId, (row) => {
        reached ||= row.id === through;

        return reached && row.readAt === null ? { ...row, readAt } : row;
      });
      setUnreadCount(queryClient, organizationId, () => count);
    },
    onError: (error) => {
      if (isApiError(error, 404)) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.notifications(organizationId),
        });
      }
    },
  });
};
