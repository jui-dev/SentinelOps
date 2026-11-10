import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IncidentHistory } from "@/components/history/incident-history";
import { OrganizationScope } from "@/components/organizations/organization-scope";
import type {
  IncidentHistoryItemResponse,
  IncidentHistoryPage,
  IncidentOccurrenceResponse,
  IncidentResponse,
  IncidentSummaryResponse,
  OperationalActivityResponse,
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
import type { SentRequest } from "@/test/api";
import { expectNoAxeViolations } from "@/test/axe";
import { renderWithSession } from "@/test/render";

/**
 * A router that remembers its query string, so the page's period and
 * filters — which live in the address — can be set by a link, changed by a
 * choice, and read back the way a browser would.
 */
const navigation = vi.hoisted(() => {
  let query = "";
  const listeners = new Set<() => void>();

  return {
    pathname: "/orgs/acme-ops/incidents/history",
    snapshot: () => query,
    subscribe: (onChange: () => void) => {
      listeners.add(onChange);

      return () => {
        listeners.delete(onChange);
      };
    },
    /** What a `router.replace` does: swap the address, tell the page. */
    set: (next: string) => {
      query = next;
      for (const listener of [...listeners]) listener();
    },
    replace: vi.fn((url: string) => {
      query = url.split("?")[1] ?? "";
      for (const listener of [...listeners]) listener();
    }),
    reset: () => {
      query = "";
      listeners.clear();
    },
  };
});

vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } =
    await vi.importActual<typeof import("react")>("react");

  return {
    useParams: () => ({ orgSlug: "acme-ops" }),
    usePathname: () => navigation.pathname,
    useRouter: () => ({ replace: navigation.replace, push: vi.fn() }),
    useSearchParams: () =>
      new URLSearchParams(
        useSyncExternalStore(
          navigation.subscribe,
          navigation.snapshot,
          navigation.snapshot,
        ),
      ),
  };
});

/**
 * An overseer. Incident history is one reading of the whole organization, so
 * `incidents:read-all` is what it is offered on — `MEMBER_READ` below is the
 * same grant without it.
 */
const READ = [
  "incidents:read",
  "incidents:read-all",
  "memberships:read",
  "organization:read",
  "services:read",
  "teams:read",
];

const MEMBER_READ = READ.filter(
  (permission) => permission !== "incidents:read-all",
);

const base = `/organizations/${organization.id}`;
const none = { SEV1: 0, SEV2: 0, SEV3: 0, SEV4: 0 };
const HOUR = 3_600_000;

const incident = (overrides: Partial<IncidentResponse> = {}): IncidentResponse => ({
  id: "0199a1b2-c3d4-7000-8000-0000000000f1",
  number: 42,
  title: "Card payments failing",
  summary: null,
  severity: "SEV1",
  status: "DECLARED",
  service: {
    id: "0199a1b2-c3d4-7000-8000-0000000000e1",
    name: "Payment API",
    slug: "payment-api",
    criticality: "CRITICAL",
    archivedAt: null,
  },
  team: {
    id: "0199a1b2-c3d4-7000-8000-0000000000c1",
    name: "Payments",
    slug: "payments",
  },
  createdBy: { id: currentUser.id, name: "Ada Lovelace" },
  createdAt: "2026-09-19T10:00:00.000Z",
  updatedAt: "2026-09-19T10:00:00.000Z",
  resolvedAt: null,
  ...overrides,
});

/** An incident declared on the 18th and still running. */
const running: IncidentHistoryItemResponse = {
  incident: incident({
    id: "0199a1b2-c3d4-7000-8000-0000000000f8",
    number: 8,
    title: "Delayed webhook delivery to partners",
    severity: "SEV4",
    status: "INVESTIGATING",
    createdAt: "2026-09-18T19:04:00.000Z",
  }),
  declaredInPeriod: true,
  resolvedInPeriod: false,
};

/** Declared on the 17th and resolved on the 18th: one item, both flags. */
const spanning: IncidentHistoryItemResponse = {
  incident: incident({
    id: "0199a1b2-c3d4-7000-8000-0000000000f9",
    number: 9,
    title: "Intermittent 502s on card tokenisation",
    severity: "SEV2",
    status: "RESOLVED",
    createdAt: "2026-09-17T23:50:00.000Z",
    resolvedAt: "2026-09-18T00:10:00.000Z",
  }),
  declaredInPeriod: true,
  resolvedInPeriod: true,
};

