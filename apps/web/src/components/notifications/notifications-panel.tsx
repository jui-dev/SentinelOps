"use client";

import { useQueryClient } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";

import { useMinuteClock } from "@/components/ui/timestamp";
import type { NotificationResponse, Page } from "@/lib/api/contracts";
import { isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";

import { NotificationRow } from "./notification-row";
import {
  useMarkNotificationRead,
  useMarkNotificationsReadThrough,
  useNotificationList,
  useUnreadNotificationCount,
} from "./notification-queries";

const textButtonClasses =
  "rounded-sm text-xs font-medium text-accent-text underline-offset-2 hover:underline disabled:text-fg-disabled disabled:no-underline";

/** Keeps only the first page: reopening then fetches one page, not every one. */
const firstPageOnly = (
  data: InfiniteData<Page<NotificationResponse>, string | null> | undefined,
) =>
  data && {
    pages: data.pages.slice(0, 1),
    pageParams: data.pageParams.slice(0, 1),
  };

/**
 * The caller's notifications, newest first, as the bell opens them.
 *
 * Opening reads nothing. Following a row reads that one; "Mark all as read"
 * reads everything up to the newest row shown, and nothing newer.
 *
 * The list is loaded once per opening and then left alone, so rows never
 * move under the pointer. Whether more have arrived since is the unread
 * count's to say: the count is asked first and taken as a baseline, then
 * the list — so something arriving in between is shown, never missed — and
 * a count that later rises above the baseline offers "New notifications".
 * The baseline follows the caller's own acknowledgements down: marking read
 * lowers the count, and the baseline with it, so that is never mistaken for
 * an arrival.
 */
export function NotificationsPanel({
  organizationId,
  orgSlug,
  titleId,
  onClose,
}: {
  organizationId: string;
  orgSlug: string;
  /** The heading's id, which names the popover. */
  titleId: string;
  /** Closes the panel, as following a row does. */
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const now = useMinuteClock();
  const count = useUnreadNotificationCount(organizationId);
  const [loaded, setLoaded] = useState(false);
  const list = useNotificationList(organizationId, { enabled: loaded });
  const markRead = useMarkNotificationRead(organizationId);
  const readThrough = useMarkNotificationsReadThrough(organizationId);
  const [baseline, setBaseline] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const refetchCount = count.refetch;
  const refetchList = list.refetch;

  /**
   * The count, then the list, then the count as the baseline. Returns a
   * function that stops a load still under way from settling anything —
   * for a panel closed before it finished.
   */
  const load = useCallback(() => {
    let stopped = false;

    void refetchCount().then(async (counted) => {
      await refetchList();

      if (!stopped) {
        setBaseline(counted.data?.count ?? null);
        setLoaded(true);
      }
    });

    return () => {
      stopped = true;
    };
  }, [refetchCount, refetchList]);

  // Once per opening.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => load(), []);

  // Closing keeps only the first page cached.
  useEffect(
    () => () => {
      queryClient.setQueryData(
        queryKeys.notificationList(organizationId),
        firstPageOnly,
      );
    },
    [queryClient, organizationId],
  );

  const current = count.data?.count;
  const settled = !count.isFetching;

  // The baseline never stands above the count: an acknowledgement, here or
  // in another tab, lowers both. An unknown baseline is taken from the next
  // settled count. Adjusted while rendering, as the count changes, rather
  // than an effect later.
  const [seen, setSeen] = useState({ current, settled });

  if (seen.current !== current || seen.settled !== settled) {
    setSeen({ current, settled });

    if (current !== undefined) {
      if (baseline === null) {
        if (settled) setBaseline(current);
      } else if (current < baseline) {
        setBaseline(current);
      }
    }
  }

  const items = list.data?.pages.flatMap(({ items: page }) => page) ?? [];
  const unreadLoaded = items.some(({ readAt }) => readAt === null);
  const arrivals =
    loaded && baseline !== null && current !== undefined && current > baseline;

  // Focus starts on the heading; once there are rows, on the first of them —
  // unless the caller has already moved it.
  const hasRows = items.length > 0;

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  useEffect(() => {
    if (hasRows && document.activeElement === headingRef.current) {
      listRef.current
        ?.querySelector<HTMLElement>("[data-notification-row]")
        ?.focus();
    }
  }, [hasRows]);

  const showNew = () => {
    setBaseline(null);
    load();
  };

  const onFollow = (notification: NotificationResponse, event: MouseEvent) => {
    if (notification.readAt === null) {
      markRead.mutate(notification, {
        // The row may read as unread again: take a new baseline.
        onError: () => setBaseline(null),
      });
    }

    const elsewhere =
      event.metaKey || event.ctrlKey || event.shiftKey || event.button === 1;

    if (!elsewhere) onClose();
  };

  const markAll = () => {
    const newest = items[0];

    if (!newest) return;

    setAnnouncement("");
    readThrough.mutate(newest.id, {
      onSuccess: () => {
        // Everything shown is read; whatever is unread now is newer.
        setBaseline(0);
        setAnnouncement("All notifications marked as read.");
      },
      onError: () => setBaseline(null),
    });
  };

  // Up and down move between rows; Home and End to either end.
  const onListKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    const rows = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>("[data-notification-row]") ??
        [],
    );
    const at = rows.indexOf(document.activeElement as HTMLElement);
    const move = (index: number) => {
      event.preventDefault();
      rows[Math.max(0, Math.min(rows.length - 1, index))]?.focus();
    };

    switch (event.key) {
      case "ArrowDown":
        return move(at + 1);
      case "ArrowUp":
        return move(at - 1);
      case "Home":
        return move(0);
      case "End":
        return move(rows.length - 1);
    }
  };

  // Older rows join the end of the list; focus goes to the first of them
  // once drawn, since the button that asked for them may be gone by then.
  const focusRow = useRef<number | null>(null);
  const rowCount = items.length;

  useEffect(() => {
    const index = focusRow.current;
    const row =
      index === null
        ? undefined
        : listRef.current?.querySelectorAll<HTMLElement>(
            "[data-notification-row]",
          )[index];

    if (row) {
      focusRow.current = null;
      row.focus();
    }
  }, [rowCount]);

  const showOlder = () => {
    focusRow.current = rowCount;
    void list.fetchNextPage();
  };

  const showMarkAll =
    hasRows && (unreadLoaded || (list.hasNextPage && (current ?? 0) > 0));

  return (
    <>
      <div className="flex shrink-0 items-center gap-2 border-b border-line-subtle px-4 py-3">
        <h2
          ref={headingRef}
          id={titleId}
          tabIndex={-1}
          className="text-sm font-semibold text-fg focus:outline-none"
        >
          Notifications
        </h2>
        {current !== undefined && current > 0 && (
          <span className="numeric text-xs text-fg-muted">
            · {current} unread
          </span>
        )}
        <span className="flex-1" />
        {showMarkAll && (
          <button
            type="button"
            onClick={markAll}
            disabled={readThrough.isPending}
            className={textButtonClasses}
          >
            Mark all as read
          </button>
        )}
      </div>
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {readThrough.isError && (
        <p className="shrink-0 border-b border-line-subtle px-4 py-2 text-xs text-danger-text">
          {isApiError(readThrough.error, 404)
            ? "The list changed — try again."
            : "Couldn't mark notifications as read. Try again."}
        </p>
      )}
      {arrivals && (
        <button
          type="button"
          onClick={showNew}
          className="shrink-0 border-b border-accent-line bg-accent-subtle px-4 py-2 text-left text-xs font-medium text-accent-text hover:underline"
        >
          New notifications · Show
        </button>
      )}
      {list.data === undefined ? (
        list.isError ? (
          <div className="flex flex-col items-start gap-2 px-4 py-6">
            <p className="text-sm text-fg">Couldn&apos;t load notifications.</p>
            <button
              type="button"
              onClick={() => load()}
              className={textButtonClasses}
            >
              Retry
            </button>
          </div>
        ) : (
          <LoadingRows />
        )
      ) : items.length === 0 ? (
        <div className="px-4 py-8">
          <p className="text-sm font-medium text-fg">No notifications yet</p>
          <p className="mt-1 text-sm text-fg-muted">
            Incident and team updates that need your attention will appear
            here.
          </p>
        </div>
      ) : (
        <ul
          ref={listRef}
          aria-label="Notifications, newest first"
          onKeyDown={onListKeyDown}
          className="min-h-0 flex-1 divide-y divide-line-subtle overflow-y-auto"
        >
          {items.map((notification) => (
            <NotificationRow
              key={notification.id}
              notification={notification}
              orgSlug={orgSlug}
              now={now}
              onFollow={onFollow}
            />
          ))}
        </ul>
      )}
      {list.hasNextPage && (
        <div className="shrink-0 border-t border-line-subtle px-4 py-2.5 text-center">
          <button
            type="button"
            onClick={showOlder}
            disabled={list.isFetchingNextPage}
            className={textButtonClasses}
          >
            {list.isFetchingNextPage ? "Loading…" : "Show older"}
          </button>
        </div>
      )}
    </>
  );
}

/** Three quiet placeholder rows while the first page loads. */
function LoadingRows() {
  return (
    <div role="status" className="py-1">
      <span className="sr-only">Loading notifications</span>
      {[0, 1, 2].map((row) => (
        <div
          key={row}
          aria-hidden="true"
          className="flex gap-3 py-3 pr-4 pl-5"
        >
          <span className="mt-0.5 size-4 shrink-0 rounded-sm bg-sunken" />
          <span className="flex flex-1 flex-col gap-2 pt-0.5">
            <span className="h-2.5 w-2/5 rounded-sm bg-sunken" />
            <span className="h-2.5 w-4/5 rounded-sm bg-sunken" />
          </span>
        </div>
      ))}
    </div>
  );
}
