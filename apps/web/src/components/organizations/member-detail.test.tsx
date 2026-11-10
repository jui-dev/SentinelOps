import { screen, within } from "@testing-library/react";
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

import { MemberDetail } from "./member-detail";
import { MembersView } from "./members-view";
import { OrganizationScope } from "./organization-scope";

const GRACE = "0199a1b2-c3d4-7000-8000-0000000000bb";
/** The caller's own membership, as organizationDetail reports it. */
const SELF = "0199a1b2-c3d4-7000-8000-0000000000aa";

const navigation = vi.hoisted(() => ({ membershipId: "" }));

vi.mock("next/navigation", () => ({
  useParams: () => ({
    orgSlug: "acme-ops",
    membershipId: navigation.membershipId,
  }),
  usePathname: () => "/orgs/acme-ops/members",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const ADMIN = [
  "members:manage",
  "memberships:read",
  "memberships:read-all",
  "organization:read",
  "teams:manage",
  "teams:read",
];
const MEMBER = ["memberships:read", "organization:read", "teams:read"];

const base = `/organizations/${organization.id}`;

const team = (id: string, name: string) => ({
  id,
  name,
  slug: name.toLowerCase(),
  description: null,
  memberCount: 0,
  serviceCount: 0,
  createdAt: "2026-09-18T12:00:00.000Z",
  updatedAt: "2026-09-18T12:00:00.000Z",
});

const PAYMENTS = team("0199a1b2-c3d4-7000-8000-0000000000d1", "Payments");
const PLATFORM = team("0199a1b2-c3d4-7000-8000-0000000000d2", "Platform");
const RISK = team("0199a1b2-c3d4-7000-8000-0000000000d3", "Risk");
const ref = ({ id, name, slug }: typeof PAYMENTS) => ({ id, name, slug });

const grace = (teams: (typeof PAYMENTS)[], passwordChangeRequired = false) => ({
  id: GRACE,
  role: "MEMBER",
  createdAt: "2026-09-19T12:00:00.000Z",
  user: {
    id: "0199a1b2-c3d4-7000-8000-000000000002",
    name: "Grace Hopper",
    email: "grace@example.com",
    passwordChangeRequired,
  },
  teams: teams.map(ref),
});

type Handler = (request: SentRequest) => Response | undefined;

/**
 * The API, with Grace's teams held as state: placing and removing change
 * what the next read of her record returns, as the real API would.
 */
const api = (
  permissions: string[],
  initial: (typeof PAYMENTS)[],
  handler: Handler = () => undefined,
) => {
  let teams = [...initial];

  return mockApi((request) => {
    const handled = handler(request);

    if (handled) return handled;

    const path = route(request);

    if (path.startsWith(`POST ${base}/teams/`) && path.endsWith("/members")) {
      const teamId = path.split("/teams/")[1].split("/")[0];
      const placed = [PAYMENTS, PLATFORM, RISK].find(({ id }) => id === teamId);
      if (placed) teams = [...teams, placed].sort((a, b) => a.name.localeCompare(b.name));
      return jsonResponse(201, {
        membershipId: GRACE,
        addedAt: "2026-09-19T12:00:00.000Z",
        user: grace([]).user,
      });
    }

    if (path.startsWith(`DELETE ${base}/teams/`)) {
      const teamId = path.split("/teams/")[1].split("/")[0];
      teams = teams.filter(({ id }) => id !== teamId);
      return jsonResponse(204);
    }

    switch (path) {
      case "POST /auth/refresh":
        return refreshed("token");
      case "GET /auth/me":
        return jsonResponse(200, currentUser);
      case `GET ${base}`:
        return jsonResponse(200, organizationDetail(permissions));
      case `GET ${base}/memberships/${GRACE}`:
        return jsonResponse(200, grace(teams));
      case `GET ${base}/memberships`:
        return jsonResponse(200, [grace(teams)]);
      case `GET ${base}/teams`:
        return jsonResponse(200, [PAYMENTS, PLATFORM, RISK]);
      default:
        return apiError(404);
    }
  });
};

const renderMember = () =>
  renderWithSession(
    <OrganizationScope>
      <MemberDetail />
    </OrganizationScope>,
  );

describe("a member's page", () => {
  beforeEach(() => {
    clearAccessToken();
    navigation.membershipId = GRACE;
  });

  it("is reached from the member's View action in the Members table", async () => {
    api(ADMIN, []);

    renderWithSession(
      <OrganizationScope>
        <MembersView />
      </OrganizationScope>,
    );

    expect(
      (
        await screen.findByRole("link", { name: "View Grace Hopper" })
      ).getAttribute("href"),
    ).toBe(`/orgs/acme-ops/members/${GRACE}`);
  });

  it("shows who they are, their role and status, with a way back", async () => {
    api(ADMIN, [], (request) =>
      route(request) === `GET ${base}/memberships/${GRACE}`
        ? jsonResponse(200, grace([], true))
        : undefined,
    );

    renderMember();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Grace Hopper" }),
    ).toBeDefined();
    expect(screen.getByText("grace@example.com")).toBeDefined();
    expect(screen.getByText("Awaiting first sign-in")).toBeDefined();

    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(
      within(breadcrumb).getByRole("link", { name: "Members" }).getAttribute("href"),
    ).toBe("/orgs/acme-ops/members");
  });

  it("gives facts about them at a glance, never measures", async () => {
    api(ADMIN, [PAYMENTS, PLATFORM]);

    renderMember();

    const glance = await screen.findByLabelText("Grace Hopper at a glance");
    const value = (term: string) =>
      within(glance).getByText(term).nextSibling?.textContent;

    expect(value("Role")).toBe("Member");
    expect(value("Teams")).toBe("2");
    expect(value("Joined")).toMatch(/2026/);
    // Nothing that counts or compares their work.
    expect(within(glance).queryByText(/respons|incident/i)).toBeNull();
  });

  it("lists their teams, each linking to the team", async () => {
    api(ADMIN, [PAYMENTS, PLATFORM]);

    renderMember();

    const teams = await screen.findByRole("list", { name: "Teams of Grace Hopper" });
    const links = within(teams).getAllByRole("link");

    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Payments", "/orgs/acme-ops/teams/payments"],
      ["Platform", "/orgs/acme-ops/teams/platform"],
    ]);
  });

  it("is read only, and says where placement is changed", async () => {
    const { requests } = api(ADMIN, [PAYMENTS]);

    renderMember();

    await screen.findByRole("list", { name: "Teams of Grace Hopper" });

    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Add to team/ })).toBeNull();
    expect(screen.queryByLabelText("Add to team")).toBeNull();
    expect(
      screen.getByText(/To add Grace to a team or take them off one/),
    ).toBeDefined();
    expect(
      within(screen.getByRole("region", { name: /^Teams/ }))
        .getByRole("link", { name: "Members" })
        .getAttribute("href"),
    ).toBe("/orgs/acme-ops/members");
    // It asks nothing that only placing would need.
    expect(requests.some((r) => route(r) === `GET ${base}/teams`)).toBe(false);
  });

  it("warns that a Member on no team sees no incidents, and says where to fix it", async () => {
    api(ADMIN, []);

    renderMember();

    const alert = await screen.findByText("Grace is on no team");

    expect(alert).toBeDefined();
    expect(screen.getByText(/sees no incidents and can respond to none/)).toBeDefined();
    expect(screen.getByText("Not on any team yet")).toBeDefined();
  });

  it("shows the services their teams own, as what they respond to", async () => {
    const owned = (n: number, name: string, owner: typeof PAYMENTS) => ({
      id: `0199a1b2-c3d4-7000-8000-0000000000f${n}`,
      name,
      slug: name.toLowerCase().replace(/\s+/g, "-"),
      description: null,
      criticality: "CRITICAL",
      ownerTeam: ref(owner),
      archivedAt: null,
      createdAt: "2026-09-18T12:00:00.000Z",
      updatedAt: "2026-09-18T12:00:00.000Z",
    });
    api([...ADMIN, "services:read"], [PAYMENTS], (request) =>
      route(request) === `GET ${base}/services`
        ? jsonResponse(200, [
            owned(1, "Payment API", PAYMENTS),
            owned(2, "Fraud Detection", RISK),
          ])
        : undefined,
    );

    renderMember();

    const covers = await screen.findByRole("list", {
      name: "Services Grace Hopper responds to",
    });

    expect(
      within(covers).getByRole("link", { name: /Payment API/ }).getAttribute("href"),
    ).toBe("/orgs/acme-ops/services/payment-api");
    expect(within(covers).getByText("via Payments")).toBeDefined();
    expect(within(covers).queryByText("Fraud Detection")).toBeNull();
    // The team says what it owns, too.
    expect(screen.getByText("Owns Payment API")).toBeDefined();
  });

  it("shows a member a colleague without account setup or a placement warning", async () => {
    // As the API answers a member: the colleague with no setup status.
    api(MEMBER, [], (request) => {
      if (route(request) !== `GET ${base}/memberships/${GRACE}`) return undefined;

      const colleague = grace([], true);
      const user: Partial<typeof colleague.user> = { ...colleague.user };

      delete user.passwordChangeRequired;

      return jsonResponse(200, { ...colleague, user });
    });

    renderMember();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Grace Hopper" }),
    ).toBeDefined();
    expect(screen.queryByText("Awaiting first sign-in")).toBeNull();
    expect(screen.queryByText("Active")).toBeNull();
    // Placement is the Admin's to fix, so the warning is theirs too.
    expect(screen.queryByText("Grace is on no team")).toBeNull();
    // Reached from a team's page, so the way back is Teams, not Members.
    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });

    expect(
      within(breadcrumb).getByRole("link", { name: "Teams" }).getAttribute("href"),
    ).toBe("/orgs/acme-ops/teams");
    expect(within(breadcrumb).queryByRole("link", { name: "Members" })).toBeNull();
  });

  it("tells a Member that an Admin changes teams", async () => {
    api(MEMBER, [PAYMENTS]);

    renderMember();

    expect(
      await screen.findByRole("link", { name: "Payments" }),
    ).toBeDefined();
    expect(screen.getByText("Teams are changed by an Admin.")).toBeDefined();
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
  });

  it("answers a member that is not in this organization with a not-found page", async () => {
    navigation.membershipId = "0199a1b2-c3d4-7000-8000-0000000000ff";
    api(ADMIN, []);

    renderMember();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Member not found" }),
    ).toBeDefined();
    expect(
      screen.getByRole("link", { name: "All members" }).getAttribute("href"),
    ).toBe("/orgs/acme-ops/members");
  });
  describe("their recent responses", () => {
    // Another member's history is oversight's to read: the API answers it
    // only to `incidents:read-all`, so that is what this panel is shown on.
    const WITH_INCIDENTS = [...MEMBER, "incidents:read", "incidents:read-all"];
    const responses = `GET ${base}/memberships/${GRACE}/responses`;

    const response = (
      number: number,
      status: "INVESTIGATING" | "COMPLETED",
      incidentStatus = "INVESTIGATING",
    ) => ({
      incident: {
        id: `0199a1b2-c3d4-7000-8000-0000000001${number}0`,
        number,
        title: `Card declines ${number}`,
        summary: null,
        severity: "SEV2",
        status: incidentStatus,
        service: {
          id: "0199a1b2-c3d4-7000-8000-0000000000e1",
          name: "Payment API",
          slug: "payment-api",
          criticality: "CRITICAL",
          archivedAt: null,
        },
        team: { id: PAYMENTS.id, name: "Payments", slug: "payments" },
        createdBy: { id: currentUser.id, name: "Ada Lovelace" },
        createdAt: "2026-09-18T12:00:00.000Z",
        updatedAt: "2026-09-18T12:00:00.000Z",
        resolvedAt: incidentStatus === "RESOLVED" ? "2026-09-18T14:00:00.000Z" : null,
      },
      status,
      startedAt: "2026-09-18T12:05:00.000Z",
      completedAt: status === "COMPLETED" ? "2026-09-18T13:15:00.000Z" : null,
    });

    it("lists the incidents they started, their own part in each, and links to them — with no count", async () => {
      api(WITH_INCIDENTS, [PAYMENTS], (request) =>
        route(request) === responses
          ? jsonResponse(200, {
              items: [response(7, "INVESTIGATING"), response(5, "COMPLETED", "RESOLVED")],
              page: { cursor: null, hasMore: false },
            })
          : undefined,
      );

      renderMember();

      const table = await screen.findByRole("table", { name: "Recent responses" });

      // Each column says what it holds.
      expect(
        within(table)
          .getAllByRole("columnheader")
          .map((header) => header.textContent),
      ).toEqual([
        "Severity",
        "Incident",
        "Service",
        "Team",
        "Their part",
        "Incident status",
      ]);

      const rows = within(table).getAllByRole("row").slice(1);

      expect(rows).toHaveLength(2);
      expect(rows[0].textContent).toMatch(/INC-7.*Card declines 7.*Investigating for/);
      expect(rows[1].textContent).toMatch(/INC-5.*Card declines 5.*Completed after .*Resolved/);
      expect(
        within(rows[0]).getByRole("link").getAttribute("href"),
      ).toBe("/orgs/acme-ops/incidents/7");
      // Descriptive history, not a measure.
      const heading = screen.getByRole("heading", { name: "Recent responses" });

      expect(heading.textContent).toBe("Recent responses");
    });

    it("loads more on request, by the API's cursor", async () => {
      const user = userEvent.setup();
      const { requests } = api(WITH_INCIDENTS, [PAYMENTS], (request) =>
        route(request) === responses
          ? jsonResponse(200, {
              items: [response(7, "INVESTIGATING")],
              page: { cursor: "c1", hasMore: true },
            })
          : route(request) === `${responses}?cursor=c1`
            ? jsonResponse(200, {
                items: [response(3, "COMPLETED")],
                page: { cursor: null, hasMore: false },
              })
            : undefined,
      );

      renderMember();

      await user.click(await screen.findByRole("button", { name: "Show more" }));

      expect(await screen.findByText("Card declines 3")).toBeDefined();
      expect(requests.filter((r) => route(r) === `${responses}?cursor=c1`)).toHaveLength(1);
      expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
    });

    it("says plainly when they have not responded to anything", async () => {
      api(WITH_INCIDENTS, [PAYMENTS], (request) =>
        route(request) === responses
          ? jsonResponse(200, { items: [], page: { cursor: null, hasMore: false } })
          : undefined,
      );

      renderMember();

      expect(await screen.findByText("No incident responses yet")).toBeDefined();
    });

    it("is not asked for without incidents:read", async () => {
      const { requests } = api(MEMBER, [PAYMENTS]);

      renderMember();

      expect(await screen.findByRole("heading", { name: /^Teams/ })).toBeDefined();
      expect(screen.queryByRole("heading", { name: "Recent responses" })).toBeNull();
      expect(requests.some((r) => route(r).startsWith(responses))).toBe(false);
    });

    it("is not asked for on another member without oversight of every incident", async () => {
      const { requests } = api([...MEMBER, "incidents:read"], [PAYMENTS]);

      renderMember();

      expect(await screen.findByRole("heading", { name: /^Teams/ })).toBeDefined();
      expect(screen.queryByRole("heading", { name: "Recent responses" })).toBeNull();
      expect(requests.some((r) => route(r).startsWith(responses))).toBe(false);
    });

    it("is shown on a member's own page, with only incidents:read", async () => {
      const own = `GET ${base}/memberships/${SELF}/responses`;

      navigation.membershipId = SELF;
      const { requests } = api([...MEMBER, "incidents:read"], [PAYMENTS], (request) =>
        route(request) === `GET ${base}/memberships/${SELF}`
          ? jsonResponse(200, { ...grace([PAYMENTS]), id: SELF })
          : route(request) === own
            ? jsonResponse(200, {
                items: [response(7, "INVESTIGATING")],
                page: { cursor: null, hasMore: false },
              })
            : undefined,
      );

      renderMember();

      expect(await screen.findByText("Card declines 7")).toBeDefined();
      expect(requests.some((r) => route(r) === own)).toBe(true);
    });
  });
});
