import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { InfiniteData, QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  NotificationResponse,
  NotificationUnreadCountResponse,
  Page,
} from "@/lib/api/contracts";
import { queryKeys } from "@/lib/api/query-keys";
import { clearAccessToken, setAccessToken } from "@/lib/auth/token-store";
import { createQueryClient } from "@/lib/query/query-client";
import {
  apiError,
  jsonResponse,
  mockApi,
  organization,
  route,
} from "@/test/api";

import {
  NOTIFICATION_POLL_MS,
  useMarkNotificationRead,
  useMarkNotificationsReadThrough,
  useNotificationList,
  useUnreadNotificationCount,
} from "./notification-queries";

const ORG = organization.id;
const OTHER_ORG = "0199a1b2-c3d4-7000-8000-00000000000b";
const base = `/organizations/${ORG}/notifications`;

const idOf = (n: number) =>
  `0199a1b2-c3d4-7000-8000-${String(n).padStart(12, "0")}`;

/** A team notification: the simplest shape the list can hold. */
const row = (
  n: number,
  readAt: string | null = null,
): NotificationResponse => ({
  id: idOf(n),
  type: "TEAM_MEMBERSHIP_ADDED",
  createdAt: `2026-09-21T10:${String(n).padStart(2, "0")}:00.000Z`,
  readAt,
  actor: { id: idOf(900), name: "Alice Anders" },
  incident: null,
  change: null,
  team: { id: idOf(800), name: "Payments" },
});

const page = (
  items: NotificationResponse[],
  cursor: string | null = null,
): Page<NotificationResponse> => ({
  items,
  page: { cursor, hasMore: cursor !== null },
});

const wrapperFor = (queryClient: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };

/** Resolves when told to: to see what the cache holds while a request waits. */
const deferred = () => {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });

  return { promise, resolve };
};

const loadedRows = (queryClient: QueryClient) =>
  queryClient
    .getQueryData<
      InfiniteData<Page<NotificationResponse>>
    >(queryKeys.notificationList(ORG))!
    .pages.flatMap(({ items }) => items);

const unreadCount = (queryClient: QueryClient, organizationId = ORG) =>
  queryClient.getQueryData<NotificationUnreadCountResponse>(
    queryKeys.unreadNotificationCount(organizationId),
  )?.count;

