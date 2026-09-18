import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clearAccessToken } from "@/lib/auth/token-store";
import {
  apiError,
  currentUser,
  jsonResponse,
  mockApi,
  organization,
  organizationDetail,
  refreshed,
  route,
} from "@/test/api";
import type { SentRequest } from "@/test/api";
import { renderWithSession } from "@/test/render";

import { InviteMemberForm } from "./invite-member-form";
import { OpenInvitationList } from "./open-invitation-list";
import { OrganizationScope } from "./organization-scope";

vi.mock("next/navigation", () => ({
  useParams: () => ({ orgSlug: "acme-ops" }),
  usePathname: () => "/orgs/acme-ops/members",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const TOKEN = "t0k3n-only-shown-once_abcdefghijklmnopqrstuvw";
const MANAGE = [
  "invitations:manage",
  "invitations:read",
  "memberships:read",
  "organization:read",
  "organization:update",
];
const READ_ONLY = ["memberships:read", "organization:read"];

const base = `/organizations/${organization.id}`;

const openInvitation = {
  id: "0199a1b2-c3d4-7000-8000-0000000000c1",
  email: "grace@example.com",
  role: "ADMIN",
  status: "pending",
  expiresAt: "2026-09-24T12:00:00.000Z",
  createdAt: "2026-09-17T12:00:00.000Z",
  invitedBy: { id: currentUser.id, name: "Ada Lovelace" },
};

const expiredInvitation = {
  ...openInvitation,
  id: "0199a1b2-c3d4-7000-8000-0000000000c2",
  email: "linus@example.com",
  role: "MEMBER",
  status: "expired",
};

type Handler = (request: SentRequest) => Response | undefined;

const api = (permissions: string[], handler: Handler = () => undefined) =>
  mockApi((request) => {
    const handled = handler(request);

    if (handled) return handled;

    switch (route(request)) {
      case "POST /auth/refresh":
        return refreshed("token");
      case "GET /auth/me":
        return jsonResponse(200, currentUser);
      case `GET ${base}`:
        return jsonResponse(200, organizationDetail(permissions, "RESPONDER"));
      case `GET ${base}/invitations`:
        return jsonResponse(200, [openInvitation, expiredInvitation]);
      default:
        return apiError(404);
    }
  });

const renderMembers = () =>
  renderWithSession(
    <OrganizationScope>
      <InviteMemberForm />
      <OpenInvitationList />
    </OrganizationScope>,
  );

const listRequests = (requests: SentRequest[]) =>
  requests.filter((r) => route(r) === `GET ${base}/invitations`);

describe("invitation management", () => {
  beforeEach(() => {
    clearAccessToken();
  });

  describe("what is offered", () => {
    it("offers the form, the list, and revocation when the API reports invitations:manage", async () => {
      api(MANAGE);

      renderMembers();

      expect(
        await screen.findByRole("heading", { name: "Invite a member" }),
      ).toBeDefined();
      expect(await screen.findByText("grace@example.com")).toBeDefined();
      expect(screen.getByText("Expired")).toBeDefined();
      expect(
        screen.getByRole("button", {
          name: "Revoke invitation for grace@example.com",
        }),
      ).toBeDefined();
    });

    it("offers neither, and asks for nothing, without the permissions", async () => {
      const { requests } = api(READ_ONLY);

      renderMembers();

      expect(
        await screen.findByRole("heading", { name: organization.name }),
      ).toBeDefined();
      expect(screen.queryByRole("heading", { name: "Invite a member" })).toBeNull();
      expect(screen.queryByRole("heading", { name: "Open invitations" })).toBeNull();
      expect(listRequests(requests)).toEqual([]);
    });

    it("lists without offering revocation or the form when only invitations:read is reported", async () => {
      api(["invitations:read", ...READ_ONLY]);

      renderMembers();

      expect(await screen.findByText("grace@example.com")).toBeDefined();
      expect(screen.queryByRole("button", { name: /Revoke/ })).toBeNull();
      expect(screen.queryByRole("heading", { name: "Invite a member" })).toBeNull();
    });
  });

  describe("creating an invitation", () => {
    const fillAndSubmit = async (email: string, role: "Member" | "Admin") => {
      const user = userEvent.setup();

      await user.type(await screen.findByLabelText("Email"), email);
      await user.selectOptions(screen.getByLabelText("Role"), role);
      await user.click(
        screen.getByRole("button", { name: "Create invitation" }),
      );
    };

    it("sends the email and role, shows the link once, and refreshes only the list", async () => {
      const { requests } = api(MANAGE, (request) =>
        route(request) === `POST ${base}/invitations`
          ? jsonResponse(201, {
              invitation: { ...openInvitation, email: "new@example.com" },
              token: TOKEN,
              replacedExisting: false,
            })
          : undefined,
      );

      const { queryClient } = renderMembers();
      await screen.findByText("grace@example.com");
      await fillAndSubmit("new@example.com", "Admin");

      const link = await screen.findByLabelText("Invitation link");

      expect((link as HTMLInputElement).value).toBe(
        `${window.location.origin}/invite#${TOKEN}`,
      );
      expect(
        screen.getByText(/Anyone with this link may be able to accept/),
      ).toBeDefined();
      expect(screen.getByText(/It expires in 7 days/)).toBeDefined();
      expect(screen.queryByText(/previous link/)).toBeNull();

      const create = requests.find(
        (r) => route(r) === `POST ${base}/invitations`,
      );

      expect(create).toMatchObject({
        credentials: "omit",
        authorization: "Bearer token",
        body: { email: "new@example.com", role: "ADMIN" },
      });
      await waitFor(() => expect(listRequests(requests)).toHaveLength(2));
      expect(
        requests.filter((r) => route(r) === "GET /auth/me"),
      ).toHaveLength(1);

      // The token is on screen and nowhere else: not in a link, not in the
      // query or mutation caches.
      expect(document.querySelector(`a[href*="${TOKEN}"]`)).toBeNull();
      await waitFor(() =>
        expect(queryClient.getMutationCache().getAll()).toEqual([]),
      );
      expect(
        JSON.stringify(
          queryClient.getQueryCache().getAll().map((q) => [q.queryKey, q.state.data]),
        ),
      ).not.toContain(TOKEN);

      await userEvent.setup().click(screen.getByRole("button", { name: "Done" }));

      expect(screen.queryByLabelText("Invitation link")).toBeNull();
      expect(document.body.innerHTML).not.toContain(TOKEN);
    });

    it("says when the new link replaced an older one", async () => {
      api(MANAGE, (request) =>
        route(request) === `POST ${base}/invitations`
          ? jsonResponse(201, {
              invitation: openInvitation,
              token: TOKEN,
              replacedExisting: true,
            })
          : undefined,
      );

      renderMembers();
      await fillAndSubmit("grace@example.com", "Admin");

      expect(
        await screen.findByText(
          "The previous link for this email no longer works.",
        ),
      ).toBeDefined();
    });

    it("explains a concurrent create and refreshes the list", async () => {
      const { requests } = api(MANAGE, (request) =>
        route(request) === `POST ${base}/invitations`
          ? apiError(409, "INVITATION_ALREADY_PENDING")
          : undefined,
      );

      renderMembers();
      await screen.findByText("grace@example.com");
      await fillAndSubmit("grace@example.com", "Member");

      expect(
        await screen.findByText(/was just created by someone else/),
      ).toBeDefined();
      expect(screen.queryByLabelText("Invitation link")).toBeNull();
      await waitFor(() => expect(listRequests(requests)).toHaveLength(2));
    });

    it("says when the person is already a member", async () => {
      api(MANAGE, (request) =>
        route(request) === `POST ${base}/invitations`
          ? apiError(409, "ALREADY_A_MEMBER")
          : undefined,
      );

      renderMembers();
      await fillAndSubmit("ada@example.com", "Member");

      expect(
        await screen.findByText(
          "That person is already a member of this organization.",
        ),
      ).toBeDefined();
    });

    it("places validation errors on the field", async () => {
      api(MANAGE, (request) =>
        route(request) === `POST ${base}/invitations`
          ? apiError(400, undefined, {
              details: [{ field: "email", message: "Invalid email address" }],
            })
          : undefined,
      );

      renderMembers();
      await fillAndSubmit("nope", "Member");

      expect(await screen.findByText("Invalid email address")).toBeDefined();
    });
  });

  describe("revoking an invitation", () => {
    it("revokes by id and refreshes the list", async () => {
      const { requests } = api(MANAGE, (request) =>
        request.method === "DELETE" ? jsonResponse(204) : undefined,
      );

      renderMembers();
      await userEvent
        .setup()
        .click(
          await screen.findByRole("button", {
            name: "Revoke invitation for grace@example.com",
          }),
        );

      await waitFor(() => expect(listRequests(requests)).toHaveLength(2));
      expect(requests.find((r) => r.method === "DELETE")).toMatchObject({
        path: `${base}/invitations/${openInvitation.id}`,
        authorization: "Bearer token",
      });
    });

    it.each([
      [404, "INVITATION_NOT_FOUND"],
      [409, "INVITATION_NOT_PENDING"],
    ])(
      "explains a %s and refreshes the out-of-date list",
      async (status, code) => {
        const { requests } = api(MANAGE, (request) =>
          request.method === "DELETE" ? apiError(status, code) : undefined,
        );

        renderMembers();
        const table = await screen.findByRole("table");
        await userEvent
          .setup()
          .click(
            within(table).getByRole("button", {
              name: "Revoke invitation for linus@example.com",
            }),
          );

        expect(
          await screen.findByText(/was no longer open/),
        ).toBeDefined();
        await waitFor(() => expect(listRequests(requests)).toHaveLength(2));
      },
    );
  });
});