/** Declared before the period and resolved on the 15th. */
const resolvedEarlier: IncidentHistoryItemResponse = {
  incident: incident({
    id: "0199a1b2-c3d4-7000-8000-0000000000f7",
    number: 7,
    title: "Reports delayed",
    severity: "SEV3",
    status: "RESOLVED",
    createdAt: "2026-09-10T08:00:00.000Z",
    resolvedAt: "2026-09-15T10:30:00.000Z",
  }),
  declaredInPeriod: false,
  resolvedInPeriod: true,
};

/** The second page's one incident, on the 14th. */
const older: IncidentHistoryItemResponse = {
  incident: incident({
    id: "0199a1b2-c3d4-7000-8000-0000000000f6",
    number: 6,
    title: "Ledger export slow",
    severity: "SEV3",
    status: "RESOLVED",
    createdAt: "2026-09-14T06:00:00.000Z",
    resolvedAt: "2026-09-14T07:00:00.000Z",
  }),
  declaredInPeriod: true,
  resolvedInPeriod: true,
};

const current: IncidentSummaryResponse["current"] = {
  active: 3,
  activeBySeverity: { SEV1: 1, SEV2: 0, SEV3: 2, SEV4: 0 },
  affectedServices: [],
  responders: { active: 0, teams: 0 },
  activeByStatus: { DECLARED: 0, INVESTIGATING: 0 },
  readyToResolve: 0,
  typicalResolution: {
    from: "2026-06-22",
    to: "2026-09-19",
    minimumSample: 5,
    bySeverity: {
      SEV1: { resolved: 0, medianMs: null },
      SEV2: { resolved: 0, medianMs: null },
      SEV3: { resolved: 0, medianMs: null },
      SEV4: { resolved: 0, medianMs: null },
    },
  },
};

/** The figures vary by period, so a change is visible on screen. */
const busy = (from: string, to: string): IncidentSummaryResponse => ({
  current,
  period:
    from === to
      ? {
          from,
          to,
          declared: 1,
          declaredBySeverity: { ...none, SEV4: 1 },
          resolved: 0,
          stillOpen: 1,
          resolutionMedianMs: null,
          history: { total: 1, items: [] },
        }
      : {
          from,
          to,
          declared: 12,
          declaredBySeverity: { SEV1: 2, SEV2: 3, SEV3: 5, SEV4: 2 },
          resolved: 9,
          stillOpen: 3,
          resolutionMedianMs: 2.5 * HOUR,
          // Two of the resolved were declared before the period.
          history: { total: 14, items: [] },
        },
});

const quiet = (from: string, to: string): IncidentSummaryResponse => ({
  current,
  period: {
    from,
    to,
    declared: 0,
    declaredBySeverity: none,
    resolved: 0,
    stillOpen: 0,
    resolutionMedianMs: null,
    history: { total: 0, items: [] },
  },
});

/** Every day of the period, quiet but for the 18th. */
const activity = (from: string, to: string): OperationalActivityResponse => {
  const days = [];

  for (
    let at = Date.parse(`${from}T00:00:00.000Z`);
    at <= Date.parse(`${to}T00:00:00.000Z`);
    at += 24 * HOUR
  ) {
    const date = new Date(at).toISOString().slice(0, 10);
    const busyDay = date === "2026-09-18";

    days.push({
      date,
      total: busyDay ? 3 : 0,
      level: (busyDay ? 1 : 0) as 0 | 1,
      counts: {
        declared: busyDay ? 2 : 0,
        responseStarted: 0,
        update: 0,
        responseCompleted: 0,
        resolved: busyDay ? 1 : 0,
        changed: 0,
      },
      incidents: [],
      moreIncidents: 0,
    });
  }

  return {
    from,
    to,
    days,
    total: 3,
    activeDays: 1,
    thresholds: [1, 5, 10, 20],
  };
};

