import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, it, vi } from "vitest";

import { AuthFrame } from "@/components/app/auth-frame";
import { WorkspaceShell } from "@/components/app/workspace-shell";
import { ChangePasswordForm } from "@/components/auth/change-password-form";
import { LoginForm } from "@/components/auth/login-form";
import { RegisterForm } from "@/components/auth/register-form";
import { IncidentAnalysisPage } from "@/components/incident-analyses/incident-analysis-page";
import { IncidentDetail } from "@/components/incidents/incident-detail";
import { IncidentHistory } from "@/components/history/incident-history";
import { IncidentsView } from "@/components/incidents/incidents-view";
import { InvitationAcceptance } from "@/components/invitations/invitation-acceptance";
import { MemberDetail } from "@/components/organizations/member-detail";
import { MembersView } from "@/components/organizations/members-view";
import { OrganizationLanding } from "@/components/organizations/organization-landing";
import { OrganizationOverview } from "@/components/organizations/organization-overview";
import { OrganizationPicker } from "@/components/organizations/organization-picker";
import { OrganizationScope } from "@/components/organizations/organization-scope";
import { OrganizationSettings } from "@/components/organizations/organization-settings";
import { ServiceDetail } from "@/components/services/service-detail";
import { ServiceScope } from "@/components/services/service-scope";
import { ServicesView } from "@/components/services/services-view";
import { TeamDetail } from "@/components/teams/team-detail";
import { TeamScope } from "@/components/teams/team-scope";
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
    teamId?: string;
    serviceSlug?: string;
    incidentNumber?: string;
    membershipId?: string;
  },
  pathname: "/",
}));

