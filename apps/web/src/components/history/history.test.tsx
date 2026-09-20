import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IncidentHistory } from "@/components/history/incident-history";
import { OrganizationScope } from "@/components/organizations/organization-scope";
import type {
  IncidentResponse,
  IncidentSummaryResponse,
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
 * A router that remembers its query string, so the page's period — which
 * lives in the address — can be set by a link, changed by a tab, and read
 * back the way a browser would.
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

const READ = [
  "incidents:read",
  "memberships:read",
  "organization:read",
  "services:read",
  "teams:read",
];

const base = `/organizations/${organization.id}`;
const none = { SEV1: 0, SEV2: 0, SEV3: 0, SEV4: 0 };

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
const runningIncident = incident({
  id: "0199a1b2-c3d4-7000-8000-0000000000f8",
  number: 8,
  title: "Delayed webhook delivery to partners",
  severity: "SEV4",
  status: "INVESTIGATING",
  createdAt: "2026-09-18T19:04:00.000Z",
});

/** Declared on the 17th and resolved on the 18th: one item, both flags. */
const spanningIncident = incident({
  id: "0199a1b2-c3d4-7000-8000-0000000000f9",
  number: 9,
  title: "Intermittent 502s on card tokenisation",
  severity: "SEV2",
  status: "RESOLVED",
  createdAt: "2026-09-17T23:50:00.000Z",
  resolvedAt: "2026-09-18T00:10:00.000Z",
});

/** Declared on the 15th and resolved in it. */
const resolvedIncident = incident({
  id: "0199a1b2-c3d4-7000-8000-0000000000f7",
  number: 7,
  title: "Reports delayed",
  severity: "SEV3",
  status: "RESOLVED",
  createdAt: "2026-09-15T08:00:00.000Z",
  resolvedAt: "2026-09-15T10:30:00.000Z",
});

/** The figures vary by period, so a change is visible on screen. */
const busy = (from: string, to: string): IncidentSummaryResponse => ({
  current: {
    active: 3,
    activeBySeverity: { SEV1: 1, SEV2: 0, SEV3: 2, SEV4: 0 },
    affectedServices: [],
  },
  period:
    from === to
      ? {
          from,
          to,
          declared: 1,
          declaredBySeverity: { ...none, SEV1: 1 },
          resolved: 0,
          stillOpen: 1,
          history: {
            total: 1,
            items: [
              {
                incident: runningIncident,
                declaredInPeriod: true,
                resolvedInPeriod: false,
              },
            ],
          },
        }
      : {
          from,
          to,
          declared: 12,
          declaredBySeverity: { SEV1: 2, SEV2: 3, SEV3: 5, SEV4: 2 },
          resolved: 9,
          stillOpen: 3,
          history: {
            // More than the three previewed.
            total: 14,
            items: [
              {
                incident: runningIncident,
                declaredInPeriod: true,
                resolvedInPeriod: false,
              },
              {
                incident: spanningIncident,
                declaredInPeriod: true,
                resolvedInPeriod: true,
              },
              {
                incident: resolvedIncident,
                declaredInPeriod: false,
                resolvedInPeriod: true,
              },
            ],
          },
        },
});

const quiet = (from: string, to: string): IncidentSummaryResponse => ({
  current: { active: 0, activeBySeverity: none, affectedServices: [] },
  period: {
    from,
    to,
    declared: 0,
    declaredBySeverity: none,
    resolved: 0,
    stillOpen: 0,
    history: { total: 0, items: [] },
  },
});

const SUMMARY = `GET ${base}/incidents/summary`;

const periodOf = (request: SentRequest) => {
  const query = new URLSearchParams(request.path.split("?")[1]);

  return `${query.get("from")}..${query.get("to")}`;
};

const summaries = (requests: SentRequest[]) =>
  requests
    .filter((request) => route(request).startsWith(`${SUMMARY}?`))
    .map(periodOf);

const api = (
  permissions: string[],
  summary: (from: string, to: string) => IncidentSummaryResponse = busy,
) =>
  mockApi((request) => {
    if (route(request).startsWith(`${SUMMARY}?`)) {
      const [from, to] = periodOf(request).split("..");

      return jsonResponse(200, summary(from, to));
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

/** The page's one region of records. */
const historyRegion = () =>
  screen.getByRole("region", { name: "Incidents in this period" });

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

  it("shows the last seven UTC days, as its own page under Incidents", async () => {
    const { requests } = api(READ);
    renderHistory();

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Incident history",
      }),
    ).toBeDefined();
    // Back the way they came, into the Incidents workflow.
    expect(
      screen.getByRole("link", { name: "← Incidents" }).getAttribute("href"),
    ).toBe("/orgs/acme-ops/incidents");

    expect(
      screen.getByRole("tab", { name: "7 days" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(document.body.textContent).toMatch(
      /2026-09-13 → 2026-09-19\s*· 7 days · UTC/,
    );

    const figures = await screen.findByLabelText("Totals for this period");

    // Each figure reads label, value, then what exactly it counts — said to
    // a screen reader, not shown.
    expect(figures.textContent).toMatch(/^Declared12Incidents declared in this period\./);
    expect(figures.textContent).toMatch(
      /Resolved9Incidents resolved in this period, whenever they were declared\./,
    );
    expect(figures.textContent).toMatch(
      /Still open3Incidents declared in this period and not yet resolved\./,
    );
    for (const description of within(figures).getAllByText(/^Incidents /)) {
      expect(description.className).toBe("sr-only");
    }
    expect(screen.getByText(/Current severity/)).toBeDefined();
    expect(
      screen
        .getByLabelText("Incidents declared in this period, by current severity")
        .textContent,
    ).toMatch(/SEV1\s*Critical\s*2/);

    // One history, newest first, grouped by the UTC date things happened.
    const history = historyRegion();
    const groups = within(history).getAllByRole("list");

    expect(
      within(history).getByRole("heading", { level: 2 }).textContent,
    ).toMatch(/Incidents in this period/);
    expect(history.textContent).toMatch(/Incidents in this period\s*14/);
    expect(groups).toHaveLength(2);
    expect(within(groups[0]).getAllByRole("listitem")).toHaveLength(2);
    expect(within(groups[1]).getAllByRole("listitem")).toHaveLength(1);

    const [first, second] = within(groups[0]).getAllByRole("listitem");

    expect(
      within(first)
        .getByRole("link", { name: "Delayed webhook delivery to partners" })
        .getAttribute("href"),
    ).toBe("/orgs/acme-ops/incidents/8");
    expect(first.textContent).toMatch(/19:04/);
    expect(first.textContent).toMatch(/SEV4/);
    expect(first.textContent).toMatch(/Payment API · Payments/);
    expect(first.textContent).toMatch(/Declared 19:04/);
    expect(first.textContent).toMatch(/Investigating/);
    // Declared the day before, so its declaration carries that date.
    // The date wears the reader's locale; the shape is what is checked.
    expect(second.textContent).toMatch(/Declared \w+ 17 → Resolved 00:10/);
    expect(second.textContent).toMatch(/Resolved.*lasted 20m/);

    expect(
      within(history)
        .getByRole("link", { name: /View period incidents/ })
        .getAttribute("href"),
    ).toBe("/orgs/acme-ops/incidents?from=2026-09-13&to=2026-09-19");

    expect(summaries(requests)).toEqual(["2026-09-13..2026-09-19"]);
    // Nothing of the Overview's: this page is the record, not the state now.
    expect(
      screen.queryByRole("region", { name: "Current operations" }),
    ).toBeNull();
    expect(screen.queryByText("What needs you")).toBeNull();
  });

  it("opens straight onto a period named in the address", async () => {
    navigation.set("from=2026-09-01&to=2026-09-10");

    const { requests } = api(READ);
    renderHistory();

    await screen.findByLabelText("Totals for this period");

    expect(document.body.textContent).toMatch(
      /2026-09-01 → 2026-09-10\s*· 10 days · UTC/,
    );
    // Not one of the presets, so Custom is the selected tab.
    expect(
      screen.getByRole("tab", { name: "Custom" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(summaries(requests)).toEqual(["2026-09-01..2026-09-10"]);
    // A deep link is not rewritten.
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it("selects the preset a linked period turns out to be", async () => {
    navigation.set("from=2026-09-19&to=2026-09-19");

    api(READ);
    renderHistory();

    await screen.findByLabelText("Totals for this period");

    expect(
      screen.getByRole("tab", { name: "Today" }).getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("puts a range the API would refuse out of the address", async () => {
    navigation.set("from=2026-09-19&to=2026-09-13");

    const { requests } = api(READ);
    renderHistory();

    await screen.findByLabelText("Totals for this period");

    await waitFor(() =>
      expect(navigation.replace).toHaveBeenCalledWith(
        "/orgs/acme-ops/incidents/history",
        { scroll: false },
      ),
    );
    // Back to the default seven days, and never asked for the bad range.
    expect(summaries(requests)).toEqual(["2026-09-13..2026-09-19"]);
    expect(
      screen.getByRole("tab", { name: "7 days" }).getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("changes the period, and says so in the address", async () => {
    const user = userEvent.setup();
    const { requests } = api(READ);
    renderHistory();

    await screen.findByText("12");

    await user.click(screen.getByRole("tab", { name: "Today" }));

    const figures = await screen.findByLabelText("Totals for this period");

    await waitFor(() =>
      expect(figures.textContent).toMatch(/^Declared1Incidents declared/),
    );
    expect(document.body.textContent).toMatch(/2026-09-19\s*· 1 day · UTC/);
    expect(historyRegion().textContent).toMatch(
      /Delayed webhook delivery to partners/,
    );
    // The address carries the period, so the view can be linked and returned to.
    expect(navigation.snapshot()).toBe("from=2026-09-19&to=2026-09-19");
    expect(summaries(requests)).toEqual([
      "2026-09-13..2026-09-19",
      "2026-09-19..2026-09-19",
    ]);
  });

  it("replaces rather than stacks, so Back leaves the page", async () => {
    const user = userEvent.setup();

    api(READ);
    renderHistory();

    await screen.findByText("12");
    await user.click(screen.getByRole("tab", { name: "Today" }));
    await waitFor(() => expect(navigation.replace).toHaveBeenCalled());

    expect(navigation.replace).toHaveBeenCalledWith(
      "/orgs/acme-ops/incidents/history?from=2026-09-19&to=2026-09-19",
      { scroll: false },
    );
  });

  it("applies a custom range from the calendar, and only on Apply", async () => {
    const user = userEvent.setup();
    const { requests } = api(READ);
    renderHistory();

    await screen.findByText("12");

    await user.click(screen.getByRole("tab", { name: "Custom" }));

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
    expect(document.body.textContent).toMatch(
      /2026-09-01 → 2026-09-10\s*· 10 days · UTC/,
    );
    expect(navigation.snapshot()).toBe("from=2026-09-01&to=2026-09-10");
    // Focus returns to what opened it, now the selected tab.
    expect(document.activeElement).toBe(
      screen.getByRole("tab", { name: "Custom" }),
    );

    // Reopened, it shows the applied range; abandoning a change keeps it.
    await user.click(screen.getByRole("button", { name: "Change dates" }));

    const reopened = screen.getByRole("dialog", { name: "Choose dates (UTC)" });

    expect(reopened.textContent).toMatch(/2026-09-01 → 2026-09-10\s*· 10 days/);
    expect(
      within(reopened).getByRole("button", {
        name: /September 1st, 2026, selected/,
      }),
    ).toBeDefined();

    await user.click(
      within(reopened).getByRole("button", { name: /September 15th, 2026/ }),
    );
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.textContent).toMatch(
      /2026-09-01 → 2026-09-10\s*· 10 days · UTC/,
    );
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Change dates" }),
    );
    expect(summaries(requests)).toHaveLength(2);
  });

  it("abandons the draft on a click outside the calendar", async () => {
    const user = userEvent.setup();
    const { requests } = api(READ);
    renderHistory();

    await screen.findByText("12");

    await user.click(screen.getByRole("tab", { name: "Custom" }));

    const calendar = screen.getByRole("dialog", { name: "Choose dates (UTC)" });

    await user.click(
      within(calendar).getByRole("button", { name: /September 1st, 2026/ }),
    );
    // A click on the backdrop lands on the dialog element itself.
    await user.click(calendar);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.body.textContent).toMatch(
      /2026-09-13 → 2026-09-19\s*· 7 days · UTC/,
    );
    expect(summaries(requests)).toEqual(["2026-09-13..2026-09-19"]);
    expect(navigation.snapshot()).toBe("");
  });

  it("keeps the applied period when a custom range is cancelled", async () => {
    const user = userEvent.setup();
    const { requests } = api(READ);
    renderHistory();

    await screen.findByText("12");

    await user.click(screen.getByRole("tab", { name: "Custom" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    const sevenDays = screen.getByRole("tab", { name: "7 days" });

    expect(screen.queryByRole("dialog")).toBeNull();
    // Nothing was applied, so the period — and the selected tab — stand.
    expect(sevenDays.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(sevenDays);
    expect(summaries(requests)).toEqual(["2026-09-13..2026-09-19"]);
  });

  it("says plainly when nothing happened in the period", async () => {
    api(READ, quiet);
    renderHistory();

    expect(
      await screen.findByText("Nothing happened in this period"),
    ).toBeDefined();
  });

  it("asks nothing about incidents without incidents:read", async () => {
    const { requests } = api(["organization:read"]);
    renderHistory();

    await screen.findByText("No history to show");

    expect(screen.queryByRole("tablist", { name: "Period" })).toBeNull();
    expect(summaries(requests)).toEqual([]);
  });

  it("has no accessibility violations", async () => {
    api(READ);

    const { container } = renderHistory();

    await screen.findByLabelText("Totals for this period");
    await expectNoAxeViolations(container);
  });
});