const occurrence = (from: string, to: string): IncidentOccurrenceResponse => ({
  from,
  to,
  asOf: "2026-09-19T12:00:00.000Z",
  trackedFrom: "2026-01-01",
  declared: 12,
  incidentFreeDays: 0,
  completeDays: 6,
  days: [],
  previous: {
    from: "2026-09-06",
    to: "2026-09-12",
    declared: 8,
    comparable: true,
    minimumSample: 5,
    changePercent: 50,
  },
  services: { top: [], others: { services: 0, declared: 0 } },
});

const page = (
  items: IncidentHistoryItemResponse[],
  total: number,
  cursor: string | null = null,
): IncidentHistoryPage => ({
  items,
  total,
  page: { cursor, hasMore: cursor !== null },
});

const SUMMARY = `GET ${base}/incidents/summary`;
const HISTORY = `GET ${base}/incidents/history`;
const ACTIVITY = `GET ${base}/incidents/activity`;
const OCCURRENCE = `GET ${base}/incidents/occurrence`;

const queryOf = (request: SentRequest) =>
  new URLSearchParams(request.path.split("?")[1]);

const periodOf = (request: SentRequest) => {
  const query = queryOf(request);

  return `${query.get("from")}..${query.get("to")}`;
};

const summaries = (requests: SentRequest[]) =>
  requests
    .filter((request) => route(request).startsWith(`${SUMMARY}?`))
    .map(periodOf);

/** The history pages asked for, as their query strings. */
const histories = (requests: SentRequest[]) =>
  requests
    .filter((request) => route(request).startsWith(`${HISTORY}?`))
    .map((request) => request.path.split("?")[1]);

const api = (
  permissions: string[],
  {
    summary = busy,
    history = (query: URLSearchParams) =>
      query.get("cursor") === "next"
        ? page([older], 14)
        : page([running, spanning, resolvedEarlier], 14, "next"),
  }: {
    summary?: (from: string, to: string) => IncidentSummaryResponse;
    history?: (query: URLSearchParams) => IncidentHistoryPage;
  } = {},
) =>
  mockApi((request) => {
    const [from, to] = periodOf(request).split("..");

    if (route(request).startsWith(`${SUMMARY}?`)) {
      return jsonResponse(200, summary(from, to));
    }
    if (route(request).startsWith(`${HISTORY}?`)) {
      return jsonResponse(200, history(queryOf(request)));
    }
    if (route(request).startsWith(`${ACTIVITY}?`)) {
      return jsonResponse(200, activity(from, to));
    }
    if (route(request).startsWith(`${OCCURRENCE}?`)) {
      return jsonResponse(200, occurrence(from, to));
    }

    switch (route(request)) {
      case "POST /auth/refresh":
        return refreshed("token");
      case "GET /auth/me":
        return jsonResponse(200, currentUser);
      case `GET ${base}`:
        return jsonResponse(200, organizationDetail(permissions));
      default:
        return apiError(404);
    }
  });

const renderHistory = () =>
  renderWithSession(
    <OrganizationScope>
      <IncidentHistory />
    </OrganizationScope>,
  );

/** One period choice, by name. */
const periodChoice = (name: string) =>
  within(screen.getByRole("group", { name: "Period" })).getByRole("button", {
    name,
  });

/** What a glance tile says: its value, then its note. */
const tile = async (label: string) =>
  within(await screen.findByLabelText("This period")).getByText(label)
    .nextElementSibling?.textContent;

/**
 * The record covers every incident the organization has, so it is offered on
 * oversight rather than on reading incidents. A member is told so, and the
 * page asks the API for nothing it would be refused.
 */
describe("incident history, without oversight", () => {
  beforeEach(() => {
    clearAccessToken();
    navigation.reset();
    navigation.replace.mockClear();
  });

  it("says why it is empty, and asks for nothing about incidents", async () => {
    const { requests } = api(MEMBER_READ);
    renderHistory();

    await screen.findByRole("heading", { level: 1, name: "Incident history" });
    await screen.findByText("No history to show");

    expect(screen.queryByRole("group", { name: "Period" })).toBeNull();
    expect(
      requests.some((request) => request.path.includes("/incidents/")),
    ).toBe(false);
  });
});

