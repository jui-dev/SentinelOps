import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  apiError,
  currentUser,
  jsonResponse,
  mockApi,
  refreshed,
  route,
} from "@/test/api";
import { renderWithSession } from "@/test/render";

import { queryKeys } from "../api/query-keys";
import { useSession } from "./session-provider";
import { clearAccessToken, getAccessToken } from "./token-store";

function Status() {
  return <p>status: {useSession().status}</p>;
}

describe("SessionProvider", () => {
  beforeEach(() => {
    clearAccessToken();
  });

  it("restores a session with one refresh, even under Strict Mode", async () => {
    const { requests } = mockApi((request) => {
      switch (route(request)) {
        case "POST /auth/refresh":
          return refreshed("restored");
        case "GET /auth/me":
          return jsonResponse(200, currentUser);
        default:
          return apiError(404);
      }
    });

    const { queryClient } = renderWithSession(<Status />);

    expect(await screen.findByText("status: authenticated")).toBeDefined();
    expect(
      requests.filter((r) => route(r) === "POST /auth/refresh"),
    ).toHaveLength(1);
    expect(getAccessToken()).toBe("restored");
    expect(queryClient.getQueryData(queryKeys.me)).toEqual(currentUser);
  });

  it("is unauthenticated when the API refuses the refresh cookie", async () => {
    const { requests } = mockApi(() => apiError(401, "INVALID_REFRESH_TOKEN"));

    renderWithSession(<Status />);

    expect(await screen.findByText("status: unauthenticated")).toBeDefined();
    expect(requests.map(route)).toEqual(["POST /auth/refresh"]);
  });

  it("is unavailable, not signed out, when the API cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );

    renderWithSession(<Status />);

    expect(await screen.findByText("status: unavailable")).toBeDefined();
  });

  it("is unavailable when the API fails with a 5xx", async () => {
    mockApi(() => apiError(503));

    renderWithSession(<Status />);

    expect(await screen.findByText("status: unavailable")).toBeDefined();
  });
});
