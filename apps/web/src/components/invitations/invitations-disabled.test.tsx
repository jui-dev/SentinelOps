import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MembersView } from "@/components/organizations/members-view";
import { OrganizationScope } from "@/components/organizations/organization-scope";
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
import { renderWithSession } from "@/test/render";

import { InvitationsUnavailable } from "./invitations-unavailable";

// Invitations switched off, as they are unless configured otherwise.
vi.mock(import("@/lib/config/env"), async (importOriginal) => {
  const actual = await importOriginal();

  return { ...actual, env: { ...actual.env, invitationsEnabled: false } };
});

vi.mock("next/navigation", () => ({
  useParams: () => ({ orgSlug: "acme-ops" }),
  usePathname: () => "/orgs/acme-ops/members",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const base = `/organizations/${organization.id}`;

describe("invitations, switched off", () => {
  beforeEach(() => {
    clearAccessToken();
  });

  it("hides the Invitations section, and never asks for invitations, even for an admin", async () => {
    const { requests } = mockApi((request) => {
      switch (route(request)) {
        case "POST /auth/refresh":
          return refreshed("token");
        case "GET /auth/me":
          return jsonResponse(200, currentUser);
        case `GET ${base}`:
          return jsonResponse(
            200,
            organizationDetail([
              "invitations:manage",
              "invitations:read",
              "members:manage",
              "memberships:read",
              "organization:read",
            ]),
          );
        case `GET ${base}/memberships`:
          return jsonResponse(200, []);
        default:
          return apiError(404);
      }
    });

    renderWithSession(
      <OrganizationScope>
        <MembersView />
      </OrganizationScope>,
    );

    expect(
      await screen.findByRole("heading", { name: "Add a member" }),
    ).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Invitations" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Invite a member" })).toBeNull();
    expect(
      requests.some((r) => route(r) === `GET ${base}/invitations`),
    ).toBe(false);
  });

  it("tells someone holding an old link how people join instead", () => {
    render(<InvitationsUnavailable />);

    expect(
      screen.getByRole("heading", { name: "Invitations aren't available" }),
    ).toBeDefined();
    expect(screen.getByRole("link", { name: "Log in" })).toBeDefined();
  });
});
