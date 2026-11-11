import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  responseAccess: "OPEN",
  assignees: [],
  knownIssue: null,
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

const listItem = (incident: IncidentDetailResponse): IncidentListItemResponse => {
  const yours = incident.responders.find(({ membershipId }) => membershipId === ME);

  return {
    ...incident,
    response: { investigating: 0, completed: 0 },
    lastUpdateAt: null,
    yourResponse: yours
      ? {
          status: yours.status,
          startedAt: yours.startedAt,
          completedAt: yours.completedAt,
        }
      : null,
  };
};

/** A Platform incident the member responded to: visible, but not their team's. */
const elsewhere = detail(80, {
  title: "Login latency",
  team: { id: platform.id, name: platform.name, slug: platform.slug },
});

const SAM = "0199a1b2-c3d4-7000-8000-0000000000bb";

const teamMember = (membershipId: string, name: string) => ({
  membershipId,
  addedAt: "2026-09-01T12:00:00.000Z",
  user: { id: `user-${membershipId}`, name, email: `${name.split(" ")[0].toLowerCase()}@acme.example` },
});

const service = (id: string, name: string, owner: TeamResponse) => ({
  id,
  name,
  slug: name.toLowerCase().replace(/\s+/g, "-"),
  description: null,
  criticality: "CRITICAL",
  ownerTeam: { id: owner.id, name: owner.name, slug: owner.slug },
  archivedAt: null,
  createdAt: "2026-09-01T12:00:00.000Z",
  updatedAt: "2026-09-01T12:00:00.000Z",
});

const paymentApi = service("0199a1b2-c3d4-7000-8000-0000000000e1", "Payment API", payments);
const fraud = service("0199a1b2-c3d4-7000-8000-0000000000e2", "Fraud Detection", risk);

/** Every day of the period, quiet but for the 9th of November. */
const activity = (from: string, to: string) => {
  const days = [];

  for (
    let at = Date.parse(`${from}T00:00:00.000Z`);
    at <= Date.parse(`${to}T00:00:00.000Z`);
    at += 86_400_000
  ) {
    const date = new Date(at).toISOString().slice(0, 10);
    const busy = date === "2026-11-09";

    days.push({
      date,
      total: busy ? 3 : 0,
      level: busy ? 1 : 0,
      counts: {
        responseStarted: busy ? 1 : 0,
        update: busy ? 2 : 0,
        responseCompleted: 0,
      },
      incidents: busy
        ? [
            {
              id: mine.id,
              number: 74,
              title: mine.title,
              severity: "SEV2",
              status: "INVESTIGATING",
              service: { name: "Payment API", slug: "payment-api" },
              events: 3,
            },
          ]
        : [],
      moreIncidents: 0,
    });
  }

  return { from, to, days, total: 3, activeDays: 1, thresholds: [1, 5, 10, 20] };
};

