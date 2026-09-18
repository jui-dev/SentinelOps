import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  apiError,
  jsonResponse,
  mockApi,
  refreshed,
  route,
} from "@/test/api";

import {
  clearAccessToken,
  getAccessToken,
  onSessionEnded,
  setAccessToken,
} from "../auth/token-store";
import { authenticatedRequest, publicRequest, sessionRequest } from "./client";
import { ApiError, NetworkError } from "./errors";

describe("API client", () => {
  let sessionEnded: ReturnType<typeof vi.fn<() => void>>;
  let unsubscribe: () => void;

  beforeEach(() => {
    clearAccessToken();
    sessionEnded = vi.fn<() => void>();
    unsubscribe = onSessionEnded(sessionEnded);
  });

  afterEach(() => {
    unsubscribe();
  });

  describe("sessionRequest", () => {
    it("sends the cookie and no bearer token, even when one is held", async () => {
      setAccessToken("held");
      const { requests } = mockApi(() => jsonResponse(204));

      await sessionRequest("/auth/logout", { method: "POST" });

      expect(requests).toEqual([
        {
          method: "POST",
          path: "/auth/logout",
          credentials: "include",
          authorization: null,
          body: undefined,
        },
      ]);
    });

    it("answers a 401 with the error and never refreshes", async () => {
      const { requests } = mockApi(() => apiError(401, "INVALID_CREDENTIALS"));

      await expect(
        sessionRequest("/auth/login", {
          method: "POST",
          body: { email: "a@b.c", password: "x" },
        }),
      ).rejects.toMatchObject({ statusCode: 401, code: "INVALID_CREDENTIALS" });

      expect(requests.map(route)).toEqual(["POST /auth/login"]);
      expect(sessionEnded).not.toHaveBeenCalled();
    });

    it("turns an unreachable API into a NetworkError", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
      );

      await expect(sessionRequest("/auth/refresh")).rejects.toBeInstanceOf(
        NetworkError,
      );
    });
  });

  describe("publicRequest", () => {
    it("sends neither the cookie nor a bearer token, even when one is held", async () => {
      setAccessToken("held");
      const { requests } = mockApi(() => jsonResponse(200, {}));

      await publicRequest("/invitations/lookup", {
        method: "POST",
        body: { token: "invitation-token" },
      });

      expect(requests).toEqual([
        {
          method: "POST",
          path: "/invitations/lookup",
          credentials: "omit",
          authorization: null,
          body: { token: "invitation-token" },
        },
      ]);
    });

    it("answers a 401 with the error, never refreshing or ending the session", async () => {
      setAccessToken("held");
      const { requests } = mockApi(() => apiError(401, "UNAUTHENTICATED"));

      await expect(
        publicRequest("/invitations/lookup", { method: "POST", body: {} }),
      ).rejects.toMatchObject({ statusCode: 401 });

      expect(requests.map(route)).toEqual(["POST /invitations/lookup"]);
      expect(sessionEnded).not.toHaveBeenCalled();
      expect(getAccessToken()).toBe("held");
    });
  });

  describe("authenticatedRequest", () => {
    it("sends the bearer token and never the cookie", async () => {
      setAccessToken("token-1");
      const { requests } = mockApi(() => jsonResponse(200, { ok: true }));

      await expect(authenticatedRequest("/auth/me")).resolves.toEqual({
        ok: true,
      });
      expect(requests).toEqual([
        {
          method: "GET",
          path: "/auth/me",
          credentials: "omit",
          authorization: "Bearer token-1",
          body: undefined,
        },
      ]);
    });

    it("refreshes once and retries once after a 401", async () => {
      setAccessToken("expired");
      const { requests } = mockApi((request) => {
        if (route(request) === "POST /auth/refresh") return refreshed("fresh");

        return request.authorization === "Bearer fresh"
          ? jsonResponse(200, { ok: true })
          : apiError(401, "UNAUTHENTICATED");
      });

      await expect(authenticatedRequest("/auth/me")).resolves.toEqual({
        ok: true,
      });

      expect(
        requests.map((r) => [route(r), r.credentials, r.authorization]),
      ).toEqual([
        ["GET /auth/me", "omit", "Bearer expired"],
        ["POST /auth/refresh", "include", null],
        ["GET /auth/me", "omit", "Bearer fresh"],
      ]);
      expect(getAccessToken()).toBe("fresh");
      expect(sessionEnded).not.toHaveBeenCalled();
    });

    it("ends the session when the retry is refused too, without looping", async () => {
      setAccessToken("expired");
      const { requests } = mockApi((request) =>
        route(request) === "POST /auth/refresh"
          ? refreshed("fresh")
          : apiError(401, "UNAUTHENTICATED"),
      );

      await expect(authenticatedRequest("/auth/me")).rejects.toMatchObject({
        statusCode: 401,
      });

      expect(requests.map(route)).toEqual([
        "GET /auth/me",
        "POST /auth/refresh",
        "GET /auth/me",
      ]);
      expect(sessionEnded).toHaveBeenCalledTimes(1);
      expect(getAccessToken()).toBeNull();
    });

    it("ends the session when the refresh is refused", async () => {
      setAccessToken("expired");
      const { requests } = mockApi((request) =>
        route(request) === "POST /auth/refresh"
          ? apiError(401, "REFRESH_TOKEN_REUSED")
          : apiError(401, "UNAUTHENTICATED"),
      );

      await expect(authenticatedRequest("/auth/me")).rejects.toMatchObject({
        statusCode: 401,
        code: "REFRESH_TOKEN_REUSED",
      });

      expect(requests.map(route)).toEqual(["GET /auth/me", "POST /auth/refresh"]);
      expect(sessionEnded).toHaveBeenCalledTimes(1);
      expect(getAccessToken()).toBeNull();
    });

    it("keeps the session when the refresh cannot reach the API", async () => {
      setAccessToken("expired");
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          if (String(input).endsWith("/auth/refresh")) {
            throw new TypeError("Failed to fetch");
          }

          return apiError(401, "UNAUTHENTICATED");
        }),
      );

      await expect(authenticatedRequest("/auth/me")).rejects.toBeInstanceOf(
        NetworkError,
      );
      expect(sessionEnded).not.toHaveBeenCalled();
    });

    it("retries with a token another request already obtained, without refreshing", async () => {
      setAccessToken("stale");
      const { requests } = mockApi((request) => {
        if (request.authorization === "Bearer stale") {
          // Meanwhile, some other request completed a refresh.
          setAccessToken("newer");

          return apiError(401, "UNAUTHENTICATED");
        }

        return jsonResponse(200, { ok: true });
      });

      await expect(authenticatedRequest("/auth/me")).resolves.toEqual({
        ok: true,
      });
      expect(requests.map((r) => [route(r), r.authorization])).toEqual([
        ["GET /auth/me", "Bearer stale"],
        ["GET /auth/me", "Bearer newer"],
      ]);
    });

    it("shares one refresh between concurrent requests refused together", async () => {
      setAccessToken("expired");
      const { requests } = mockApi((request) => {
        if (route(request) === "POST /auth/refresh") return refreshed("fresh");

        return request.authorization === "Bearer fresh"
          ? jsonResponse(200, { path: request.path })
          : apiError(401, "UNAUTHENTICATED");
      });

      const paths = ["/auth/me", "/organizations/a", "/organizations/b"];

      await expect(
        Promise.all(paths.map((path) => authenticatedRequest(path))),
      ).resolves.toEqual(paths.map((path) => ({ path })));

      expect(
        requests.filter((r) => route(r) === "POST /auth/refresh"),
      ).toHaveLength(1);
    });

    it.each([
      [403, "PERMISSION_DENIED"],
      [404, "ORGANIZATION_NOT_FOUND"],
    ])(
      "passes a %i through without refreshing",
      async (status, code) => {
        setAccessToken("token-1");
        const { requests } = mockApi(() => apiError(status, code));

        const error = await authenticatedRequest("/organizations/x", {
          method: "PATCH",
          body: { name: "Renamed" },
        }).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(ApiError);
        expect(error).toMatchObject({ statusCode: status, code });
        expect(requests).toHaveLength(1);
        expect(requests[0].body).toEqual({ name: "Renamed" });
        expect(sessionEnded).not.toHaveBeenCalled();
      },
    );
  });
});
