import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearAccessToken } from "@/lib/auth/token-store";
import {
  apiError,
  currentUser,
  jsonResponse,
  mockApi,
  organization,
  refreshed,
  route,
} from "@/test/api";
import type { SentRequest } from "@/test/api";
import { renderWithSession } from "@/test/render";

import { InvitationAcceptance } from "./invitation-acceptance";

const navigation = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  usePathname: () => "/invite",
}));

const TOKEN = "fragment-token_abcdefghijklmnopqrstuvwxyz0123";

const invitationFor = (email: string) => ({
  organization: { id: organization.id, name: organization.name, slug: "acme-ops" },
  email,
  role: "ADMIN",
  expiresAt: "2026-09-24T12:00:00.000Z",
  invitedBy: { name: "Ada Lovelace" },
});

const invitee = {
  id: "0199a1b2-c3d4-7000-8000-000000000002",
  email: "grace@example.com",
  name: "Grace Hopper",
  createdAt: "2026-09-17T12:00:00.000Z",
};

const inviteeWithMembership = {
  ...invitee,
  memberships: [
    {
      id: "0199a1b2-c3d4-7000-8000-0000000000ab",
      role: "ADMIN",
      organization: { ...organization, slug: "acme-ops" },
    },
  ],
};

type Handler = (request: SentRequest) => Response | undefined;

/**
 * The API as the page meets it. `signedIn` decides whether the session
 * restores on load, and as whom.
 */
const api = ({
  signedIn,
  lookup = () => jsonResponse(200, invitationFor(invitee.email)),
  handler = () => undefined,
}: {
  signedIn: typeof currentUser | typeof inviteeWithMembership | null;
  lookup?: () => Response;
  handler?: Handler;
}) => {
  let me = signedIn;

  return mockApi((request) => {
    const handled = handler(request);

    if (handled) return handled;

    switch (route(request)) {
      case "POST /auth/refresh":
        return me ? refreshed("restored") : apiError(401, "INVALID_REFRESH_TOKEN");
      case "GET /auth/me":
        return me ? jsonResponse(200, me) : apiError(401);
      case "POST /auth/logout":
        me = null;
        return jsonResponse(204);
      case "POST /invitations/lookup":
        return lookup();
      default:
        return apiError(404);
    }
  });
};

const tokenNeverLeaksFrom = (requests: SentRequest[]) => {
  for (const request of requests) {
    expect(request.path).not.toContain(TOKEN);
  }
};