const api = ({
  permissions = MEMBER,
  teams = [payments, risk],
  attention = {
    manage: null,
    respond: { assignedToYou: [], needsYourTeam: [unclaimed], yourResponses: [mine] },
  },
  active = [unclaimed, mine, elsewhere],
}: {
  permissions?: string[];
  teams?: TeamResponse[];
  attention?: IncidentAttentionResponse;
  active?: IncidentDetailResponse[];
} = {}) =>
  mockApi((request) => {
    if (route(request).startsWith(`GET ${base}/memberships/${ME}/activity?`)) {
      const query = new URLSearchParams(request.path.split("?")[1]);

      return jsonResponse(200, activity(query.get("from")!, query.get("to")!));
    }

    switch (route(request)) {
      case `GET ${base}/services`:
        return jsonResponse(200, [paymentApi, fraud]);
      case `GET ${base}/teams/${payments.id}/members`:
        return jsonResponse(200, [teamMember(ME, "Priya Shah"), teamMember(SAM, "Sam Okafor")]);
      case `GET ${base}/teams/${risk.id}/members`:
        return jsonResponse(200, [teamMember(ME, "Priya Shah")]);
      case `GET ${base}/memberships/${ME}/responses`:
        return jsonResponse(200, {
          items: [
            {
              incident: mine,
              status: "INVESTIGATING",
              startedAt: "2026-11-10T13:30:00.000Z",
              completedAt: null,
            },
          ],
          page: { cursor: null, hasMore: false },
        });
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
      case `GET ${base}/incidents/flow?days=7`:
        return jsonResponse(200, {
          from: "2026-11-04",
          to: "2026-11-10",
          asOf: "2026-11-10T14:30:00.000Z",
          days: 7,
          scope: "teams",
          figures: {
            typicalWaitMs: null,
            started: 0,
            mostAtOnce: null,
            longestWait: null,
            waitingNow: 0,
          },
          teams: teams.map(({ id, name, slug }) => ({
            id,
            name,
            slug,
            figures: {
              typicalWaitMs: null,
              started: 0,
              mostAtOnce: null,
              longestWait: null,
              waitingNow: 0,
            },
            incidents: [],
          })),
        });
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

    await waitFor(() => expect(tile("Ready for you to start")).toBe("1no one has started"));
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

  it("shows how their teams' incidents ran, below their work", async () => {
    const { requests } = api();
    renderPage();

    expect(
      await screen.findByRole("heading", { level: 2, name: "Your teams' incidents" }),
    ).toBeDefined();
    expect(
      await screen.findByText("No incidents on your teams in the last 7 days."),
    ).toBeDefined();
    expect(requests.some((request) => request.path.endsWith("/incidents/flow?days=7"))).toBe(
      true,
    );
  });

  it("says plainly when nothing is waiting and nothing is theirs", async () => {
    api({ attention: { manage: null, respond: { assignedToYou: [], needsYourTeam: [], yourResponses: [] } } });
    renderPage();

    expect(await screen.findByText("Nothing waiting")).toBeDefined();
    expect(screen.getByText("Nothing under way")).toBeDefined();
    expect(screen.queryByRole("table", { name: "Waiting on your team" })).toBeNull();
    expect(screen.queryByRole("table", { name: "You're investigating" })).toBeNull();
  });

  it("puts what the Admin assigned them first, and counts it as theirs to start", async () => {
    api({
      attention: {
        manage: null,
        respond: { assignedToYou: [elsewhere], needsYourTeam: [unclaimed], yourResponses: [] },
      },
    });
    renderPage();

    const assigned = await screen.findByRole("table", { name: "Assigned to you" });

    expect(within(assigned).getByText(elsewhere.title)).toBeDefined();
    expect(
      screen.getByText(
        "The Admin asked you to respond to these. Only the people assigned can start them.",
      ),
    ).toBeDefined();
    await waitFor(() => expect(tile("Ready for you to start")).toBe("21 assigned to you"));
  });

  it("shows no assigned list when nothing is assigned", async () => {
    api();
    renderPage();

    await screen.findByRole("table", { name: "Waiting on your team" });
    expect(screen.queryByRole("table", { name: "Assigned to you" })).toBeNull();
  });

  it("tells a member on no team why nothing reaches them", async () => {
    api({
      teams: [],
      attention: { manage: null, respond: { assignedToYou: [], needsYourTeam: [], yourResponses: [] } },
      active: [],
    });
    renderPage();

    expect(await screen.findByText("You're not on a team yet")).toBeDefined();
    await waitFor(() => expect(tile("Your teams")).toBe("00 services"));
    // No teams, so no flow is asked for.
    expect(screen.queryByRole("heading", { name: "Your teams' incidents" })).toBeNull();
  });

  it("asks nothing about incidents without incidents:read", async () => {
    const { requests } = api({ permissions: ["organization:read", "teams:read"] });
    renderPage();

    expect(await screen.findByText("No incidents to show")).toBeDefined();
    expect(requests.some((request) => request.path.includes("/incidents"))).toBe(false);
  });

  it("shows their teams as a roster: who is on each, and the services each owns", async () => {
    api();
    renderPage();

    const roster = await screen.findByRole("list", { name: "Your teams and their services" });
    const [first, second] = within(roster).getAllByRole("listitem", { name: undefined }).filter(
      (item) => item.parentElement === roster,
    );

    expect(
      within(first).getByRole("link", { name: "Payments" }).getAttribute("href"),
    ).toBe("/orgs/acme-ops/teams/payments");
    expect(
      within(await within(first).findByRole("list", { name: "Services Payments owns" }))
        .getByRole("link", { name: /Payment API/ })
        .getAttribute("href"),
    ).toBe("/orgs/acme-ops/services/payment-api");
    // The member first, as "you"; then everyone else.
    expect(await within(first).findByText("You, Sam Okafor")).toBeDefined();
    expect(await within(second).findByText("Only you")).toBeDefined();
  });

  it("draws their own activity over six months, and says what a chosen day held", async () => {
    const user = userEvent.setup();
    const { requests } = api();
    renderPage();

    const grid = await screen.findByRole("grid", {
      name: "Your activity over the last six months",
    });
    // Their own, never anyone else's: the request names them.
    const asked = requests
      .map((request) => request.path)
      .find((path) => path.includes("/activity?"));

    expect(asked).toMatch(new RegExp(`/memberships/${ME}/activity\\?from=2026-05-13&to=2026-11-10$`));
    expect(
      screen.getByText(
        (_, element) =>
          element?.tagName === "P" && /^Active on 1 day\./.test(element.textContent ?? ""),
      ),
    ).toBeDefined();

    await user.click(
      within(grid).getByRole("button", {
        name: /9.*2026 — 1 response started, 2 updates$/,
      }),
    );

    const worked = screen.getByRole("list", { name: "Incidents you worked on that day" });

    expect(
      within(worked).getByRole("link", { name: /INC-74/ }).getAttribute("href"),
    ).toBe("/orgs/acme-ops/incidents/74");
  });

  it("lists their own responses, said to them", async () => {
    api();
    renderPage();

    const table = await screen.findByRole("table", { name: "Your recent responses" });

    expect(within(table).getByRole("columnheader", { name: "Your part" })).toBeDefined();
    expect(within(table).getByText("Elevated authorization latency")).toBeDefined();
  });

  it("has no accessibility violations", async () => {
    api();

    const { container } = renderPage();

    await screen.findByRole("table", { name: "Waiting on your team" });
    await waitFor(() => expect(tile("Active on your teams")).toBe("21 × SEV1"));
    await screen.findByText("No incidents on your teams in the last 7 days.");
    await screen.findByRole("grid", { name: "Your activity over the last six months" });
    await screen.findByRole("table", { name: "Your recent responses" });
    await screen.findByText("You, Sam Okafor");
    await expectNoAxeViolations(container);
  });
});
