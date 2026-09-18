import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, it, vi } from "vitest";

import { AuthFrame } from "@/components/app/auth-frame";
import { WorkspaceShell } from "@/components/app/workspace-shell";
import { LoginForm } from "@/components/auth/login-form";
import { RegisterForm } from "@/components/auth/register-form";
import { IncidentDetail } from "@/components/incidents/incident-detail";
import { IncidentsView } from "@/components/incidents/incidents-view";
import { InvitationAcceptance } from "@/components/invitations/invitation-acceptance";
import { MembersView } from "@/components/organizations/members-view";
import { OrganizationOverview } from "@/components/organizations/organization-overview";
import { OrganizationPicker } from "@/components/organizations/organization-picker";
import { OrganizationScope } from "@/components/organizations/organization-scope";
import { OrganizationSettings } from "@/components/organizations/organization-settings";
import { ServiceDetail } from "@/components/services/service-detail";
import { ServiceScope } from "@/components/services/service-scope";
import { ServiceSettings } from "@/components/services/service-settings";
import { ServicesView } from "@/components/services/services-view";
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
  params: {} as {
    orgSlug?: string;
    teamSlug?: string;
    serviceSlug?: string;
    incidentNumber?: string;
  },
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
  "services:manage",
  "services:read",
  "teams:manage",
  "teams:read",
  "incidents:manage",
  "incidents:read",
];
const MEMBER = [
  "incidents:manage",
  "incidents:read",
  "memberships:read",
  "organization:read",
  "services:read",
  "teams:read",
];

const team = {
  id: "0199a1b2-c3d4-7000-8000-0000000000d1",
  name: "Platform",
  slug: "platform",
  description: "Owns the runtime.",
  memberCount: 1,
  serviceCount: 1,
  createdAt: "2026-09-18T12:00:00.000Z",
  updatedAt: "2026-09-18T12:00:00.000Z",
};

const service = {
  id: "0199a1b2-c3d4-7000-8000-0000000000e1",
  name: "Payment API",
  slug: "payment-api",
  description: "Takes card payments.",
  criticality: "CRITICAL",
  ownerTeam: { id: team.id, name: team.name, slug: team.slug },
  archivedAt: null,
  createdAt: "2026-09-18T12:00:00.000Z",
  updatedAt: "2026-09-18T12:00:00.000Z",
};

const activeIncident = {
  id: "0199a1b2-c3d4-7000-8000-0000000000f1",
  number: 42,
  title: "Card payments failing",
  summary: "Card declines since 14:02.",
  severity: "SEV1",
  status: "INVESTIGATING",
  service: {
    id: service.id,
    name: service.name,
    slug: service.slug,
    criticality: service.criticality,
    archivedAt: null,
  },
  team: { id: team.id, name: team.name, slug: team.slug },
  createdBy: { id: currentUser.id, name: currentUser.name },
  createdAt: "2026-09-18T12:00:00.000Z",
  updatedAt: "2026-09-18T12:00:00.000Z",
  resolvedAt: null,
};

const resolvedIncident = {
  ...activeIncident,
  id: "0199a1b2-c3d4-7000-8000-0000000000f2",
  number: 7,
  title: "Reports delayed",
  severity: "SEV3",
  status: "RESOLVED",
  resolvedAt: "2026-09-18T13:00:00.000Z",
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
      case `GET ${base}/services`:
        return jsonResponse(200, [service]);
      case `GET ${base}/incidents?state=active`:
        return jsonResponse(200, {
          items: [activeIncident],
          page: { cursor: null, hasMore: false },
        });
      case `GET ${base}/incidents?state=resolved`:
        return jsonResponse(200, {
          items: [resolvedIncident],
          page: { cursor: "7", hasMore: true },
        });
      case `GET ${base}/incidents/42`:
        return jsonResponse(200, activeIncident);
      case `GET ${base}/incidents/7`:
        return jsonResponse(200, resolvedIncident);
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
      await screen.findByRole("table", { name: "Services owned by this team" });
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

      // The team owns a service, so deletion is explained rather than offered.
      await screen.findByText("This team owns services");
      await expectNoAxeViolations(container);
    });

    it("Services, as an owner creating one", async () => {
      signedIn(OWNER);
      const { container } = inWorkspace(<ServicesView />);

      await screen.findByRole("table", { name: "Services" });
      (await screen.findAllByRole("button", { name: "New service" }))[0].click();
      await screen.findByLabelText("Criticality");
      await expectNoAxeViolations(container);
    });

    it("Service, as a member", async () => {
      navigation.params = {
        orgSlug: organization.slug,
        serviceSlug: service.slug,
      };
      signedIn(MEMBER);
      const { container } = inWorkspace(
        <ServiceScope>
          <ServiceDetail />
        </ServiceScope>,
      );

      await screen.findByRole("heading", { level: 1, name: "Payment API" });
      await expectNoAxeViolations(container);
    });

    it("Service settings", async () => {
      navigation.params = {
        orgSlug: organization.slug,
        serviceSlug: service.slug,
      };
      signedIn(OWNER);
      const { container } = inWorkspace(
        <ServiceScope>
          <ServiceSettings />
        </ServiceScope>,
      );

      await screen.findByRole("combobox", { name: "Owner team" });
      await expectNoAxeViolations(container);
    });

    it("Incidents, as a member declaring one", async () => {
      signedIn(MEMBER);
      const { container } = inWorkspace(<IncidentsView />);

      await screen.findByRole("table", { name: "Active incidents" });
      await screen.findByRole("table", { name: "Resolved incidents" });
      (await screen.findByRole("button", { name: "Declare incident" })).click();
      await screen.findByLabelText("Affected service");
      await expectNoAxeViolations(container);
    });

    it("Incident, active, as a member", async () => {
      navigation.params = { orgSlug: organization.slug, incidentNumber: "42" };
      signedIn(MEMBER);
      const { container } = inWorkspace(<IncidentDetail />);

      await screen.findByRole("heading", { level: 1, name: "Card payments failing" });
      await screen.findByLabelText("Responsible team");
      (await screen.findByRole("button", { name: "Resolve…" })).click();
      await screen.findByRole("button", { name: "Resolve incident" });
      await expectNoAxeViolations(container);
    });

    it("Incident, resolved", async () => {
      navigation.params = { orgSlug: organization.slug, incidentNumber: "7" };
      signedIn(MEMBER);
      const { container } = inWorkspace(<IncidentDetail />);

      await screen.findByRole("heading", { level: 1, name: "Reports delayed" });
      await expectNoAxeViolations(container);
    });

    it("Incident not found", async () => {
      navigation.params = { orgSlug: organization.slug, incidentNumber: "999" };
      signedIn(MEMBER);
      const { container } = inWorkspace(<IncidentDetail />);

      await screen.findByRole("heading", { name: "Incident not found" });
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