describe("notification queries", () => {
  beforeEach(() => setAccessToken("token"));
  afterEach(() => clearAccessToken());

  describe("the unread count", () => {
    it("should ask for the organization's own count, under its own key", async () => {
      const { requests } = mockApi((request) =>
        jsonResponse(200, { count: request.path.includes(ORG) ? 3 : 9 }),
      );
      const queryClient = createQueryClient();

      const { result } = renderHook(
        () => ({
          here: useUnreadNotificationCount(ORG),
          there: useUnreadNotificationCount(OTHER_ORG),
        }),
        { wrapper: wrapperFor(queryClient) },
      );

      await waitFor(() => expect(result.current.there.isSuccess).toBe(true));

      expect(result.current.here.data).toEqual({ count: 3 });
      expect(result.current.there.data).toEqual({ count: 9 });
      expect(requests.map(route).sort()).toEqual([
        `GET ${base}/unread-count`,
        `GET /organizations/${OTHER_ORG}/notifications/unread-count`,
      ]);
    });

    it("should poll every thirty seconds only when asked to", async () => {
      mockApi(() => jsonResponse(200, { count: 0 }));
      const queryClient = createQueryClient();

      renderHook(
        () => {
          useUnreadNotificationCount(ORG, { poll: true });
          useUnreadNotificationCount(OTHER_ORG);
        },
        { wrapper: wrapperFor(queryClient) },
      );

      const interval = (organizationId: string) =>
        queryClient
          .getQueryCache()
          .find({ queryKey: queryKeys.unreadNotificationCount(organizationId) })
          ?.observers.map(({ options }) => options.refetchInterval);

      expect(NOTIFICATION_POLL_MS).toBe(30_000);
      expect(interval(ORG)).toEqual([30_000]);
      expect(interval(OTHER_ORG)).toEqual([false]);
    });

    it("should ask nothing while disabled", () => {
      const { requests } = mockApi(() => jsonResponse(200, { count: 0 }));

      renderHook(() => useUnreadNotificationCount(ORG, { enabled: false }), {
        wrapper: wrapperFor(createQueryClient()),
      });

      expect(requests).toEqual([]);
    });
  });

  describe("the list", () => {
    it("should page by the API's cursor, newest first", async () => {
      const { requests } = mockApi((request) =>
        request.path.includes("cursor=")
          ? jsonResponse(200, page([row(1)]))
          : jsonResponse(200, page([row(3), row(2)], "next-page")),
      );
      const queryClient = createQueryClient();

      const { result } = renderHook(() => useNotificationList(ORG), {
        wrapper: wrapperFor(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(result.current.hasNextPage).toBe(true);

      await act(() => result.current.fetchNextPage());

      expect(loadedRows(queryClient).map(({ id }) => id)).toEqual([
        idOf(3),
        idOf(2),
        idOf(1),
      ]);
      expect(requests.map(route)).toEqual([
        `GET ${base}`,
        `GET ${base}?cursor=next-page`,
      ]);
    });

    it("should fetch afresh each time it is shown, and not on window focus", async () => {
      const { requests } = mockApi(() => jsonResponse(200, page([row(1)])));
      const queryClient = createQueryClient();

      const first = renderHook(() => useNotificationList(ORG), {
        wrapper: wrapperFor(queryClient),
      });

      await waitFor(() => expect(first.result.current.isSuccess).toBe(true));
      first.unmount();

      const second = renderHook(() => useNotificationList(ORG), {
        wrapper: wrapperFor(queryClient),
      });

      await waitFor(() => expect(requests).toHaveLength(2));

      const options = queryClient
        .getQueryCache()
        .find({ queryKey: queryKeys.notificationList(ORG) })
        ?.observers[0]?.options;

      expect(options?.refetchOnWindowFocus).toBe(false);
      second.unmount();
    });
  });

  describe("acknowledging one", () => {
    const seed = (queryClient: QueryClient) => {
      queryClient.setQueryData(queryKeys.notificationList(ORG), {
        pages: [page([row(3), row(2), row(1, "2026-09-21T11:00:00.000Z")])],
        pageParams: [null],
      });
      queryClient.setQueryData(queryKeys.unreadNotificationCount(ORG), {
        count: 2,
      });
    };

    it("should read the row and lower the count at once, then take the API's answer", async () => {
      const answer = deferred();
      const { requests } = mockApi((request) =>
        route(request) === `POST ${base}/${idOf(2)}/read`
          ? answer.promise
          : jsonResponse(200, { count: 1 }),
      );
      const queryClient = createQueryClient();
      seed(queryClient);

      // The bell shows the count, so asking it again refetches it.
      renderHook(() => useUnreadNotificationCount(ORG), {
        wrapper: wrapperFor(queryClient),
      });

      const { result } = renderHook(() => useMarkNotificationRead(ORG), {
        wrapper: wrapperFor(queryClient),
      });

      act(() => result.current.mutate(row(2)));

      // Before the API answers.
      await waitFor(() =>
        expect(loadedRows(queryClient)[1].readAt).not.toBeNull(),
      );
      expect(loadedRows(queryClient)[0].readAt).toBeNull();
      expect(unreadCount(queryClient)).toBe(1);

      answer.resolve(
        jsonResponse(200, row(2, "2026-09-21T12:00:00.000Z")),
      );

      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      expect(loadedRows(queryClient)[1].readAt).toBe(
        "2026-09-21T12:00:00.000Z",
      );
      // The count is asked again, and nothing else.
      await waitFor(() =>
        expect(requests.map(route)).toContain(`GET ${base}/unread-count`),
      );
      expect(requests.map(route)).not.toContain(`GET ${base}`);
    });

    it("should leave the count alone for a row already read", async () => {
      mockApi(() => jsonResponse(200, row(1, "2026-09-21T11:00:00.000Z")));
      const queryClient = createQueryClient();
      seed(queryClient);

      const { result } = renderHook(() => useMarkNotificationRead(ORG), {
        wrapper: wrapperFor(queryClient),
      });

      act(() => result.current.mutate(row(1, "2026-09-21T11:00:00.000Z")));

      expect(unreadCount(queryClient)).toBe(2);
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
    });

    it("should fetch the list and the count again when it fails, the row unread once more", async () => {
      const { requests } = mockApi((request) => {
        switch (route(request)) {
          case `POST ${base}/${idOf(2)}/read`:
            return apiError(404, "NOTIFICATION_NOT_FOUND");
          case `GET ${base}/unread-count`:
            return jsonResponse(200, { count: 2 });
          default:
            return jsonResponse(200, page([row(3), row(2), row(1)]));
        }
      });
      const queryClient = createQueryClient();
      seed(queryClient);

      // The list and the count are being shown, so both are refetched.
      renderHook(
        () => {
          useNotificationList(ORG);
          useUnreadNotificationCount(ORG);
        },
        { wrapper: wrapperFor(queryClient) },
      );

      const { result } = renderHook(() => useMarkNotificationRead(ORG), {
        wrapper: wrapperFor(queryClient),
      });

      act(() => result.current.mutate(row(2)));

      await waitFor(() => expect(result.current.isError).toBe(true));
      await waitFor(() =>
        expect(loadedRows(queryClient)[1].readAt).toBeNull(),
      );
      expect(unreadCount(queryClient)).toBe(2);
      expect(requests.map(route)).toEqual(
        expect.arrayContaining([
          `GET ${base}/unread-count`,
          `POST ${base}/${idOf(2)}/read`,
        ]),
      );
    });
  });

  describe("acknowledging through", () => {
    const seed = (queryClient: QueryClient) => {
      // Two pages, newest first.
      queryClient.setQueryData(queryKeys.notificationList(ORG), {
        pages: [page([row(5), row(4)], "next"), page([row(3), row(2)])],
        pageParams: [null, "next"],
      });
      queryClient.setQueryData(queryKeys.unreadNotificationCount(ORG), {
        count: 4,
      });
    };

    it("should read the bound and everything below it, leave anything newer, and take the count from the API", async () => {
      const { requests } = mockApi(() => jsonResponse(200, { count: 1 }));
      const queryClient = createQueryClient();
      seed(queryClient);

      const { result } = renderHook(
        () => useMarkNotificationsReadThrough(ORG),
        { wrapper: wrapperFor(queryClient) },
      );

      // Row 5 is above the bound: newer than the newest seen.
      act(() => result.current.mutate(idOf(4)));

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(requests).toEqual([
        expect.objectContaining({
          method: "POST",
          path: `${base}/read`,
          body: { through: idOf(4) },
        }),
      ]);
      expect(
        loadedRows(queryClient).map(({ id, readAt }) => [id, readAt !== null]),
      ).toEqual([
        [idOf(5), false],
        [idOf(4), true],
        [idOf(3), true],
        [idOf(2), true],
      ]);
      expect(unreadCount(queryClient)).toBe(1);
    });

    it("should fetch the list and count again when the bound has gone, and keep the error", async () => {
      const { requests } = mockApi((request) => {
        switch (route(request)) {
          case `POST ${base}/read`:
            return apiError(404, "NOTIFICATION_NOT_FOUND");
          case `GET ${base}/unread-count`:
            return jsonResponse(200, { count: 3 });
          default:
            return jsonResponse(200, page([row(5), row(3), row(2)]));
        }
      });
      const queryClient = createQueryClient();
      seed(queryClient);

      renderHook(
        () => {
          useNotificationList(ORG);
          useUnreadNotificationCount(ORG);
        },
        { wrapper: wrapperFor(queryClient) },
      );

      const { result } = renderHook(
        () => useMarkNotificationsReadThrough(ORG),
        { wrapper: wrapperFor(queryClient) },
      );

      act(() => result.current.mutate(idOf(4)));

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(result.current.error).toEqual(
        expect.objectContaining({ code: "NOTIFICATION_NOT_FOUND" }),
      );
      await waitFor(() =>
        expect(loadedRows(queryClient).map(({ id }) => id)).toEqual([
          idOf(5),
          idOf(3),
          idOf(2),
        ]),
      );
      expect(requests.map(route)).toContain(`GET ${base}/unread-count`);
    });
  });
});