describe("incident history", () => {
  beforeEach(() => {
    clearAccessToken();
    navigation.reset();
    navigation.replace.mockClear();
    // Only Date: the queries' and user-event's timers stay real.
    vi.useFakeTimers({
      toFake: ["Date"],
      now: new Date("2026-09-19T12:00:00.000Z"),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the last seven UTC days in four figures, as its own page under Incidents", async () => {
    const { requests } = api(READ);
    renderHistory();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Incident history" }),
    ).toBeDefined();
    // Back the way they came, into the Incidents workflow.
    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });

    expect(
      within(breadcrumb).getByRole("link", { name: "Incidents" }).getAttribute("href"),
    ).toBe("/orgs/acme-ops/incidents");

    expect(periodChoice("7 days").getAttribute("aria-pressed")).toBe("true");
    expect(document.body.textContent).toMatch(/· 7 days · UTC/);

    await waitFor(async () => expect(await tile("Declared")).toMatch(/^12/));
    // Up four on the seven days before, by the API's own comparison.
    expect(await tile("Declared")).toBe("12▲ Up 4 on the 7 days before");
    // Fourteen in the history, twelve declared in it: two resolved from before.
    expect(await tile("Resolved")).toBe("92 declared earlier");
    expect(await tile("Still open")).toBe("3declared in this period");
    expect(await tile("Typical duration")).toBe("2h 30mmedian of 9 resolved");

    expect(
      screen
        .getByLabelText("Incidents declared in this period, by current severity")
        .textContent,
    ).toMatch(/SEV1\s*Critical\s*2/);

    expect(summaries(requests)).toEqual(["2026-09-13..2026-09-19"]);
    // Nothing of the Overview's: this page is the record, not the state now.
    expect(screen.queryByRole("region", { name: "Current operations" })).toBeNull();
  });

  it("draws each day declared above the line and resolved below it, and narrows to one when picked", async () => {
    const user = userEvent.setup();
    api(READ);
    renderHistory();

    const chart = await screen.findByRole("group", {
      name: "Declared and resolved per day",
    });
    const days = within(chart).getAllByRole("button");

    // One per day of the period, each named with its own counts.
    expect(days).toHaveLength(7);
    expect(days[5].getAttribute("aria-label")).toMatch(
      /18.*: 2 declared, 1 resolved\. Show only this day$/,
    );
    const flow = screen.getByRole("region", { name: /Declared and resolved per day/ });

    expect(flow.textContent).toMatch(/Declared2/);
    expect(flow.textContent).toMatch(/Resolved1/);

    await user.click(days[5]);

    expect(navigation.replace).toHaveBeenLastCalledWith(
      "/orgs/acme-ops/incidents/history?from=2026-09-18&to=2026-09-18",
      { scroll: false },
    );
  });

  it("lists every incident under the day it is placed on, a page at a time", async () => {
    const user = userEvent.setup();
    const { requests } = api(READ);
    renderHistory();

    const table = await screen.findByRole("table", {
      name: "Incidents in this period",
    });
    const region = screen.getByRole("region", { name: /Incidents in this period/ });

    expect(region.textContent).toMatch(/Incidents in this period\s*14/);
    // Three columns of headings a reader can trace each value to.
    for (const heading of ["Time", "Severity", "Incident", "In this period", "Status", "Lasted", "Action"]) {
      expect(within(table).getByRole("columnheader", { name: heading })).toBeDefined();
    }

    // The days, as group headings, with what happened on each.
    const groups = within(table).getAllByRole("rowgroup").slice(1);

    expect(groups).toHaveLength(2);
    expect(groups[0].textContent).toMatch(/18.*2 declared · 1 resolved/);

    const [first, second] = within(groups[0]).getAllByRole("row").slice(1);

    expect(first.textContent).toMatch(/^19:04/);
    expect(first.textContent).toMatch(/INC-8Delayed webhook delivery to partners/);
    expect(first.textContent).toMatch(/Payment API · Payments/);
    expect(first.textContent).toMatch(/Declared 19:04/);
    expect(first.textContent).toMatch(/Investigating/);
    expect(first.textContent).toMatch(/open /);
    expect(
      within(first).getByRole("link", { name: "View INC-8" }).getAttribute("href"),
    ).toBe("/orgs/acme-ops/incidents/8");
    // Declared the day before, so its declaration carries that date.
    // The date wears the reader's locale; the shape is what is checked.
    expect(second.textContent).toMatch(/Declared \w+ 17 → Resolved 00:10/);
    expect(second.textContent).toMatch(/20m/);

    expect(region.textContent).toMatch(/Showing 3 of 14/);
    expect(histories(requests)).toEqual(["from=2026-09-13&to=2026-09-19"]);

    await user.click(screen.getByRole("button", { name: "Load more" }));

    await waitFor(() => expect(region.textContent).toMatch(/Showing 4 of 14/));
    expect(screen.getByText("Ledger export slow")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
    expect(histories(requests)).toEqual([
      "from=2026-09-13&to=2026-09-19",
      "from=2026-09-13&to=2026-09-19&cursor=next",
    ]);
  });

  it("narrows the history by severity, what became of it, and a search, in the address", async () => {
    const user = userEvent.setup();
    const { requests } = api(READ);
    renderHistory();

    await screen.findByRole("table", { name: "Incidents in this period" });

    // Each choice carries the period's own count.
    const show = screen.getByRole("group", { name: "Show" });

    await waitFor(() =>
      expect(within(show).getByRole("button", { name: "Still open 3" })).toBeDefined(),
    );
    expect(within(show).getByRole("button", { name: "Everything 14" })).toBeDefined();
    expect(within(show).getByRole("button", { name: "Resolved 9" })).toBeDefined();

    await user.click(screen.getByRole("button", { name: "SEV1 Critical" }));
    await user.click(within(show).getByRole("button", { name: "Still open 3" }));
    await user.type(screen.getByRole("searchbox", { name: "Search" }), "webhook");
    await user.click(screen.getByRole("button", { name: "Search" }));

    expect(navigation.snapshot()).toBe("severity=SEV1&show=open&q=webhook");
    await waitFor(() =>
      expect(histories(requests)).toContain(
        "from=2026-09-13&to=2026-09-19&severity=SEV1&show=open&q=webhook",
      ),
    );

    // Pressed again, a chip no longer applies; Clear takes the rest.
    await user.click(within(show).getByRole("button", { name: "Still open 3" }));
    expect(navigation.snapshot()).toBe("severity=SEV1&q=webhook");
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(navigation.snapshot()).toBe("");
  });

  it("takes a filter that can never apply out of the address, keeping the rest", async () => {
    navigation.set("from=2026-09-01&to=2026-09-10&severity=SEV9&show=soon&q=ledger");

    api(READ);
    renderHistory();

    await waitFor(() =>
      expect(navigation.snapshot()).toBe("from=2026-09-01&to=2026-09-10&q=ledger"),
    );
  });

  it("says when nothing matches the filters, apart from when nothing happened", async () => {
    navigation.set("severity=SEV1");
    api(READ, { history: () => page([], 0) });
    renderHistory();

    expect(await screen.findByText("No incidents match")).toBeDefined();
  });

  it("says plainly when nothing happened in the period", async () => {
    api(READ, { summary: quiet, history: () => page([], 0) });
    renderHistory();

    expect(await screen.findByText("Nothing happened in this period")).toBeDefined();
    await waitFor(async () => expect(await tile("Typical duration")).toBe("—none resolved"));
  });

  it("opens straight onto a period named in the address", async () => {
    navigation.set("from=2026-09-01&to=2026-09-10");

    const { requests } = api(READ);
    renderHistory();

    await screen.findByLabelText("This period");

    expect(document.body.textContent).toMatch(/· 10 days · UTC/);
    // Not one of the presets, so Custom is the choice made.
    expect(periodChoice("Custom").getAttribute("aria-pressed")).toBe("true");
    await waitFor(() =>
      expect(summaries(requests)).toEqual(["2026-09-01..2026-09-10"]),
    );
    // A deep link is not rewritten.
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it("selects the preset a linked period turns out to be", async () => {
    navigation.set("from=2026-09-19&to=2026-09-19");

    api(READ);
    renderHistory();

    await screen.findByLabelText("This period");

    expect(periodChoice("Today").getAttribute("aria-pressed")).toBe("true");
  });

  it("puts a range the API would refuse out of the address", async () => {
    navigation.set("from=2026-09-19&to=2026-09-13");

    const { requests } = api(READ);
    renderHistory();

    await screen.findByLabelText("This period");

    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith(
        "/orgs/acme-ops/incidents/history",
        { scroll: false },
      ),
    );
    // Back to the default seven days, and never asked for the bad range.
    expect(summaries(requests)).toEqual(["2026-09-13..2026-09-19"]);
    expect(periodChoice("7 days").getAttribute("aria-pressed")).toBe("true");
  });

  it("changes the period by replacing the address, so Back leaves the page", async () => {
    const user = userEvent.setup();
    const { requests } = api(READ);
    renderHistory();

    await waitFor(async () => expect(await tile("Declared")).toMatch(/^12/));

    await user.click(periodChoice("Today"));

    await waitFor(async () => expect(await tile("Declared")).toMatch(/^1/));
    expect(document.body.textContent).toMatch(/· 1 day · UTC/);
    expect(navigation.replace).toHaveBeenCalledWith(
      "/orgs/acme-ops/incidents/history?from=2026-09-19&to=2026-09-19",
      { scroll: false },
    );
    expect(summaries(requests)).toEqual([
      "2026-09-13..2026-09-19",
      "2026-09-19..2026-09-19",
    ]);
  });

  it("applies a custom range from the calendar, and only on Apply", async () => {
    const user = userEvent.setup();
    const { requests } = api(READ);
    renderHistory();

    await screen.findByLabelText("This period");

    await user.click(periodChoice("Custom"));

    const calendar = screen.getByRole("dialog", { name: "Choose dates (UTC)" });

    // A native dialog, shown above the page rather than in its flow.
    expect(calendar.tagName).toBe("DIALOG");
    expect((calendar as HTMLDialogElement).open).toBe(true);
    // Nothing after today can be chosen.
    expect(
      (
        within(calendar).getByRole("button", {
          name: /September 20th, 2026/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);

    await user.click(
      within(calendar).getByRole("button", { name: /September 1st, 2026/ }),
    );
    await user.click(
      within(calendar).getByRole("button", { name: /September 10th, 2026/ }),
    );

    expect(calendar.textContent).toMatch(/2026-09-01 → 2026-09-10\s*· 10 days/);
    expect(summaries(requests)).toHaveLength(1);

    await user.click(within(calendar).getByRole("button", { name: "Apply" }));

    await waitFor(() =>
      expect(summaries(requests)).toContain("2026-09-01..2026-09-10"),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.textContent).toMatch(/· 10 days · UTC/);
    expect(navigation.snapshot()).toBe("from=2026-09-01&to=2026-09-10");

    // Reopened, it shows the applied range; abandoning a change keeps it.
    await user.click(screen.getByRole("button", { name: "Change dates" }));

    const reopened = screen.getByRole("dialog", { name: "Choose dates (UTC)" });

    expect(reopened.textContent).toMatch(/2026-09-01 → 2026-09-10\s*· 10 days/);

    await user.click(
      within(reopened).getByRole("button", { name: /September 15th, 2026/ }),
    );
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.textContent).toMatch(/· 10 days · UTC/);
    expect(summaries(requests)).toHaveLength(2);
  });

  it("keeps the applied period when a custom range is cancelled", async () => {
    const user = userEvent.setup();
    const { requests } = api(READ);
    renderHistory();

    await screen.findByLabelText("This period");

    await user.click(periodChoice("Custom"));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog")).toBeNull();
    // Nothing was applied, so the period — and the choice — stand.
    expect(periodChoice("7 days").getAttribute("aria-pressed")).toBe("true");
    expect(summaries(requests)).toEqual(["2026-09-13..2026-09-19"]);
  });

  it("has no accessibility violations", async () => {
    api(READ);

    const { container } = renderHistory();

    await screen.findByRole("table", { name: "Incidents in this period" });
    await screen.findByRole("group", { name: "Declared and resolved per day" });
    await expectNoAxeViolations(container);
  });
});