vi.mock("next/navigation", () => ({
  useParams: () => navigation.params,
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const ADMIN = [
  "invitations:manage",
  "invitations:read",
  "members:manage",
  "memberships:read",
  "organization:read",
  "organization:update",
  "services:manage",
  "services:read",
  "teams:manage",
  "teams:read",
  "incidents:manage",
  "incidents:read",
  "incidents:read-all",
  "incidents:respond",
  "incident-analyses:write",
];
const MEMBER = [
  "incident-analyses:write",
  "incidents:read",
  "incidents:respond",
  "memberships:read",
  "organization:read",
  "services:read",
  "teams:read",
];

/** INC-7's analysis, as each test sets it: none started unless it says. */
let resolvedAnalysis: object | null = null;

const analysis = (
  status: "DRAFT" | "PUBLISHED",
  owner = { membershipId: currentUser.memberships[0].id, name: currentUser.name },
) => ({
  status,
  version: 4,
  owner,
  summary: "Report generation stalled behind a long-running migration.",
  impact: null,
  cause: null,
  lessons: null,
  createdBy: { id: currentUser.id, name: currentUser.name },
  createdAt: "2026-09-19T09:00:00.000Z",
  publishedBy:
    status === "PUBLISHED" ? { id: currentUser.id, name: currentUser.name } : null,
  publishedAt: status === "PUBLISHED" ? "2026-09-20T09:00:00.000Z" : null,
  updatedAt: "2026-09-20T09:00:00.000Z",
  facts: {
    declaredAt: "2026-09-18T12:00:00.000Z",
    resolvedAt: "2026-09-18T13:00:00.000Z",
    firstResponseAt: "2026-09-18T12:10:00.000Z",
    responderCount: 1,
    updateCount: 0,
    severity: { declared: "SEV3", highest: "SEV2", final: "SEV3" },
    reassignmentCount: 1,
  },
  keyMoments: [
    ["DECLARED", "12:00", null, "SEV3"],
    ["FIRST_RESPONSE", "12:10", null, null],
    ["SEVERITY_CHANGED", "12:20", "SEV3", "SEV2"],
    ["TEAM_CHANGED", "12:30", "Platform", "Payments"],
    ["SEVERITY_CHANGED", "12:40", "SEV2", "SEV3"],
    ["LAST_RESPONSE_COMPLETED", "12:50", null, null],
    ["RESOLVED", "13:00", null, null],
  ].map(([kind, time, fromValue, toValue], index) => ({
    kind,
    activityId: `0199a1b2-c3d4-7000-8000-0000000003${String(index).padStart(2, "0")}`,
    at: `2026-09-18T${time}:00.000Z`,
    actor: { id: currentUser.id, name: currentUser.name },
    fromValue,
    toValue,
  })),
});

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

// A second severity, so the list renders more than one mark.
const majorIncident = {
  ...activeIncident,
  id: "0199a1b2-c3d4-7000-8000-0000000000f3",
  number: 41,
  title: "Webhook retries backing up",
  severity: "SEV2",
  status: "DECLARED",
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

/** Someone who started investigating: the caller, or Grace. */
const responder = (
  status: "INVESTIGATING" | "COMPLETED",
  who: "caller" | "grace" = "caller",
) => ({
  membershipId:
    who === "caller"
      ? currentUser.memberships[0].id
      : "0199a1b2-c3d4-7000-8000-0000000000ad",
  name: who === "caller" ? currentUser.name : "Grace Hopper",
  status,
  startedAt: "2026-09-18T12:05:00.000Z",
  completedAt: status === "COMPLETED" ? "2026-09-18T12:40:00.000Z" : null,
});

// Every state the response panel draws: in progress (42), awaiting (41),
// complete and ready to resolve (43), and resolved (7).
const activeDetail = {
  ...activeIncident,
  responders: [responder("INVESTIGATING"), responder("COMPLETED", "grace")],
};
const completeDetail = {
  ...activeIncident,
  number: 43,
  title: "Refunds delayed",
  responders: [responder("COMPLETED", "grace")],
};

const base = `/organizations/${organization.id}`;

/** Active incidents on one service, and a period with one resolved. */
const summary = (from: string, to: string) => ({
  current: {
    active: 2,
    activeBySeverity: { SEV1: 1, SEV2: 1, SEV3: 0, SEV4: 0 },
    affectedServices: [
      {
        ...service,
        ownerTeam: { id: team.id, name: team.name, slug: team.slug },
        activeIncidents: 2,
        worstSeverity: "SEV1",
      },
    ],
    responders: { active: 1, teams: 1 },
    activeByStatus: { DECLARED: 1, INVESTIGATING: 1 },
    typicalResolution: {
      from: "2026-06-22",
      to: "2026-09-19",
      minimumSample: 5,
      bySeverity: {
        SEV1: { resolved: 6, medianMs: 4 * 3_600_000 },
        SEV2: { resolved: 8, medianMs: 9 * 3_600_000 },
        SEV3: { resolved: 0, medianMs: null },
        SEV4: { resolved: 0, medianMs: null },
      },
    },
  },
  period: {
    from,
    to,
    declared: 3,
    declaredBySeverity: { SEV1: 1, SEV2: 1, SEV3: 1, SEV4: 0 },
    resolved: 1,
    stillOpen: 2,
    history: {
      total: 2,
      items: [
        {
          incident: activeIncident,
          declaredInPeriod: true,
          resolvedInPeriod: false,
        },
        {
          incident: resolvedIncident,
          declaredInPeriod: true,
          resolvedInPeriod: true,
        },
      ],
    },
  },
});

/**
 * The Overview's 26 weeks: every day of the window, one of them busy, so the
 * grid is drawn with something in it rather than as an empty state.
 */
const activity = (from: string, to: string) => {
  const DAY_MS = 86_400_000;
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const days = [];

  for (
    let moment = start;
    moment <= Date.parse(`${to}T00:00:00.000Z`);
    moment += DAY_MS
  ) {
    const date = new Date(moment).toISOString().slice(0, 10);
    // The most recent day, so the fixture does not depend on today's date.
    const busy = date === to;

    days.push({
      date,
      total: busy ? 8 : 0,
      level: busy ? 3 : 0,
      counts: {
        declared: busy ? 1 : 0,
        responseStarted: busy ? 2 : 0,
        update: busy ? 4 : 0,
        responseCompleted: 0,
        resolved: busy ? 1 : 0,
        changed: 0,
      },
      incidents: busy
        ? [
            {
              id: activeIncident.id,
              number: activeIncident.number,
              title: activeIncident.title,
              severity: activeIncident.severity,
              status: activeIncident.status,
              service: { name: service.name, slug: service.slug },
              events: 8,
            },
          ]
        : [],
      moreIncidents: 0,
    });
  }

  return {
    from,
    to,
    days,
    total: days.reduce((sum, day) => sum + day.total, 0),
    activeDays: days.filter((day) => day.total > 0).length,
    thresholds: [1, 3, 6, 11],
  };
};

/** One of the occurrence's ranked services: its share is of 25 incidents. */
const rankedService = (
  name: string,
  declared: number,
  archivedAt: string | null,
) => {
  const slug = name.toLowerCase().replace(/\W+/g, "-");

  return {
    id: `svc-${slug}`,
    name,
    slug,
    criticality: "HIGH" as const,
    archivedAt,
    declared,
    share: declared / 25,
  };
};

/**
 * The Overview's last thirty days: sparse, as a real month is — a few days
 * with one to three incidents, the rest quiet — with today not yet over,
 * and the average given for the days the API would give it.
 */
const occurrence = (from: string, to: string) => {
  const DAY_MS = 86_400_000;
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const days = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(start + index * DAY_MS).toISOString().slice(0, 10);
    const declared = [0, 1, 0, 0, 2, 0, 3][index % 7];

    return {
      date,
      declared,
      complete: date !== to,
      tracked: true,
      rollingAverage: date === to ? null : 0.86,
    };
  });

  return {
    from,
    to,
    asOf: `${to}T12:00:00.000Z`,
    trackedFrom: "2026-01-01",
    declared: days.reduce((sum, day) => sum + day.declared, 0),
    incidentFreeDays: days.filter((day) => day.complete && day.declared === 0)
      .length,
    completeDays: 29,
    days,
    previous: {
      from: "2026-07-01",
      to: "2026-07-30",
      declared: 20,
      comparable: true,
      minimumSample: 5,
      changePercent: 25,
    },
    // Ranked as the API ranks: one archived, and a remainder beneath.
    services: {
      top: [
        rankedService("Payment API", 9, null),
        rankedService("Authentication", 7, null),
        rankedService("Fraud Detection", 5, "2026-09-01T09:00:00.000Z"),
      ],
      others: { services: 2, declared: 4 },
    },
  };
};

const signedIn = (permissions: string[]) =>
  mockApi((request) => {
    if (route(request).startsWith(`GET ${base}/incidents/occurrence?`)) {
      const query = new URLSearchParams(request.path.split("?")[1]);

      return jsonResponse(
        200,
        occurrence(query.get("from")!, query.get("to")!),
      );
    }

    if (route(request).startsWith(`GET ${base}/incidents/summary?`)) {
      const query = new URLSearchParams(request.path.split("?")[1]);

      return jsonResponse(200, summary(query.get("from")!, query.get("to")!));
    }

    if (route(request).startsWith(`GET ${base}/incidents/activity?`)) {
      const query = new URLSearchParams(request.path.split("?")[1]);

      return jsonResponse(200, activity(query.get("from")!, query.get("to")!));
    }

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
            role: "ADMIN",
            createdAt: "2026-09-01T12:00:00.000Z",
            user: {
              id: currentUser.id,
              name: currentUser.name,
              email: currentUser.email,
              passwordChangeRequired: false,
            },
            teams: [{ id: team.id, name: team.name, slug: team.slug }],
          },
        ]);
      case `GET ${base}/memberships/${currentUser.memberships[0].id}`:
        return jsonResponse(200, {
            id: currentUser.memberships[0].id,
            role: "ADMIN",
            createdAt: "2026-09-01T12:00:00.000Z",
            user: {
              id: currentUser.id,
              name: currentUser.name,
              email: currentUser.email,
              passwordChangeRequired: false,
            },
            teams: [{ id: team.id, name: team.name, slug: team.slug }],
          });
      case `GET ${base}/teams`:
        return jsonResponse(200, [team]);
      case `GET ${base}/services`:
        return jsonResponse(200, [service]);
      case `GET ${base}/incidents?state=active`:
        return jsonResponse(200, {
          items: [activeIncident, majorIncident],
          page: { cursor: null, hasMore: false },
        });
      case `GET ${base}/incidents?state=resolved`:
        return jsonResponse(200, {
          items: [resolvedIncident],
          page: { cursor: "7", hasMore: true },
        });
      case `GET ${base}/incidents/42`:
        return jsonResponse(200, activeDetail);
      case `GET ${base}/incidents/43`:
        return jsonResponse(200, completeDetail);
      case `GET ${base}/incidents/41`:
        return jsonResponse(200, { ...majorIncident, responders: [] });
      case `GET ${base}/incidents/7/analysis`:
        return resolvedAnalysis
          ? jsonResponse(200, resolvedAnalysis)
          : apiError(404, "ANALYSIS_NOT_STARTED");
      case `GET ${base}/incidents/7`:
        return jsonResponse(200, {
          ...resolvedIncident,
          responders: [responder("COMPLETED")],
        });
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
    resolvedAnalysis = null;
  });

  afterEach(() => {
    window.location.hash = "";
  });

  describe("workspace", () => {
    it("Overview", async () => {
      signedIn(ADMIN);
      const { container } = inWorkspace(<OrganizationOverview />);

      await screen.findByRole("heading", { level: 1, name: "Overview" });
      await screen.findByRole("list", { name: "Active incidents" });
      await screen.findByRole("list", { name: "Incidents declared per day" });
      await screen.findByRole("list", { name: "Services under pressure" });
      await screen.findByRole("grid", { name: /Operational activity/ });
      await expectNoAxeViolations(container);
      // A year of days is ~370 squares for axe to walk, which jsdom does far
      // more slowly than a browser.
    }, 30_000);

    it("Overview, with a day of the incident trend focused", async () => {
      signedIn(ADMIN);
      const { container } = inWorkspace(<OrganizationOverview />);

      const days = await screen.findByRole("list", {
        name: "Incidents declared per day",
      });
      const today = days.querySelector<HTMLElement>('[tabindex="0"]')!;

      today.focus();
      await userEvent.keyboard("{ArrowLeft}");
      await expectNoAxeViolations(container);
    }, 30_000);

    it("Overview, with a day of activity chosen", async () => {
      signedIn(ADMIN);
      const { container } = inWorkspace(<OrganizationOverview />);

      const grid = await screen.findByRole("grid", {
        name: /Operational activity/,
      });
      // The one day with anything on it, wherever its weekday puts it.
      const busy = grid.querySelector<HTMLButtonElement>('[data-level="3"]');

      await userEvent.click(busy!);
      await screen.findByLabelText("What happened on this day");
      await expectNoAxeViolations(container);
    }, 30_000);

    // The same address as Overview, for a caller who does not oversee the
    // organization. Nothing loads, so nothing is awaited but the heading.
    it("My Operations", async () => {
      signedIn(MEMBER);
      const { container } = inWorkspace(<OrganizationLanding />);

      await screen.findByRole("heading", { level: 1, name: "My Operations" });
      await expectNoAxeViolations(container);
    });

    it("Incident history, as a member who does not oversee it", async () => {
      navigation.pathname = `/orgs/${organization.slug}/incidents/history`;
      signedIn(MEMBER);
      const { container } = inWorkspace(<IncidentHistory />);

      await screen.findByRole("heading", { level: 1, name: "Incident history" });
      await screen.findByText("No history to show");
      await expectNoAxeViolations(container);
    });

    it("Incident history", async () => {
      navigation.pathname = `/orgs/${organization.slug}/incidents/history`;
      signedIn(ADMIN);
      const { container } = inWorkspace(<IncidentHistory />);

      await screen.findByRole("heading", { level: 1, name: "Incident history" });
      await screen.findByRole("region", { name: "Incidents in this period" });
      await expectNoAxeViolations(container);
    });

    it("Incident history, choosing a custom period", async () => {
      navigation.pathname = `/orgs/${organization.slug}/incidents/history`;
      signedIn(ADMIN);
      const { container } = inWorkspace(<IncidentHistory />);

      await userEvent.click(await screen.findByRole("tab", { name: "Custom" }));
      await screen.findByRole("dialog", { name: "Choose dates (UTC)" });
      await expectNoAxeViolations(container);
    });

    it("Members, as the admin", async () => {
      signedIn(ADMIN);
      const { container } = inWorkspace(<MembersView />);

      await screen.findByRole("table", { name: "Members" });
      await screen.findByRole("button", { name: "Add member" });
      await expectNoAxeViolations(container);
    });

it("Members, About roles open", async () => {      signedIn(ADMIN);      const { container } = inWorkspace(<MembersView />);      (await screen.findByRole("button", { name: "About roles" })).click();      await screen.findByRole("dialog", { name: "Roles in SentinelOps" });      await expectNoAxeViolations(container);    });
    it("Add member, choosing teams", async () => {
      signedIn(ADMIN);
      const { container } = inWorkspace(<MembersView />);

      (await screen.findByRole("button", { name: "Add member" })).click();
      await screen.findByRole("dialog", { name: "Add member" });
      await screen.findByRole("checkbox", { name: team.name });
      await expectNoAxeViolations(container);
    });

    it("Member, as the admin", async () => {
      signedIn(ADMIN);
      navigation.params = {
        orgSlug: organization.slug,
        membershipId: currentUser.memberships[0].id,
      };
      const { container } = inWorkspace(<MemberDetail />);

      await screen.findByRole("heading", { level: 1, name: currentUser.name });
      await screen.findByLabelText(`${currentUser.name} at a glance`);
      await expectNoAxeViolations(container);
    });

    it("Member, as a member", async () => {
      signedIn(MEMBER);
      navigation.params = {
        orgSlug: organization.slug,
        membershipId: currentUser.memberships[0].id,
      };
      const { container } = inWorkspace(<MemberDetail />);

      await screen.findByRole("heading", { level: 1, name: currentUser.name });
      await screen.findByRole("link", { name: team.name });
      await expectNoAxeViolations(container);
    });

    it("Members, with a row opened", async () => {
      signedIn(ADMIN);
      const { container } = inWorkspace(<MembersView />);

      (
        await screen.findByRole("button", {
          name: `Show teams of ${currentUser.name}`,
        })
      ).click();
      await screen.findByRole("region", {
        name: `Teams of ${currentUser.name}`,
      });
      await expectNoAxeViolations(container);
    });

    it("Members, adding someone to a team", async () => {
      signedIn(ADMIN);
      const { container } = inWorkspace(<MembersView />);

      (
        await screen.findByRole("button", {
          name: `Add ${currentUser.name} to a team`,
        })
      ).click();
      await screen.findByRole("dialog", {
        name: `Add ${currentUser.name} to a team`,
      });
      await expectNoAxeViolations(container);
    });

    it("Members, removing someone from a team", async () => {
      signedIn(ADMIN);
      const { container } = inWorkspace(<MembersView />);

      (
        await screen.findByRole("button", {
          name: `Remove ${currentUser.name} from a team`,
        })
      ).click();
      const dialog = await screen.findByRole("dialog", {
        name: `Remove ${currentUser.name} from a team`,
      });
      await within(dialog).findByRole("radio");
      await expectNoAxeViolations(container);
    });

    it("Members, as a member", async () => {
      signedIn(MEMBER);
      const { container } = inWorkspace(<MembersView />);

      await screen.findByRole("table", { name: "Members" });
      await expectNoAxeViolations(container);
    });

    it("Settings", async () => {
      signedIn(ADMIN);
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

    it("New team, as an owner", async () => {
      signedIn(ADMIN);
      const { container } = inWorkspace(<TeamsView />);

      (await screen.findAllByRole("button", { name: "New team" }))[0].click();
      await screen.findByRole("dialog", { name: "New team" });
      await screen.findByLabelText("Name");
      await expectNoAxeViolations(container);
    });

    it("Team, as an owner", async () => {
      navigation.params = { orgSlug: organization.slug, teamId: team.slug };
      signedIn(ADMIN);
      const { container } = inWorkspace(
        <TeamScope>
          <TeamDetail />
        </TeamScope>,
      );

      await screen.findByRole("list", { name: "Members of Platform" });
      await screen.findByLabelText("Platform at a glance");
      await expectNoAxeViolations(container);
    });

    it("Team, as a member", async () => {
      navigation.params = { orgSlug: organization.slug, teamId: team.slug };
      signedIn(MEMBER);
      const { container } = inWorkspace(
        <TeamScope>
          <TeamDetail />
        </TeamScope>,
      );

      await screen.findByRole("list", { name: "Members of Platform" });
      await expectNoAxeViolations(container);
    });

    it("Teams, with a row opened", async () => {
      signedIn(ADMIN);
      const { container } = inWorkspace(<TeamsView />);

      (
        await screen.findByRole("button", {
          name: "Show members and services of Platform",
        })
      ).click();
      await screen.findByRole("region", { name: "Members of Platform" });
      await expectNoAxeViolations(container);
    });

    it("Edit team, from the Teams list", async () => {
      signedIn(ADMIN);
      const { container } = inWorkspace(<TeamsView />);

      (await screen.findByRole("button", { name: "Edit Platform" })).click();
      await screen.findByRole("dialog", { name: "Edit team" });
      // The team owns a service, so deletion is explained rather than offered.
      await screen.findByText("This team owns services");
      await expectNoAxeViolations(container);
    });

    it("Services, as an owner creating one", async () => {
      signedIn(ADMIN);
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

it("Services, with a row opened", async () => {      signedIn(ADMIN);      const { container } = inWorkspace(<ServicesView />);      (        await screen.findByRole("button", {          name: `Show incidents and responders of ${service.name}`,        })      ).click();      await screen.findByRole("region", { name: `Who responds to ${service.name}` });      await expectNoAxeViolations(container);    });
    it("Edit service, from the Services list", async () => {
      signedIn(ADMIN);
      const { container } = inWorkspace(<ServicesView />);

      (
        await screen.findByRole("button", { name: `Edit ${service.name}` })
      ).click();
      await screen.findByRole("dialog", { name: "Edit service" });
      await screen.findByRole("combobox", { name: "Owner team" });
      await expectNoAxeViolations(container);
    });

    it("Incidents, as the admin declaring one", async () => {
      signedIn(ADMIN);
      const { container } = inWorkspace(<IncidentsView />);

      await screen.findByRole("table", { name: "Active incidents" });
      await screen.findByRole("table", { name: "Resolved incidents" });
      (await screen.findByRole("button", { name: "Declare incident" })).click();
      await screen.findByLabelText("Affected service");
      await expectNoAxeViolations(container);
    });

    it("Incident, response in progress, as the admin", async () => {
      navigation.params = { orgSlug: organization.slug, incidentNumber: "42" };
      signedIn(ADMIN);
      const { container } = inWorkspace(<IncidentDetail />);

      await screen.findByRole("heading", { level: 1, name: "Card payments failing" });
      await screen.findByRole("heading", { name: "Response in progress" });
      await screen.findByRole("list", { name: "Responders" });
      await screen.findByRole("group", { name: "Response counts" });
      await expectNoAxeViolations(container);
    });

    it("Incident, managed in the drawer, as the admin", async () => {
      navigation.params = { orgSlug: organization.slug, incidentNumber: "42" };
      signedIn(ADMIN);
      const { container } = inWorkspace(<IncidentDetail />);

      (await screen.findByRole("button", { name: "Manage incident" })).click();
      await screen.findByRole("dialog", { name: "Manage incident" });
      await screen.findByLabelText("Responsible team");
      await expectNoAxeViolations(container);
    });

    it("Incident, response complete, as the admin resolving it", async () => {
      navigation.params = { orgSlug: organization.slug, incidentNumber: "43" };
      signedIn(ADMIN);
      const { container } = inWorkspace(<IncidentDetail />);

      await screen.findByRole("heading", { name: "Response work complete" });
      (await screen.findByRole("button", { name: "Resolve incident" })).click();
      await screen.findByRole("button", { name: "Cancel" });
      await expectNoAxeViolations(container);
    });

    it("Incident, declared, as the admin", async () => {
      navigation.params = { orgSlug: organization.slug, incidentNumber: "41" };
      signedIn(ADMIN);
      const { container } = inWorkspace(<IncidentDetail />);

      await screen.findByRole("heading", { level: 1, name: "Webhook retries backing up" });
      await screen.findByRole("heading", { name: "Awaiting team response" });
      await expectNoAxeViolations(container);
    });

    it("Incident, declared, as a member of the responsible team", async () => {
      navigation.params = { orgSlug: organization.slug, incidentNumber: "41" };
      signedIn(MEMBER);
      const { container } = inWorkspace(<IncidentDetail />);

      await screen.findByRole("button", { name: "Start investigating" });
      await expectNoAxeViolations(container);
    });

    it("Incident, active, as a member investigating it", async () => {
      navigation.params = { orgSlug: organization.slug, incidentNumber: "42" };
      signedIn(MEMBER);
      const { container } = inWorkspace(<IncidentDetail />);

      await screen.findByRole("heading", { level: 1, name: "Card payments failing" });
      await screen.findByLabelText("Post an update");
      await screen.findByRole("button", { name: "Mark my response complete" });
      await expectNoAxeViolations(container);
    });

    it("Incident, resolved", async () => {
      navigation.params = { orgSlug: organization.slug, incidentNumber: "7" };
      signedIn(MEMBER);
      const { container } = inWorkspace(<IncidentDetail />);

      await screen.findByRole("heading", { level: 1, name: "Reports delayed" });
      await screen.findByRole("heading", { name: "Your response" });
      await expectNoAxeViolations(container);
    });

    it("Incident, resolved, as the admin starting its analysis", async () => {
      navigation.params = { orgSlug: organization.slug, incidentNumber: "7" };
      signedIn(ADMIN);
      const { container } = inWorkspace(<IncidentDetail />);

      (await screen.findByRole("button", { name: "Start analysis" })).click();
      await screen.findByRole("dialog", { name: "Start analysis" });
      await screen.findByLabelText("Owner");
      await expectNoAxeViolations(container);
    });

    it("Incident, resolved, with a draft analysis", async () => {
      navigation.params = { orgSlug: organization.slug, incidentNumber: "7" };
      resolvedAnalysis = analysis("DRAFT");
      signedIn(MEMBER);
      const { container } = inWorkspace(<IncidentDetail />);

      await screen.findByRole("link", { name: "Open draft" });
      await expectNoAxeViolations(container);
    });

    it("Incident, resolved, with a published analysis", async () => {
      navigation.params = { orgSlug: organization.slug, incidentNumber: "7" };
      resolvedAnalysis = analysis("PUBLISHED");
      signedIn(MEMBER);
      const { container } = inWorkspace(<IncidentDetail />);

      await screen.findByRole("link", { name: "Read analysis" });
      await expectNoAxeViolations(container);
    });

    it("Incident analysis, draft", async () => {
      navigation.params = { orgSlug: organization.slug, incidentNumber: "7" };
      resolvedAnalysis = analysis("DRAFT");
      signedIn(MEMBER);
      const { container } = inWorkspace(<IncidentAnalysisPage />);

      await screen.findByRole("heading", { level: 1, name: "Incident analysis" });
      await screen.findByRole("heading", { name: "Incident facts" });
      await screen.findByRole("heading", { name: /Key moments/ });
      await expectNoAxeViolations(container);
    });

    it("Incident analysis, draft read by someone else", async () => {
      navigation.params = { orgSlug: organization.slug, incidentNumber: "7" };
      resolvedAnalysis = analysis("DRAFT", {
        membershipId: "0199a1b2-c3d4-7000-8000-0000000000ab",
        name: "Daniel Okafor",
      });
      signedIn(MEMBER);
      const { container } = inWorkspace(<IncidentAnalysisPage />);

      await screen.findByText(/Daniel Okafor is writing this analysis/);
      await screen.findByRole("heading", { name: /Key moments/ });
      await expectNoAxeViolations(container);
    });

    it("Incident analysis, published", async () => {
      navigation.params = { orgSlug: organization.slug, incidentNumber: "7" };
      resolvedAnalysis = analysis("PUBLISHED");
      signedIn(MEMBER);
      const { container } = inWorkspace(<IncidentAnalysisPage />);

      await screen.findByText("This analysis is final. It is kept as published.");
      await screen.findByRole("heading", { name: /Key moments/ });
      await expectNoAxeViolations(container);
    });

    it("Incident analysis, not started, as the admin", async () => {
      navigation.params = { orgSlug: organization.slug, incidentNumber: "7" };
      signedIn(ADMIN);
      const { container } = inWorkspace(<IncidentAnalysisPage />);

      await screen.findByText("No analysis yet");
      await screen.findByRole("button", { name: "Start analysis" });
      await expectNoAxeViolations(container);
    });

    it("Incident analysis, incident still active", async () => {
      navigation.params = { orgSlug: organization.slug, incidentNumber: "42" };
      signedIn(MEMBER);
      const { container } = inWorkspace(<IncidentAnalysisPage />);

      await screen.findByText(/An analysis begins once INC-42 is resolved/);
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
      signedIn(ADMIN);
      const { container } = inWorkspace(<OrganizationOverview />);

      await screen.findByRole("heading", { name: "Organization not found" });
      await expectNoAxeViolations(container);
    });

    it("Your organizations", async () => {
      navigation.params = {};
      navigation.pathname = "/orgs";
      signedIn(ADMIN);
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

    it("Choose your password, on a one-time password", async () => {
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
      const { container } = renderWithSession(
        <AuthFrame>
          <ChangePasswordForm />
        </AuthFrame>,
      );

      await screen.findByLabelText("Confirm new password");
      await expectNoAxeViolations(container);
    });
  });
});
