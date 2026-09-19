import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OrganizationOverview } from "@/components/organizations/organization-overview";
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
import { renderWithSession } from "@/test/render";

vi.mock("next/navigation", () => ({
  useParams: () => ({ orgSlug: "acme-ops" }),
  usePathname: () => "/orgs/acme-ops",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const READ = [
  "incidents:read",
  "memberships:read",
  "organization:read",
  "services:read",
  "teams:read",
];

const base = `/organizations/${organization.id}`;

const incident = (overrides: Partial<IncidentResponse> = {}): IncidentResponse => ({
  id: "0199a1b2-c3d4-7000-8000-0000000000f1",
  number: 42,
  title: "Card payments failing",
  summary: null,
  severity: "SEV1",
  status: "IDENTIFIED",
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

const resolvedIncident = incident({
  id: "0199a1b2-c3d4-7000-8000-0000000000f7",
  number: 7,
  title: "Reports delayed",
  severity: "SEV3",
  status: "RESOLVED",
  createdAt: "2026-09-15T08:00:00.000Z",
  resolvedAt: "2026-09-15T10:30:00.000Z",
});

const none = { SEV1: 0, SEV2: 0, SEV3: 0, SEV4: 0 };

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

/** Three active incidents on one service; the period's figures vary by `from`. */
const busy = (from: string, to: string): IncidentSummaryResponse => ({
  current: {
    active: 3,
    activeBySeverity: { SEV1: 1, SEV2: 0, SEV3: 2, SEV4: 0 },
    affectedServices: [
      {
        id: "0199a1b2-c3d4-7000-8000-0000000000e1",
        name: "Payment API",
        slug: "payment-api",
        criticality: "CRITICAL",
        archivedAt: null,
        ownerTeam: {
          id: "0199a1b2-c3d4-7000-8000-0000000000c1",
          name: "Payments",
          slug: "payments",
        },
        activeIncidents: 3,
        worstSeverity: "SEV1",
      },
    ],
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
                // Declared before the period, resolved inside it.
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

/** The period a summary request asked for, as "from..to". */
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
  {
    summary = busy,
    active = [incident()],
  }: {
    summary?: (from: string, to: string) => IncidentSummaryResponse;
    active?: IncidentResponse[];
  } = {},
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
      case `GET ${base}/memberships`:
        return jsonResponse(200, []);
      case `GET ${base}/incidents?state=active`:
        return jsonResponse(200, {
          items: active,
          page: { cursor: null, hasMore: false },
        });
      default:
        return apiError(404);
    }
  });

const renderOverview = () =>
  renderWithSession(
    <OrganizationScope>
      <OrganizationOverview />
    </OrganizationScope>,
  );

describe("the operations overview", () => {
  beforeEach(() => {
    clearAccessToken();
    // Only Date: the queries' and user-event's timers stay real.
    vi.useFakeTimers({
      toFake: ["Date"],
      now: new Date("2026-09-19T12:00:00.000Z"),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows where response stands now, and the last seven UTC days", async () => {
    const { requests } = api(READ);
    renderOverview();

    const current = await screen.findByRole("region", {
      name: "Current operations",
    });

    await within(current).findByText("active incidents");
    expect(within(current).getByText("3")).toBeDefined();
    // The panel says which of the two sections it is.
    expect(within(current).getByText("Now")).toBeDefined();

    const bySeverity = within(current).getByLabelText("Active incidents by severity");
    expect(bySeverity.textContent).toMatch(/SEV1\s*Critical\s*1/);
    expect(bySeverity.textContent).toMatch(/SEV3\s*Moderate\s*2/);

    const top = await within(current).findByRole("link", {
      name: /INC-42\s+Card payments failing/,
    });
    expect(top.getAttribute("href")).toBe("/orgs/acme-ops/incidents/42");
    expect(
      within(current).getByRole("link", { name: /View all 3 active incidents/ }).getAttribute("href"),
    ).toBe("/orgs/acme-ops/incidents");

    const affected = within(current).getByRole("list", {
      name: "Affected services",
    });
    expect(
      within(affected).getByRole("link", { name: "Payment API" }).getAttribute("href"),
    ).toBe("/orgs/acme-ops/services/payment-api");
    expect(affected.textContent).toMatch(/Critical/);
    expect(affected.textContent).toMatch(/Payments · 3 active incidents/);

    const period = screen.getByRole("region", { name: "Incident history" });

    expect(
      within(period).getByRole("tab", { name: "7 days" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(period.textContent).toMatch(/2026-09-13 → 2026-09-19\s*· 7 days · UTC/);

    const figures = await within(period).findByLabelText("Totals for this period");
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
    expect(within(period).getByText(/Current severity/)).toBeDefined();
    // The two sections' labels: Now, and the period chosen.
    expect(within(current).getByText("Now")).toBeDefined();
    expect(within(period).getByText("Selected period")).toBeDefined();
    expect(
      within(period)
        .getByLabelText("Incidents declared in this period, by current severity")
        .textContent,
    ).toMatch(/SEV1\s*Critical\s*2/);
    // One history, newest first, grouped by the UTC date things happened.
    const history = within(period).getByRole("region", {
      name: "Incidents in this period",
    });
    const groups = within(history).getAllByRole("list");

    expect(
      within(history).getByRole("heading", { level: 3 }).textContent,
    ).toMatch(/Incidents in this period/);
    expect(history.textContent).toMatch(/Incidents in this period\s*14/);
    expect(groups).toHaveLength(2);
    // The 18th first, holding the running incident and the one resolved
    // that morning; then the 17th, holding the earlier resolution.
    expect(within(groups[0]).getAllByRole("listitem")).toHaveLength(2);
    expect(within(groups[1]).getAllByRole("listitem")).toHaveLength(1);

    const [first, second] = within(groups[0]).getAllByRole("listitem");

    expect(
      within(first).getByRole("link", { name: "Delayed webhook delivery to partners" }).getAttribute("href"),
    ).toBe("/orgs/acme-ops/incidents/8");
    expect(first.textContent).toMatch(/19:04/);
    expect(first.textContent).toMatch(/SEV4/);
    expect(first.textContent).toMatch(/Payment API · Payments/);
    expect(first.textContent).toMatch(/Declared 19:04/);
    expect(first.textContent).toMatch(/Investigating/);
    expect(first.textContent).toMatch(/open/);
    // Declared the day before, so its declaration carries that date.
    // The date wears the reader's locale; the shape is what is checked.
    expect(second.textContent).toMatch(/Declared \w+ 17 → Resolved 00:10/);
    expect(second.textContent).toMatch(/Resolved.*lasted 20m/);
    // Resolved in the period, declared before it.
    expect(
      within(groups[1]).getByRole("listitem").textContent,
    ).toMatch(/Declared 10:30 → Resolved 10:30|Resolved/);

    expect(
      within(period).getByRole("link", { name: /View period incidents/ }).getAttribute("href"),
    ).toBe("/orgs/acme-ops/incidents?from=2026-09-13&to=2026-09-19");

    expect(summaries(requests)).toEqual(["2026-09-13..2026-09-19"]);
  });

  it("changes only the period's figures when the period changes", async () => {
    const user = userEvent.setup();
    const { requests } = api(READ);
    renderOverview();

    const period = await screen.findByRole("region", { name: "Incident history" });
    await within(period).findByText("12");

    await user.click(within(period).getByRole("tab", { name: "Today" }));

    const figures = await within(period).findByLabelText("Totals for this period");
    await waitFor(() =>
      expect(figures.textContent).toMatch(/^Declared1Incidents declared/),
    );
    expect(period.textContent).toMatch(/2026-09-19\s*· 1 day · UTC/);
    expect(
      within(period).getByRole("region", { name: "Incidents in this period" })
        .textContent,
    ).toMatch(/Delayed webhook delivery to partners/);

    const current = screen.getByRole("region", { name: "Current operations" });
    expect(within(current).getByText("3")).toBeDefined();
    expect(summaries(requests)).toEqual([
      "2026-09-13..2026-09-19",
      "2026-09-19..2026-09-19",
    ]);
  });

  it("applies a custom range from the calendar, and only on Apply", async () => {
    const user = userEvent.setup();
    const { requests } = api(READ);
    renderOverview();

    const period = await screen.findByRole("region", { name: "Incident history" });
    await within(period).findByText("12");

    await user.click(within(period).getByRole("tab", { name: "Custom" }));

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
    expect(period.textContent).toMatch(/2026-09-01 → 2026-09-10\s*· 10 days · UTC/);
    // Focus returns to what opened it.
    expect(document.activeElement).toBe(
      within(period).getByRole("tab", { name: "Custom" }),
    );

    // Reopened, it shows the applied range; abandoning a change keeps it.
    await user.click(within(period).getByRole("button", { name: "Change dates" }));

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
    expect(period.textContent).toMatch(/2026-09-01 → 2026-09-10\s*· 10 days · UTC/);
    expect(document.activeElement).toBe(
      within(period).getByRole("button", { name: "Change dates" }),
    );
    expect(summaries(requests)).toHaveLength(2);
  });

  it("abandons the draft on a click outside the calendar", async () => {
    const user = userEvent.setup();
    const { requests } = api(READ);
    renderOverview();

    const period = await screen.findByRole("region", { name: "Incident history" });
    await within(period).findByText("12");

    await user.click(within(period).getByRole("tab", { name: "Custom" }));

    const calendar = screen.getByRole("dialog", { name: "Choose dates (UTC)" });

    await user.click(
      within(calendar).getByRole("button", { name: /September 1st, 2026/ }),
    );
    // A click on the backdrop lands on the dialog element itself.
    await user.click(calendar);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(period.textContent).toMatch(/2026-09-13 → 2026-09-19\s*· 7 days · UTC/);
    expect(summaries(requests)).toEqual(["2026-09-13..2026-09-19"]);
  });

  it("returns to the preset when a first custom range is cancelled", async () => {
    const user = userEvent.setup();
    const { requests } = api(READ);
    renderOverview();

    const period = await screen.findByRole("region", { name: "Incident history" });
    await within(period).findByText("12");

    await user.click(within(period).getByRole("tab", { name: "Custom" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    const sevenDays = within(period).getByRole("tab", { name: "7 days" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(sevenDays.getAttribute("aria-selected")).toBe("true");
    // Custom is no longer the selected tab, so focus goes to the one that is.
    expect(document.activeElement).toBe(sevenDays);
    expect(summaries(requests)).toEqual(["2026-09-13..2026-09-19"]);
  });

  it("says all is clear when nothing is active", async () => {
    api(READ, { summary: quiet, active: [] });
    renderOverview();

    const current = await screen.findByRole("region", {
      name: "Current operations",
    });

    expect(await within(current).findByText("All clear")).toBeDefined();
    expect(within(current).queryByRole("table")).toBeNull();
    expect(
      await screen.findByText("Nothing happened in this period"),
    ).toBeDefined();
  });

  it("asks nothing about incidents without incidents:read", async () => {
    const { requests } = api(["organization:read"]);
    renderOverview();

    await screen.findByText("No operations to show");

    expect(
      screen.queryByRole("region", { name: "Current operations" }),
    ).toBeNull();
    expect(summaries(requests)).toEqual([]);
  });
});
