import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiError, mockApi, refreshed } from "@/test/api";

import { REFRESH_LOCK_NAME, refreshSession } from "./refresh";
import { clearAccessToken, getAccessToken } from "./token-store";

type LockCallback = (lock: unknown) => Promise<unknown>;

const installLocks = (request: LockManager["request"] | undefined) => {
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: request ? { request } : undefined,
  });
};

/** A response that can be released on demand, to hold a refresh open. */
const deferred = () => {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((settle) => {
    resolve = settle;
  });

  return { promise, resolve };
};

describe("refreshSession", () => {
  beforeEach(() => {
    clearAccessToken();
  });

  afterEach(() => {
    installLocks(undefined);
  });

  describe("within one tab", () => {
    it("makes one request for any number of concurrent callers", async () => {
      const pending = deferred();
      const { requests } = mockApi(() => pending.promise);

      const callers = Array.from({ length: 5 }, () => refreshSession());

      pending.resolve(refreshed("fresh"));

      await expect(Promise.all(callers)).resolves.toEqual(
        Array(5).fill("fresh"),
      );
      expect(requests).toHaveLength(1);
      expect(requests[0]).toMatchObject({
        method: "POST",
        path: "/auth/refresh",
        credentials: "include",
        authorization: null,
      });
      expect(getAccessToken()).toBe("fresh");
    });

    it("starts a new request once the previous one has settled", async () => {
      let issued = 0;
      const { requests } = mockApi(() => refreshed(`token-${++issued}`));

      await expect(refreshSession()).resolves.toBe("token-1");
      await expect(refreshSession()).resolves.toBe("token-2");
      expect(requests).toHaveLength(2);
    });

    it("rejects every waiting caller alike, then allows a fresh attempt", async () => {
      const { requests } = mockApi(() => apiError(401, "INVALID_REFRESH_TOKEN"));

      const results = await Promise.allSettled([
        refreshSession(),
        refreshSession(),
      ]);

      expect(results.map((result) => result.status)).toEqual([
        "rejected",
        "rejected",
      ]);
      expect(requests).toHaveLength(1);

      await expect(refreshSession()).rejects.toMatchObject({ statusCode: 401 });
      expect(requests).toHaveLength(2);
    });

    it("does not store a token when the refresh fails", async () => {
      mockApi(() => apiError(401, "REFRESH_TOKEN_EXPIRED"));

      await expect(refreshSession()).rejects.toBeDefined();
      expect(getAccessToken()).toBeNull();
    });
  });

  describe("across tabs", () => {
    it("holds an exclusive Web Lock until the response body has been read", async () => {
      const events: string[] = [];
      const request = vi.fn(
        async (name: string, options: LockOptions, callback: LockCallback) => {
          events.push(`acquire ${name} ${options.mode}`);

          try {
            return await callback({});
          } finally {
            events.push("release");
          }
        },
      );

      installLocks(request as unknown as LockManager["request"]);

      mockApi(() => {
        events.push("fetch");
        const response = refreshed("fresh");
        const readBody = response.json.bind(response);

        response.json = async () => {
          const body = await readBody();
          events.push("body read");

          return body;
        };

        return response;
      });

      await expect(refreshSession()).resolves.toBe("fresh");

      expect(events).toEqual([
        `acquire ${REFRESH_LOCK_NAME} exclusive`,
        "fetch",
        "body read",
        "release",
      ]);
    });

    it("serializes: a second tab's refresh waits for the first to finish", async () => {
      // A FIFO lock manager standing in for the browser's, shared by two
      // tabs. Tab A is this module; tab B, which in a browser has its own
      // module state, is simulated by requesting the same lock directly.
      let tail = Promise.resolve();
      const request = (
        _name: string,
        _options: LockOptions,
        callback: LockCallback,
      ) => {
        const run = tail.then(() => callback({}));
        tail = run.then(
          () => undefined,
          () => undefined,
        );

        return run;
      };

      installLocks(request as unknown as LockManager["request"]);

      const order: string[] = [];
      const first = deferred();
      let calls = 0;

      mockApi(() => {
        calls += 1;
        order.push(`start ${calls}`);

        return calls === 1 ? first.promise : refreshed("second");
      });

      const tabA = refreshSession();
      const tabB = request(REFRESH_LOCK_NAME, { mode: "exclusive" }, async () => {
        order.push("tab B holds the lock");

        return fetch("http://api.test/api/v1/auth/refresh", {
          method: "POST",
          credentials: "include",
        });
      });

      // Tab A's request is in flight; tab B is still queued behind the lock.
      await vi.waitFor(() => expect(order).toEqual(["start 1"]));

      first.resolve(refreshed("first"));

      await expect(tabA).resolves.toBe("first");
      await tabB;
      expect(order).toEqual(["start 1", "tab B holds the lock", "start 2"]);
    });

    it("falls back to in-tab single-flight where Web Locks is missing", async () => {
      installLocks(undefined);
      const pending = deferred();
      const { requests } = mockApi(() => pending.promise);

      const callers = [refreshSession(), refreshSession()];

      pending.resolve(refreshed("fresh"));

      await expect(Promise.all(callers)).resolves.toEqual(["fresh", "fresh"]);
      expect(requests).toHaveLength(1);
    });
  });
});
