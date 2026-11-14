import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearAccessToken } from "@/lib/auth/token-store";
import {
  apiError,
  currentUser,
  jsonResponse,
  mockApi,
  refreshed,
  route,
} from "@/test/api";
import type { SentRequest } from "@/test/api";
import { renderWithSession } from "@/test/render";

import { ChangePasswordForm } from "./change-password-form";

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  search: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: navigation.replace, push: vi.fn() }),
  useSearchParams: () => navigation.search,
}));

const onOneTimePassword = { ...currentUser, passwordChangeRequired: true };

type Handler = (request: SentRequest) => Response | undefined;

const api = (me: unknown, handler: Handler = () => undefined) =>
  mockApi((request) => {
    const handled = handler(request);

    if (handled) return handled;

    switch (route(request)) {
      case "POST /auth/refresh":
        return refreshed("token");
      case "GET /auth/me":
        return jsonResponse(200, me);
      default:
        return apiError(404);
    }
  });

const fill = async (current: string, next: string, confirm = next) => {
  const user = userEvent.setup();

  await user.type(await screen.findByLabelText("One-time password"), current);
  await user.type(screen.getByLabelText("New password"), next);
  await user.type(screen.getByLabelText("Confirm new password"), confirm);
  await user.click(screen.getByRole("button", { name: "Save password" }));
};

describe("ChangePasswordForm", () => {
  beforeEach(() => {
    clearAccessToken();
    navigation.replace.mockReset();
    navigation.search = new URLSearchParams();
  });

  it("asks someone on a one-time password to choose their own", async () => {
    api(onOneTimePassword);

    renderWithSession(<ChangePasswordForm />);

    expect(
      await screen.findByRole("heading", { name: "Choose your password" }),
    ).toBeDefined();
    expect(screen.getByText(/signed in as ada@example.com/)).toBeDefined();
  });

  it("refuses mismatched passwords without asking the API", async () => {
    const { requests } = api(onOneTimePassword);

    renderWithSession(<ChangePasswordForm />);
    await fill("one-time-password-123", "my-own-passphrase", "something-else!");

    expect(
      await screen.findByText("The passwords do not match."),
    ).toBeDefined();
    expect(requests.some((r) => route(r) === "POST /auth/password")).toBe(
      false,
    );
  });

  it("sends the change with the bearer and the cookie, then goes on", async () => {
    let changed = false;
    const { requests } = api(onOneTimePassword, (request) => {
      if (route(request) === "POST /auth/password") {
        changed = true;
        return jsonResponse(200, {
          accessToken: "new-token",
          expiresIn: 900,
          tokenType: "Bearer",
          user: { ...currentUser, passwordChangeRequired: false },
        });
      }
      if (route(request) === "GET /auth/me" && changed) {
        return jsonResponse(200, currentUser);
      }
      return undefined;
    });

    renderWithSession(<ChangePasswordForm />);
    await fill("one-time-password-123", "my-own-passphrase");

    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/"));

    const sent = requests.find((r) => route(r) === "POST /auth/password");
    expect(sent?.body).toEqual({
      currentPassword: "one-time-password-123",
      newPassword: "my-own-passphrase",
    });
    expect(sent?.authorization).toBe("Bearer token");
    // The response replaces the refresh cookie, which the browser accepts
    // only from a credentialed request.
    expect(sent?.credentials).toBe("include");

    // `me` was read again after the change, with the new token.
    const reads = requests.filter((r) => route(r) === "GET /auth/me");
    expect(reads.at(-1)?.authorization).toBe("Bearer new-token");
  });

  it("marks a wrong one-time password on its field", async () => {
    api(onOneTimePassword, (request) =>
      route(request) === "POST /auth/password"
        ? apiError(400, "INVALID_CURRENT_PASSWORD", {
            details: [
              {
                field: "currentPassword",
                message: "The current password is incorrect",
              },
            ],
          })
        : undefined,
    );

    renderWithSession(<ChangePasswordForm />);
    await fill("not-the-one", "my-own-passphrase");

    expect(
      await screen.findByText("The current password is incorrect"),
    ).toBeDefined();
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  describe("for someone who chose to change it", () => {
    const changing = (request: SentRequest) =>
      route(request) === "POST /auth/password"
        ? jsonResponse(200, {
            accessToken: "new-token",
            expiresIn: 900,
            tokenType: "Bearer",
            user: currentUser,
          })
        : undefined;

    const fillOwn = async () => {
      const user = userEvent.setup();

      await user.type(await screen.findByLabelText("Current password"), "old-passphrase-1");
      await user.type(screen.getByLabelText("New password"), "my-own-passphrase");
      await user.type(screen.getByLabelText("Confirm new password"), "my-own-passphrase");
      await user.click(screen.getByRole("button", { name: "Save password" }));

      return user;
    };

    it("asks for the current password and offers Cancel, not Log out", async () => {
      navigation.search = new URLSearchParams({ from: "/orgs/acme-ops/incidents" });
      api(currentUser);

      renderWithSession(<ChangePasswordForm />);

      expect(
        await screen.findByRole("heading", { name: "Change your password" }),
      ).toBeDefined();
      expect(screen.queryByRole("button", { name: "Log out instead" })).toBeNull();

      await userEvent.setup().click(screen.getByRole("button", { name: "Cancel" }));

      expect(navigation.replace).toHaveBeenCalledWith("/orgs/acme-ops/incidents");
    });

    it("confirms the change, then goes back to where they were", async () => {
      navigation.search = new URLSearchParams({ from: "/orgs/acme-ops/incidents" });
      api(currentUser, changing);

      renderWithSession(<ChangePasswordForm />);
      const user = await fillOwn();

      expect(
        await screen.findByRole("heading", { name: "Password changed" }),
      ).toBeDefined();
      expect(navigation.replace).not.toHaveBeenCalled();

      await user.click(screen.getByRole("button", { name: "Back to work" }));

      expect(navigation.replace).toHaveBeenCalledWith("/orgs/acme-ops/incidents");
    });

    it("never goes back to another site", async () => {
      navigation.search = new URLSearchParams({ from: "//evil.example/steal" });
      api(currentUser);

      renderWithSession(<ChangePasswordForm />);
      await userEvent.setup().click(await screen.findByRole("button", { name: "Cancel" }));

      expect(navigation.replace).toHaveBeenCalledWith("/");
    });
  });

  it("sends a signed-out visitor to log in", async () => {
    mockApi(() => apiError(401, "INVALID_REFRESH_TOKEN"));

    renderWithSession(<ChangePasswordForm />);

    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith("/login"),
    );
  });
});