describe("InvitationAcceptance", () => {
  beforeEach(() => {
    clearAccessToken();
    navigation.push.mockReset();
    window.location.hash = `#${TOKEN}`;
  });

  afterEach(() => {
    window.location.hash = "";
  });

  it("shows the invalid state for a link without a token, asking the API nothing about invitations", async () => {
    window.location.hash = "";
    const { requests } = api({ signedIn: null });

    renderWithSession(<InvitationAcceptance />);

    expect(await screen.findByText("Invitation not available")).toBeDefined();
    expect(requests.filter((r) => r.path.startsWith("/invitations"))).toEqual(
      [],
    );
  });

  it("looks the token up publicly, in the body, and describes the offer", async () => {
    const { requests } = api({ signedIn: null });

    const { queryClient } = renderWithSession(<InvitationAcceptance />);

    expect(
      await screen.findByRole("heading", { name: `Join ${organization.name}` }),
    ).toBeDefined();
    expect(screen.getByText(/Ada Lovelace invited/).textContent).toContain(
      "grace@example.com",
    );
    expect(screen.getByText(/to join as Admin/)).toBeDefined();

    const lookups = requests.filter(
      (r) => route(r) === "POST /invitations/lookup",
    );

    expect(lookups[0]).toEqual({
      method: "POST",
      path: "/invitations/lookup",
      credentials: "omit",
      authorization: null,
      body: { token: TOKEN },
    });
    tokenNeverLeaksFrom(requests);
    expect(
      JSON.stringify(
        queryClient.getQueryCache().getAll().map((q) => [q.queryKey, q.state.data]),
      ),
    ).not.toContain(TOKEN);
    expect(Object.keys(window.localStorage)).toEqual([]);
    expect(Object.keys(window.sessionStorage)).toEqual([]);
  });

  it("shows the invalid state for a token the API does not recognise", async () => {
    api({
      signedIn: null,
      lookup: () => apiError(404, "INVITATION_NOT_FOUND"),
    });

    renderWithSession(<InvitationAcceptance />);

    expect(await screen.findByText("Invitation not available")).toBeDefined();
    expect(screen.queryByRole("tab")).toBeNull();
  });

  it("offers a retry when the lookup could not reach the API", async () => {
    let attempts = 0;
    api({
      signedIn: null,
      lookup: () => {
        attempts += 1;
        return attempts <= 2
          ? apiError(503)
          : jsonResponse(200, invitationFor(invitee.email));
      },
    });

    renderWithSession(<InvitationAcceptance />);

    await userEvent
      .setup()
      .click(await screen.findByRole("button", { name: "Try again" }));

    expect(
      await screen.findByRole("heading", { name: `Join ${organization.name}` }),
    ).toBeDefined();
  });

  describe("signed out", () => {
    it("creates the account with the token, then opens the organization", async () => {
      let registered = false;
      const { requests } = api({
        signedIn: null,
        handler: (request) => {
          if (route(request) === "POST /auth/register/invitation") {
            registered = true;
            return jsonResponse(201, {
              accessToken: "fresh",
              expiresIn: 900,
              tokenType: "Bearer",
              user: invitee,
            });
          }
          if (route(request) === "GET /auth/me" && registered) {
            return jsonResponse(200, inviteeWithMembership);
          }
          if (route(request) === "POST /invitations/lookup" && registered) {
            return apiError(404, "INVITATION_NOT_FOUND");
          }
          return undefined;
        },
      });
      const user = userEvent.setup();

      renderWithSession(<InvitationAcceptance />);

      const email = (await screen.findByLabelText("Email")) as HTMLInputElement;

      expect(email.value).toBe("grace@example.com");
      expect(email.readOnly).toBe(true);

      await user.type(screen.getByLabelText("Your name"), "Grace Hopper");
      await user.type(
        screen.getByLabelText("Password"),
        "a sufficiently long passphrase",
      );
      await user.click(
        screen.getByRole("button", { name: "Create account and join" }),
      );

      await waitFor(() =>
        expect(navigation.push).toHaveBeenCalledWith("/orgs/acme-ops"),
      );
      expect(
        requests.find((r) => route(r) === "POST /auth/register/invitation"),
      ).toEqual({
        method: "POST",
        path: "/auth/register/invitation",
        credentials: "include",
        authorization: null,
        body: {
          token: TOKEN,
          name: "Grace Hopper",
          password: "a sufficiently long passphrase",
        },
      });
      expect(screen.queryByText("Invitation not available")).toBeNull();
      tokenNeverLeaksFrom(requests);
    });

    it("keeps the form and shows validation errors when registration is refused", async () => {
      api({
        signedIn: null,
        handler: (request) =>
          route(request) === "POST /auth/register/invitation"
            ? apiError(400, undefined, {
                details: [{ field: "password", message: "Too short" }],
              })
            : undefined,
      });
      const user = userEvent.setup();

      renderWithSession(<InvitationAcceptance />);

      await user.type(await screen.findByLabelText("Your name"), "Grace");
      await user.type(screen.getByLabelText("Password"), "short");
      await user.click(
        screen.getByRole("button", { name: "Create account and join" }),
      );

      expect(await screen.findByText("Too short")).toBeDefined();
      expect(
        screen.getByRole("button", { name: "Create account and join" }),
      ).toBeDefined();
      expect(navigation.push).not.toHaveBeenCalled();
    });

    it("sends an existing account to sign in, then joins after it does", async () => {
      let signedIn = false;
      let accepted = false;
      const { requests } = api({
        signedIn: null,
        handler: (request) => {
          switch (route(request)) {
            case "POST /auth/register/invitation":
              return apiError(409, "EMAIL_ALREADY_REGISTERED");
            case "POST /auth/login":
              signedIn = true;
              return jsonResponse(200, {
                accessToken: "signed-in",
                expiresIn: 900,
                tokenType: "Bearer",
                user: invitee,
              });
            case "GET /auth/me":
              if (!signedIn) return undefined;
              return jsonResponse(
                200,
                accepted ? inviteeWithMembership : { ...invitee, memberships: [] },
              );
            case "POST /invitations/accept":
              accepted = true;
              return jsonResponse(200, inviteeWithMembership.memberships[0]);
            default:
              return undefined;
          }
        },
      });
      const user = userEvent.setup();

      renderWithSession(<InvitationAcceptance />);

      await user.type(await screen.findByLabelText("Your name"), "Grace");
      await user.type(
        screen.getByLabelText("Password"),
        "a sufficiently long passphrase",
      );
      await user.click(
        screen.getByRole("button", { name: "Create account and join" }),
      );

      expect(
        await screen.findByText(/An account already exists for this email/),
      ).toBeDefined();
      expect(
        screen.getByRole("tab", { name: "I have an account" }).getAttribute(
          "aria-selected",
        ),
      ).toBe("true");

      await user.type(
        screen.getByLabelText("Password"),
        "a sufficiently long passphrase",
      );
      await user.click(screen.getByRole("button", { name: "Log in" }));

      await user.click(
        await screen.findByRole("button", { name: `Join ${organization.name}` }),
      );

      await waitFor(() =>
        expect(navigation.push).toHaveBeenCalledWith("/orgs/acme-ops"),
      );
      expect(
        requests.find((r) => route(r) === "POST /auth/login")?.body,
      ).toEqual({
        email: "grace@example.com",
        password: "a sufficiently long passphrase",
      });
      expect(
        requests.find((r) => route(r) === "POST /invitations/accept"),
      ).toEqual({
        method: "POST",
        path: "/invitations/accept",
        credentials: "omit",
        authorization: "Bearer signed-in",
        body: { token: TOKEN },
      });

      // `me` was fetched again after accepting, before the organization opened.
      const meAfterAccept = requests.findIndex(
        (r, index) =>
          route(r) === "GET /auth/me" &&
          index >
            requests.findIndex((q) => route(q) === "POST /invitations/accept"),
      );

      expect(meAfterAccept).toBeGreaterThan(-1);
      tokenNeverLeaksFrom(requests);
    });
  });

  describe("signed in", () => {
    it("joins as the invited account", async () => {
      api({
        signedIn: { ...invitee, memberships: [] } as typeof currentUser,
        handler: (request) =>
          route(request) === "POST /invitations/accept"
            ? jsonResponse(200, inviteeWithMembership.memberships[0])
            : undefined,
      });

      renderWithSession(<InvitationAcceptance />);

      await userEvent
        .setup()
        .click(
          await screen.findByRole("button", {
            name: `Join ${organization.name}`,
          }),
        );

      await waitFor(() =>
        expect(navigation.push).toHaveBeenCalledWith("/orgs/acme-ops"),
      );
      expect(screen.queryByRole("tab")).toBeNull();
    });

    it("says so when the account is already a member", async () => {
      api({
        signedIn: inviteeWithMembership,
        handler: (request) =>
          route(request) === "POST /invitations/accept"
            ? apiError(409, "ALREADY_A_MEMBER")
            : undefined,
      });

      renderWithSession(<InvitationAcceptance />);

      await userEvent
        .setup()
        .click(
          await screen.findByRole("button", {
            name: `Join ${organization.name}`,
          }),
        );

      expect(
        await screen.findByText(/You are already a member of/),
      ).toBeDefined();
      expect(
        screen.getByRole("link", { name: "Open it" }).getAttribute("href"),
      ).toBe("/orgs/acme-ops");
      expect(navigation.push).not.toHaveBeenCalled();
    });

    it("shows the invalid state when the invitation stopped working before joining", async () => {
      api({
        signedIn: { ...invitee, memberships: [] } as typeof currentUser,
        handler: (request) =>
          route(request) === "POST /invitations/accept"
            ? apiError(404, "INVITATION_NOT_FOUND")
            : undefined,
      });

      renderWithSession(<InvitationAcceptance />);

      await userEvent
        .setup()
        .click(
          await screen.findByRole("button", {
            name: `Join ${organization.name}`,
          }),
        );

      expect(await screen.findByText("Invitation not available")).toBeDefined();
    });

    it("tells a different account it cannot accept, and lets it log out", async () => {
      const { requests } = api({ signedIn: currentUser });

      renderWithSession(<InvitationAcceptance />);

      const notice = await screen.findByText(/This invitation is for/);

      expect(notice.textContent).toContain("grace@example.com");
      expect(notice.textContent).toContain("ada@example.com");
      expect(
        screen.queryByRole("button", { name: `Join ${organization.name}` }),
      ).toBeNull();

      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: "Log out" }));

      expect(
        await screen.findByRole("tab", { name: "Create an account" }),
      ).toBeDefined();
      expect(requests.some((r) => route(r) === "POST /auth/logout")).toBe(true);
      expect(
        requests.some((r) => route(r) === "POST /invitations/accept"),
      ).toBe(false);
    });
  });

  it("starts over when the fragment changes to another token", async () => {
    const OTHER = "another-token_abcdefghijklmnopqrstuvwxyz01234";
    const { requests } = api({
      signedIn: null,
      lookup: () => jsonResponse(200, invitationFor(invitee.email)),
    });

    renderWithSession(<InvitationAcceptance />);
    await screen.findByRole("heading", { name: `Join ${organization.name}` });

    await act(async () => {
      window.location.hash = `#${OTHER}`;
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });

    await waitFor(() =>
      expect(
        requests.some(
          (r) =>
            route(r) === "POST /invitations/lookup" &&
            (r.body as { token: string }).token === OTHER,
        ),
      ).toBe(true),
    );
  });
});
