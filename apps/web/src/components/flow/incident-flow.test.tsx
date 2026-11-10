import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IncidentFlow } from "@/components/flow/incident-flow";
import { OrganizationScope } from "@/components/organizations/organization-scope";
import type {
  IncidentFlowFiguresResponse,
  IncidentFlowItemResponse,
  IncidentFlowResponse,
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

const base = `/organizations/${organization.id}`;
const MIN = 60_000;

const item = (
  number: number,
  overrides: Partial<IncidentFlowItemResponse> = {},
): IncidentFlowItemResponse => ({
  number,
  title: `Incident ${number}`,
  severity: "SEV2",
  status: "DECLARED",
  service: { id: "service-api", name: "Payment API", slug: "payment-api" },
  createdAt: "2026-11-10T12:15:00.000Z",
  startedAt: null,
  resolvedAt: null,
  waitMs: 0,
  responders: 0,
  yourUpdates: [],
  ...overrides,
});

/** Declared 12:15, nobody on it at 14:30. */
const waiting = item(76, {
  title: "Card network declines spike",
  severity: "SEV1",
  waitMs: 135 * MIN,
});

/** Started after 36 minutes, worked since; one of the caller's updates. */
const working = item(74, {
  title: "Elevated authorization latency",
  status: "INVESTIGATING",
  createdAt: "2026-11-10T09:30:00.000Z",
  startedAt: "2026-11-10T10:06:00.000Z",
  waitMs: 36 * MIN,
  responders: 2,
  yourUpdates: ["2026-11-10T11:00:00.000Z"],
});

/** Started after 15 minutes, resolved 66 minutes later. */
const resolved = item(65, {
  title: "Card authorisations failing in EU",
  status: "RESOLVED",
  createdAt: "2026-11-04T07:18:00.000Z",
  startedAt: "2026-11-04T07:33:00.000Z",
  resolvedAt: "2026-11-04T08:39:00.000Z",
  waitMs: 15 * MIN,
  responders: 1,
});

const figures = (
  overrides: Partial<IncidentFlowFiguresResponse> = {},
): IncidentFlowFiguresResponse => ({
  typicalWaitMs: 26 * MIN,
  started: 2,
  mostAtOnce: { count: 2, at: "2026-11-10T12:15:00.000Z" },
  longestWait: { ms: 135 * MIN, number: 76, waiting: true },
  waitingNow: 1,
  ...overrides,
});

const quiet = figures({
  typicalWaitMs: null,
  started: 0,
  mostAtOnce: null,
  longestWait: null,
  waitingNow: 0,
});

const flow = (
  days: 7 | 14,
  scope: IncidentFlowResponse["scope"] = "teams",
  teams: IncidentFlowResponse["teams"] = [
    {
      id: "team-payments",
      name: "Payments",
      slug: "payments",
      figures: figures(),
      incidents: [waiting, working, resolved],
    },
    { id: "team-risk", name: "Risk", slug: "risk", figures: quiet, incidents: [] },
  ],
): IncidentFlowResponse => ({
  from: days === 7 ? "2026-11-04" : "2026-10-28",
  to: "2026-11-10",
  asOf: "2026-11-10T14:30:00.000Z",
  days,
  scope,
  figures: figures(),
  teams,
});

const api = (answer: (days: 7 | 14) => IncidentFlowResponse = (days) => flow(days)) =>
  mockApi((request) => {
    if (route(request).startsWith(`GET ${base}/incidents/flow?`)) {
      const days = Number(new URLSearchParams(request.path.split("?")[1]).get("days"));

      return jsonResponse(200, answer(days as 7 | 14));
    }

    switch (route(request)) {
      case "POST /auth/refresh":
        return refreshed("token");
      case "GET /auth/me":
        return jsonResponse(200, currentUser);
      case `GET ${base}`:
        return jsonResponse(200, organizationDetail(["incidents:read"], "MEMBER"));
      default:
        return apiError(404);
    }
  });

const renderFlow = (scope: IncidentFlowResponse["scope"] = "teams") =>
  renderWithSession(
    <OrganizationScope>
      <IncidentFlow scope={scope} />
    </OrganizationScope>,
  );

/** What a figure says: its value, then its note. */
const figure = (label: string) =>
  within(screen.getByLabelText("Response flow figures")).getByText(label)
    .nextElementSibling?.textContent;

describe("the response flow", () => {
  beforeEach(() => {
    clearAccessToken();
  });

  it("names each incident with what its bar shows, and opens it", async () => {
    api();
    renderFlow();

    expect(
      await screen.findByRole("heading", { level: 2, name: "Your teams' incidents" }),
    ).toBeDefined();

    const frame = await screen.findByRole("region", {
      name: "Incidents over the last 7 days",
    });

    expect(
      within(frame)
        .getByRole("link", {
          name: "INC-76, Card network declines spike: waiting 2h 15m",
        })
        .getAttribute("href"),
    ).toBe("/orgs/acme-ops/incidents/76");
    expect(
      within(frame).getByRole("link", {
        name: "INC-74, Elevated authorization latency: waited 36m · working 4h 24m",
      }),
    ).toBeDefined();
    expect(
      within(frame).getByRole("link", {
        name: "INC-65, Card authorisations failing in EU: waited 15m · worked 1h 6m",
      }),
    ).toBeDefined();
    // Waiting first, then worked, then resolved: the API's order, kept.
    expect(
      within(frame)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual([
      "INC-76Card network declines spike",
      "INC-74Elevated authorization latency",
      "INC-65Card authorisations failing in EU",
    ]);
  });

  it("says the team-level figures, and what each team has on now", async () => {
    api();
    renderFlow();

    await screen.findByLabelText("Response flow figures");

    expect(figure("Typical wait before someone starts")).toBe("26mmedian of 2 started");
    expect(figure("Most running at once")).toMatch(/^2from /);
    expect(figure("Waiting right now")).toBe("1nobody has started");

    expect(screen.getByRole("button", { name: /Payments\s*2 active · 1 waiting/ })).toBeDefined();
    // A team with nothing in the window is still listed.
    expect(screen.getByRole("button", { name: /Risk\s*all clear/ })).toBeDefined();
  });

  it("folds a team away, and narrows to one team", async () => {
    const user = userEvent.setup();
    api();
    renderFlow();

    const payments = await screen.findByRole("button", { name: /^Payments/, expanded: true });

    expect(payments.getAttribute("aria-expanded")).toBe("true");
    await user.click(payments);
    expect(payments.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("link", { name: /INC-76/ })).toBeNull();
    await user.click(payments);

    await user.click(
      within(screen.getByRole("group", { name: "Team" })).getByRole("button", {
        name: "Risk",
      }),
    );

    // Risk's own figures, and Risk alone, which had nothing.
    expect(figure("Waiting right now")).toBe("0none");
    expect(screen.getByText("No incidents on your teams in the last 7 days.")).toBeDefined();
  });

  it("reads two weeks when asked, keeping the week on screen until they arrive", async () => {
    const user = userEvent.setup();
    const { requests } = api();
    renderFlow();

    await screen.findByRole("region", { name: "Incidents over the last 7 days" });
    await user.click(screen.getByRole("button", { name: "14 days" }));

    expect(
      await screen.findByRole("region", { name: "Incidents over the last 14 days" }),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "14 days" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(
      requests
        .filter((request) => request.path.includes("/incidents/flow"))
        .map((request) => request.path.split("?")[1]),
    ).toEqual(["days=7", "days=14"]);
  });

  it("says an incident's times when it is pointed at", async () => {
    const user = userEvent.setup();
    api();
    renderFlow();

    const link = await screen.findByRole("link", { name: /^INC-74/ });

    await user.hover(link);

    const said = await screen.findByText(/^INC-74 · Elevated authorization latency$/);
    const strip = said.parentElement!;

    expect(strip.textContent).toMatch(/first started/);
    expect(strip.textContent).toMatch(/1 of your updates/);
  });

  it("gives an overseer every team, with responders, the longest wait, and no one's updates", async () => {
    api((days) =>
      flow(days, "organization", [
        {
          id: "team-payments",
          name: "Payments",
          slug: "payments",
          figures: figures(),
          incidents: [waiting, { ...working, yourUpdates: [] }],
        },
        {
          id: "team-data",
          name: "Data",
          slug: "data",
          figures: quiet,
          incidents: [resolved],
        },
      ]),
    );
    renderFlow("organization");

    expect(await screen.findByRole("heading", { level: 2, name: "Response flow" })).toBeDefined();
    await screen.findByLabelText("Response flow figures");

    expect(figure("Longest wait")).toBe("2h 15mINC-76 · still waiting");
    expect(screen.getByText("no one yet")).toBeDefined();
    expect(screen.getByText("2 responders")).toBeDefined();
    expect(screen.queryByText("Your update")).toBeNull();
    // A team with nothing on now starts folded.
    expect(
      screen.getByRole("button", { name: /^Data/, expanded: false }).getAttribute("aria-expanded"),
    ).toBe("false");
    expect(screen.queryByRole("link", { name: /INC-65/ })).toBeNull();
  });

  it("draws nothing for a member on no team", async () => {
    const { requests } = api((days) => flow(days, "teams", []));
    const { container } = renderFlow();

    await waitFor(() =>
      expect(requests.some((request) => request.path.includes("/incidents/flow"))).toBe(true),
    );
    await waitFor(() => expect(container.querySelector("section")).toBeNull());
  });

  it("has no accessibility violations", async () => {
    api();
    const { container } = renderFlow();

    await screen.findByRole("region", { name: "Incidents over the last 7 days" });
    await expectNoAxeViolations(container);
  });
});

describe("the response flow on a phone", () => {
  beforeEach(() => {
    clearAccessToken();
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches: false,
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );

    return () => vi.unstubAllGlobals();
  });

  it("lists each incident with its words and times written out, in the API's order", async () => {
    api();
    renderFlow();

    const list = await screen.findByRole("region", { name: "Incidents over the last 7 days" });
    const items = within(list).getAllByRole("listitem");

    // A list, not the timeline's scrolling frame.
    expect(list.getAttribute("tabindex")).toBeNull();
    expect(items.map((each) => within(each).getByRole("link").getAttribute("aria-label"))).toEqual([
      "INC-76, Card network declines spike: waiting 2h 15m",
      "INC-74, Elevated authorization latency: waited 36m · working 4h 24m",
      "INC-65, Card authorisations failing in EU: waited 15m · worked 1h 6m",
    ]);
    expect(within(items[0]!).getByText("waiting 2h 15m")).toBeDefined();
    expect(items[1]!.textContent).toMatch(/declared .*1 of your update$/);
    expect(items[2]!.textContent).toMatch(/resolved /);
    // Nothing to point with, so no strip asking to.
    expect(screen.queryByText(/Point at an incident/)).toBeNull();
    expect(screen.getByText("Waiting for someone to start")).toBeDefined();
  });

  it("folds a team away, as the timeline does", async () => {
    const user = userEvent.setup();
    api();
    renderFlow();

    const payments = await screen.findByRole("button", { name: /^Payments/, expanded: true });

    await user.click(payments);
    expect(screen.queryByRole("link", { name: /INC-76/ })).toBeNull();
  });

  it("gives an overseer responders and each team's figures", async () => {
    api((days) =>
      flow(days, "organization", [
        {
          id: "team-payments",
          name: "Payments",
          slug: "payments",
          figures: figures(),
          incidents: [waiting, { ...working, yourUpdates: [] }],
        },
      ]),
    );
    renderFlow("organization");

    await screen.findByRole("region", { name: "Incidents over the last 7 days" });

    expect(screen.getByText("no one yet")).toBeDefined();
    expect(screen.getByText("2 responders")).toBeDefined();
    expect(screen.getByText("typical wait 26m · most at once 2")).toBeDefined();
  });

  it("has no accessibility violations", async () => {
    api();
    const { container } = renderFlow();

    await screen.findByRole("region", { name: "Incidents over the last 7 days" });
    await expectNoAxeViolations(container);
  });
});
