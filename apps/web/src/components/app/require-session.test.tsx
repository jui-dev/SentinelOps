import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSession } from "@/lib/auth/session-provider";
import { clearAccessToken } from "@/lib/auth/token-store";
import {
  apiError,
  currentUser,
  jsonResponse,
  mockApi,
  refreshed,
  route,
} from "@/test/api";
import { renderWithSession } from "@/test/render";

import { RequireSession } from "./require-session";

const navigation = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace, push: vi.fn() }),
  usePathname: () => "/orgs/acme-ops/members",
}));

function LogoutButton() {
  const { logout } = useSession();

  return <button onClick={() => void logout()}>Log out</button>;
}

describe("RequireSession", () => {
  beforeEach(() => {
    clearAccessToken();
    navigation.replace.mockReset();
  });

  it("sends a signed-out visitor to log in, remembering the page", async () => {
    mockApi(() => apiError(401, "INVALID_REFRESH_TOKEN"));

    renderWithSession(<RequireSession>secret</RequireSession>);

    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith(
        "/login?next=%2Forgs%2Facme-ops%2Fmembers",
      ),
    );
    expect(screen.queryByText("secret")).toBeNull();
  });

  it("sends the user to a bare /login after an explicit logout", async () => {
    mockApi((request) => {
      switch (route(request)) {
        case "POST /auth/refresh":
          return refreshed("token");
        case "GET /auth/me":
          return jsonResponse(200, currentUser);
        case "POST /auth/logout":
          return jsonResponse(204);
        default:
          return apiError(404);
      }
    });

    const { queryClient } = renderWithSession(
      <RequireSession>
        <p>secret</p>
        <LogoutButton />
      </RequireSession>,
    );

    await screen.findByText("secret");
    await userEvent.setup().click(screen.getByRole("button", { name: "Log out" }));

    await waitFor(() => expect(navigation.replace).toHaveBeenCalled());
    expect(navigation.replace.mock.calls).toEqual([["/login"]]);
    expect(screen.queryByText("secret")).toBeNull();
    // Nothing the session fetched survives. A still-mounted observer may
    // re-register its query key, but the entry holds no data.
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .filter((query) => query.state.data !== undefined),
    ).toEqual([]);
  });

  it("sends a user still on a one-time password to choose their own", async () => {
    mockApi((request) => {
      switch (route(request)) {
        case "POST /auth/refresh":
          return refreshed("token");
        case "GET /auth/me":
          return jsonResponse(200, {
            ...currentUser,
            passwordChangeRequired: true,
          });
        default:
          return apiError(404);
      }
    });

    renderWithSession(<RequireSession>secret</RequireSession>);

    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith("/change-password"),
    );
    expect(screen.queryByText("secret")).toBeNull();
  });
});
