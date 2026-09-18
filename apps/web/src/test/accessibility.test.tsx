import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, it, vi } from "vitest";

import { AuthFrame } from "@/components/app/auth-frame";
import { WorkspaceShell } from "@/components/app/workspace-shell";
import { LoginForm } from "@/components/auth/login-form";
import { RegisterForm } from "@/components/auth/register-form";
import { InvitationAcceptance } from "@/components/invitations/invitation-acceptance";
import { MembersView } from "@/components/organizations/members-view";
import { OrganizationOverview } from "@/components/organizations/organization-overview";
import { OrganizationPicker } from "@/components/organizations/organization-picker";
import { OrganizationScope } from "@/components/organizations/organization-scope";
import { OrganizationSettings } from "@/components/organizations/organization-settings";
import { TeamDetail } from "@/components/teams/team-detail";
import { TeamScope } from "@/components/teams/team-scope";
import { TeamSettings } from "@/components/teams/team-settings";
import { TeamsView } from "@/components/teams/teams-view";
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
} from "./api";
import { expectNoAxeViolations } from "./axe";
import { renderWithSession } from "./render";

/**
 * Automated accessibility checks (axe-core) over each screen as it ships,
 * rendered in its real frame. Contrast is checked by design-tokens.test.ts;
 * keyboard behaviour by the component tests.
 */

const navigation = vi.hoisted(() => ({
  params: {} as { orgSlug?: string; teamSlug?: string },
  pathname: "/",
}));

