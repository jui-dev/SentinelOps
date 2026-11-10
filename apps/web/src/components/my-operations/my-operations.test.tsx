import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MyOperations } from "@/components/my-operations/my-operations";
import { OrganizationScope } from "@/components/organizations/organization-scope";
import type {
  IncidentAttentionResponse,
  IncidentDetailResponse,
  IncidentListItemResponse,
  TeamResponse,
} from "@/lib/api/contracts";
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
import { expectNoAxeViolations } from "@/test/axe";
import { renderWithSession } from "@/test/render";

vi.mock("next/navigation", () => ({
  useParams: () => ({ orgSlug: "acme-ops" }),
  usePathname: () => "/orgs/acme-ops",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

/** A member: they read and respond to incidents, and oversee nothing. */
const MEMBER = [
  "incident-analyses:write",
  "incidents:read",
  "incidents:respond",
  "memberships:read",
  "organization:read",
  "services:read",
  "teams:read",
];

const base = `/organizations/${organization.id}`;
const ME = organizationDetail(MEMBER, "MEMBER").membership.id;

const team = (id: string, name: string, serviceCount: number): TeamResponse => ({
  id,
  name,
  slug: name.toLowerCase(),
  description: null,
  memberCount: 4,
  serviceCount,
  createdAt: "2026-09-01T12:00:00.000Z",
  updatedAt: "2026-09-01T12:00:00.000Z",
});

const payments = team("0199a1b2-c3d4-7000-8000-0000000000c1", "Payments", 3);
const risk = team("0199a1b2-c3d4-7000-8000-0000000000c2", "Risk", 2);
const platform = team("0199a1b2-c3d4-7000-8000-0000000000c3", "Platform", 1);

const detail = (
  number: number,
  overrides: Partial<IncidentDetailResponse> = {},
): IncidentDetailResponse => ({
  id: `0199a1b2-c3d4-7000-8000-0000000000${number}`,
  number,
  title: `Incident ${number}`,
  summary: null,
  severity: "SEV2",
  status: "DECLARED",
  service: {
    id: "0199a1b2-c3d4-7000-8000-0000000000e1",
    name: "Payment API",
    slug: "payment-api",
    criticality: "CRITICAL",
    archivedAt: null,
  },
  team: { id: payments.id, name: payments.name, slug: payments.slug },
  createdBy: { id: currentUser.id, name: "Ada Lovelace" },
  createdAt: "2026-11-10T12:15:00.000Z",
  updatedAt: "2026-11-10T12:15:00.000Z",
  resolvedAt: null,
  resolution: null,
  responders: [],
  ...overrides,
});

/** Nobody on Payments has started it. */
const unclaimed = detail(76, {
  title: "Card network declines spike",
  severity: "SEV1",
});

/** The member's own response, started at 13:30. */
const mine = detail(74, {
  title: "Elevated authorization latency",
  status: "INVESTIGATING",
  createdAt: "2026-11-10T09:30:00.000Z",
  responders: [
    {
      membershipId: ME,
      name: "Priya Shah",
      status: "INVESTIGATING",
      startedAt: "2026-11-10T13:30:00.000Z",
      completedAt: null,
    },
  ],
});

const listItem = (incident: IncidentDetailResponse): IncidentListItemResponse => ({
  ...incident,
  response: { investigating: 0, completed: 0 },
  lastUpdateAt: null,
});

/** A Platform incident the member responded to: visible, but not their team's. */
const elsewhere = detail(80, {
  title: "Login latency",
  team: { id: platform.id, name: platform.name, slug: platform.slug },
});

const api = ({
  permissions = MEMBER,
  teams = [payments, risk],
  attention = {
    manage: null,
    respond: { needsYourTeam: [unclaimed], yourResponses: [mine] },
  },
  active = [unclaimed, mine, elsewhere],
}: {
  permissions?: string[];
  teams?: TeamResponse[];
  attention?: IncidentAttentionResponse;
  active?: IncidentDetailResponse[];
} = {}) =>
  mockApi((request) => {
    switch (route(request)) {
      case "POST /auth/refresh":
        return refreshed("token");
      case "GET /auth/me":
        return jsonResponse(200, currentUser);
      case `GET ${base}`:
        return jsonResponse(200, organizationDetail(permissions, "MEMBER"));
      case `GET ${base}/teams`:
        return jsonResponse(200, teams);
      case `GET ${base}/incidents/attention`:
        return jsonResponse(200, attention);
      case `GET ${base}/incidents?state=active`:
        return jsonResponse(200, {
          items: active.map(listItem),
          page: { cursor: null, hasMore: false },
        });
      default:
        return apiError(404);
    }
  });

const renderPage = () =>
  renderWithSession(
    <OrganizationScope>
      <MyOperations />
    </OrganizationScope>,
  );

/** What a tile says: its value, then its note. */
const tile = (label: string) =>
  within(screen.getByLabelText("Your work now")).getByText(label)
    .nextElementSibling?.textContent;

describe("My Operations", () => {
  beforeEach(() => {
    clearAccessToken();
    // Only Date: the queries' timers stay real.
    vi.useFakeTimers({
      toFake: ["Date"],
      now: new Date("2026-11-10T14:30:00.000Z"),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("says in four figures what is waiting, what is theirs, and their teams", async () => {
    api();
    renderPage();

    expect(
      await screen.findByRole("heading", { level: 1, name: "My Operations" }),
    ).toBeDefined();

    await waitFor(() => expect(tile("Waiting on your team")).toBe("1no one has started"));
    expect(tile("You're investigating")).toBe("1INC-74");
    // Only their teams' incidents count, not one they responded to elsewhere.
    await waitFor(() => expect(tile("Active on your teams")).toBe("21 × SEV1"));
    expect(tile("Your teams")).toBe("25 services");

    const chips = screen.getByRole("list", { name: "Your teams" });

    expect(within(chips).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Payments",
      "Risk",
    ]);
  });

  it("lists what waits on their team and what they are investigating, each with View", async () => {
    api();
    renderPage();

    const waiting = await screen.findByRole("table", { name: "Waiting on your team" });
    const [, row] = within(waiting).getAllByRole("row");

    expect(row.textContent).toMatch(/INC-76Card network declines spike/);
    expect(row.textContent).toMatch(/Payment API · Payments/);
    // Open for 2h 15m, from 12:15 to 14:30.
    expect(row.textContent).toMatch(/2h 15m/);
    expect(
      within(row).getByRole("link", { name: "View INC-76" }).getAttribute("href"),
    ).toBe("/orgs/acme-ops/incidents/76");

    const investigating = screen.getByRole("table", { name: "You're investigating" });
    const [heading, mineRow] = within(investigating).getAllByRole("row");

    expect(within(heading).getByRole("columnheader", { name: "You started" })).toBeDefined();
    // Their own start, an hour ago — not when the incident was declared.
    expect(mineRow.textContent).toMatch(/1h ago/);
    expect(
      within(mineRow).getByRole("link", { name: "View INC-74" }).getAttribute("href"),
    ).toBe("/orgs/acme-ops/incidents/74");

    // Nothing is acted on here: starting and finishing live on the incident.
    expect(screen.queryByRole("button", { name: /Start|Finish|Complete/ })).toBeNull();
  });

  it("says plainly when nothing is waiting and nothing is theirs", async () => {
    api({ attention: { manage: null, respond: { needsYourTeam: [], yourResponses: [] } } });
    renderPage();

    expect(await screen.findByText("Nothing waiting")).toBeDefined();
    expect(screen.getByText("Nothing under way")).toBeDefined();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("tells a member on no team why nothing reaches them", async () => {
    api({
      teams: [],
      attention: { manage: null, respond: { needsYourTeam: [], yourResponses: [] } },
      active: [],
    });
    renderPage();

    expect(await screen.findByText("You're not on a team yet")).toBeDefined();
    await waitFor(() => expect(tile("Your teams")).toBe("00 services"));
  });

  it("asks nothing about incidents without incidents:read", async () => {
    const { requests } = api({ permissions: ["organization:read", "teams:read"] });
    renderPage();

    expect(await screen.findByText("No incidents to show")).toBeDefined();
    expect(requests.some((request) => request.path.includes("/incidents"))).toBe(false);
  });

  it("has no accessibility violations", async () => {
    api();

    const { container } = renderPage();

    await screen.findByRole("table", { name: "Waiting on your team" });
    await waitFor(() => expect(tile("Active on your teams")).toBe("21 × SEV1"));
    await expectNoAxeViolations(container);
  });
});