vi.mock("next/navigation", () => ({
  useParams: () => navigation.params,
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const OWNER = [
  "invitations:manage",
  "invitations:read",
  "memberships:read",
  "organization:read",
  "organization:update",
  "teams:manage",
  "teams:read",
];
const MEMBER = ["memberships:read", "organization:read", "teams:read"];

const team = {
  id: "0199a1b2-c3d4-7000-8000-0000000000d1",
  name: "Platform",
  slug: "platform",
  description: "Owns the runtime.",
  memberCount: 1,
  createdAt: "2026-09-18T12:00:00.000Z",
  updatedAt: "2026-09-18T12:00:00.000Z",
};

const base = `/organizations/${organization.id}`;

const signedIn = (permissions: string[]) =>
  mockApi((request) => {
    switch (route(request)) {
      case "POST /auth/refresh":
        return refreshed("token");
      case "GET /auth/me":
        return jsonResponse(200, currentUser);
      case `GET ${base}`:
        return jsonResponse(200, organizationDetail(permissions));
      case `GET ${base}/memberships`:
        return jsonResponse(200, [
          {
            id: currentUser.memberships[0].id,
            role: "OWNER",
            createdAt: "2026-09-01T12:00:00.000Z",
            user: {
              id: currentUser.id,
              name: currentUser.name,
              email: currentUser.email,
            },
          },
        ]);
      case `GET ${base}/teams`:
        return jsonResponse(200, [team]);
      case `GET ${base}/teams/${team.id}/members`:
        return jsonResponse(200, [
          {
            membershipId: currentUser.memberships[0].id,
            addedAt: "2026-09-18T12:00:00.000Z",
            user: {
              id: currentUser.id,
              name: currentUser.name,
              email: currentUser.email,
            },
          },
        ]);
      case `GET ${base}/invitations`:
        return jsonResponse(200, [
          {
            id: "i-1",
            email: "grace@example.com",
            role: "ADMIN",
            status: "pending",
            expiresAt: "2026-09-24T12:00:00.000Z",
            createdAt: "2026-09-17T12:00:00.000Z",
            invitedBy: { id: currentUser.id, name: currentUser.name },
          },
          {
            id: "i-2",
            email: "linus@example.com",
            role: "MEMBER",
            status: "expired",
            expiresAt: "2026-09-10T12:00:00.000Z",
            createdAt: "2026-09-03T12:00:00.000Z",
            invitedBy: { id: currentUser.id, name: currentUser.name },
          },
        ]);
      default:
        return apiError(404);
    }
  });

const signedOut = () =>
  mockApi((request) => {
    switch (route(request)) {
      case "POST /auth/refresh":
        return apiError(401);
      case "POST /invitations/lookup":
        return jsonResponse(200, {
          organization: {
            id: organization.id,
            name: organization.name,
            slug: organization.slug,
          },
          email: "grace@example.com",
          role: "ADMIN",
          expiresAt: "2026-09-24T12:00:00.000Z",
          invitedBy: { name: "Ada Lovelace" },
        });
      default:
        return apiError(404);
    }
  });

const inWorkspace = (page: React.ReactNode) =>
  renderWithSession(
    <WorkspaceShell>
      <OrganizationScope>{page}</OrganizationScope>
    </WorkspaceShell>,
  );

describe("accessibility", () => {
  beforeEach(() => {
    clearAccessToken();
    navigation.params = { orgSlug: organization.slug };
    navigation.pathname = `/orgs/${organization.slug}`;
  });

  afterEach(() => {
    window.location.hash = "";
  });

  describe("workspace", () => {
    it("Overview", async () => {
      signedIn(OWNER);
      const { container } = inWorkspace(<OrganizationOverview />);

      await screen.findByRole("heading", { level: 1, name: "Overview" });
      await screen.findByRole("link", { name: /1 member/ });
      await expectNoAxeViolations(container);
    });

    it("Members, as an owner who manages invitations", async () => {
      signedIn(OWNER);
      const { container } = inWorkspace(<MembersView />);

      await screen.findByText("linus@example.com");
      await expectNoAxeViolations(container);
    });

    it("Members, as a member", async () => {
      signedIn(MEMBER);
      const { container } = inWorkspace(<MembersView />);

      await screen.findByRole("table", { name: "Members" });
      await expectNoAxeViolations(container);
    });

    it("Settings", async () => {
      signedIn(OWNER);
      const { container } = inWorkspace(<OrganizationSettings />);

      await screen.findByLabelText("Name");
      await expectNoAxeViolations(container);
    });

    it("Settings, without permission", async () => {
      signedIn(MEMBER);
      const { container } = inWorkspace(<OrganizationSettings />);

      await screen.findByText(/do not have permission/);
      await expectNoAxeViolations(container);
    });

    it("Teams, as an owner creating one", async () => {
      signedIn(OWNER);
      const { container } = inWorkspace(<TeamsView />);

      await screen.findByRole("table", { name: "Teams" });
      (await screen.findAllByRole("button", { name: "New team" }))[0].click();
      await screen.findByRole("region", { name: "New team" });
      await expectNoAxeViolations(container);
    });

    it("Team, as an owner", async () => {
      navigation.params = { orgSlug: organization.slug, teamSlug: team.slug };
      signedIn(OWNER);
      const { container } = inWorkspace(
        <TeamScope>
          <TeamDetail />
        </TeamScope>,
      );

      await screen.findByRole("table", { name: "Team members" });
      await screen.findByText("Everyone in this organization is on this team.");
      await expectNoAxeViolations(container);
    });

    it("Team, as a member", async () => {
      navigation.params = { orgSlug: organization.slug, teamSlug: team.slug };
      signedIn(MEMBER);
      const { container } = inWorkspace(
        <TeamScope>
          <TeamDetail />
        </TeamScope>,
      );

      await screen.findByRole("table", { name: "Team members" });
      await expectNoAxeViolations(container);
    });

    it("Team settings", async () => {
      navigation.params = { orgSlug: organization.slug, teamSlug: team.slug };
      signedIn(OWNER);
      const { container } = inWorkspace(
        <TeamScope>
          <TeamSettings />
        </TeamScope>,
      );

      await screen.findByRole("button", { name: "Delete team…" });
      await expectNoAxeViolations(container);
    });

    it("Organization not found", async () => {
      navigation.params = { orgSlug: "someone-elses" };
      signedIn(OWNER);
      const { container } = inWorkspace(<OrganizationOverview />);

      await screen.findByRole("heading", { name: "Organization not found" });
      await expectNoAxeViolations(container);
    });

    it("Your organizations", async () => {
      navigation.params = {};
      navigation.pathname = "/orgs";
      signedIn(OWNER);
      const { container } = renderWithSession(
        <WorkspaceShell>
          <OrganizationPicker />
        </WorkspaceShell>,
      );

      await screen.findByRole("table", { name: "Your organizations" });
      await expectNoAxeViolations(container);
    });
  });

  describe("signed-out pages", () => {
    beforeEach(() => {
      navigation.params = {};
    });

    it("Log in", async () => {
      signedOut();
      const { container } = renderWithSession(
        <AuthFrame>
          <LoginForm />
        </AuthFrame>,
      );

      await screen.findByLabelText("Password");
      await expectNoAxeViolations(container);
    });

    it("Create your organization", async () => {
      signedOut();
      const { container } = renderWithSession(
        <AuthFrame>
          <RegisterForm />
        </AuthFrame>,
      );

      await screen.findByLabelText(/Organization URL name/);
      await expectNoAxeViolations(container);
    });

    it("Invitation, signed out", async () => {
      window.location.hash = "#fragment-token_abcdefghijklmnopqrstuvwxyz0123";
      signedOut();
      const { container } = renderWithSession(
        <AuthFrame width="md">
          <InvitationAcceptance />
        </AuthFrame>,
      );

      await screen.findByRole("tab", { name: "Create an account" });
      await expectNoAxeViolations(container);
    });
  });
});
