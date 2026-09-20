import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OrganizationOverview } from "@/components/organizations/organization-overview";
import { OrganizationScope } from "@/components/organizations/organization-scope";
import type {
  ActivityIncidentResponse,
  IncidentAttentionResponse,
  IncidentDetailResponse,
  IncidentResponse,
  IncidentSeverity,
  IncidentSummaryResponse,
  OperationalActivityDayResponse,
  OperationalActivityResponse,
} from "@/lib/api/contracts";
import { queryKeys } from "@/lib/api/query-keys";
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
const ACTIVITY = `GET ${base}/incidents/activity`;

const DAY_MS = 86_400_000;

/**
 * The year so far, which is what the Overview asks for, read on 19
 * September. 2026 opens on a Thursday, so the calendar's first column opens
 * in December 2025 and its last closes in January 2027: 53 columns.
 */
const WINDOW = { from: "2026-01-01", to: "2026-09-19" };
const WINDOW_DAYS = 262;
const YEAR_COLUMNS = 53;

/** The days most tests need: the fortnight their fixtures name. */
const RECENT = { from: "2026-09-06", to: "2026-09-19" };
const RECENT_DAYS = 14;

const NO_COUNTS = {
  declared: 0,
  responseStarted: 0,
  update: 0,
  responseCompleted: 0,
  resolved: 0,
  changed: 0,
};

/** One incident as a day names it: identity, and how much of the day it was. */
const touched = (
  number: number,
  title: string,
  events: number,
  severity: IncidentSeverity = "SEV2",
): ActivityIncidentResponse => ({
  id: `0199a1b2-c3d4-7000-8000-00000000${number}`,
  number,
  title,
  severity,
  status: "RESOLVED",
  service: { name: "Payment API", slug: "payment-api" },
  events,
});

/** A busy Thursday, a quieter Tuesday, and quiet days either side. */
const BUSY_DAY = "2026-09-17";
const QUIET_DAY = "2026-09-16";

const DAYS: Record<string, Partial<OperationalActivityDayResponse>> = {
  [BUSY_DAY]: {
    total: 14,
    level: 4,
    counts: {
      ...NO_COUNTS,
      declared: 2,
      responseStarted: 3,
      update: 7,
      resolved: 2,
    },
    incidents: [
      touched(57, "Payment API 5xx during database failover", 9, "SEV1"),
      touched(58, "Sign-in errors during database failover", 5),
    ],
    moreIncidents: 3,
  },
  "2026-09-15": {
    total: 4,
    level: 2,
    counts: { ...NO_COUNTS, update: 4 },
    incidents: [touched(57, "Payment API 5xx during database failover", 4)],
  },
};

/**
 * Every day of `over`, quiet unless `days` names it.
 *
 * Most tests only care about the days they name, so they get a fortnight
 * rather than a year: the calendar still draws all 53 columns, but a
 * fixture of 262 squares to query is slow in jsdom and proves nothing the
 * two tests that do ask for a year do not.
 */
const activityOver = (
  days: Record<string, Partial<OperationalActivityDayResponse>> = DAYS,
  over: { from: string; to: string } = RECENT,
): OperationalActivityResponse => {
  const length =
    (Date.parse(`${over.to}T00:00:00.000Z`) -
      Date.parse(`${over.from}T00:00:00.000Z`)) /
      DAY_MS +
    1;
  const all = Array.from({ length }, (_, index) => {
    const date = new Date(Date.parse(`${over.from}T00:00:00.000Z`) + index * DAY_MS)
      .toISOString()
      .slice(0, 10);

    return {
      date,
      total: 0,
      level: 0 as const,
      counts: { ...NO_COUNTS },
      incidents: [],
      moreIncidents: 0,
      ...days[date],
    } as OperationalActivityDayResponse;
  });

  return {
    from: over.from,
    // The calendar reads today off the answer's last day.
    to: WINDOW.to,
    days: all,
    total: all.reduce((sum, day) => sum + day.total, 0),
    activeDays: all.filter((day) => day.total > 0).length,
    thresholds: [1, 3, 6, 11],
  };
};

const NO_ACTIVITY = activityOver({});

/** The whole year so far, for the tests that read the year's shape. */
const FULL_YEAR = activityOver(DAYS, WINDOW);

/** The period a summary request asked for, as "from..to". */
const periodOf = (request: SentRequest) => {
  const query = new URLSearchParams(request.path.split("?")[1]);

  return `${query.get("from")}..${query.get("to")}`;
};

const summaries = (requests: SentRequest[]) =>
  requests
    .filter((request) => route(request).startsWith(`${SUMMARY}?`))
    .map(periodOf);

const activities = (requests: SentRequest[]) =>
  requests
    .filter((request) => route(request).startsWith(`${ACTIVITY}?`))
    .map(periodOf);

/** What a caller with neither incidents:manage nor incidents:respond is told. */
const NO_ATTENTION: IncidentAttentionResponse = { manage: null, respond: null };

const api = (
  permissions: string[],
  {
    summary = busy,
    active = [incident()],
    attention = NO_ATTENTION,
    activity = activityOver(),
    role = "ADMIN",
  }: {
    summary?: (from: string, to: string) => IncidentSummaryResponse;
    active?: IncidentResponse[];
    attention?: IncidentAttentionResponse | (() => Response);
    activity?: OperationalActivityResponse | (() => Response);
    role?: string;
  } = {},
) =>
  mockApi((request) => {
    if (route(request).startsWith(`${SUMMARY}?`)) {
      const [from, to] = periodOf(request).split("..");

      return jsonResponse(200, summary(from, to));
    }

    if (route(request).startsWith(`${ACTIVITY}?`)) {
      return typeof activity === "function"
        ? activity()
        : jsonResponse(200, activity);
    }

    switch (route(request)) {
      case "POST /auth/refresh":
        return refreshed("token");
      case "GET /auth/me":
        return jsonResponse(200, currentUser);
      case `GET ${base}`:
        return jsonResponse(200, organizationDetail(permissions, role));
      case `GET ${base}/incidents/attention`:
        return typeof attention === "function"
          ? attention()
          : jsonResponse(200, attention);
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

  it("shows where response stands now, and the way on to what came before", async () => {
    const { requests } = api(READ);
    renderOverview();

    const current = await screen.findByRole("region", {
      name: "Current operations",
    });

    await within(current).findByText("active incidents");
    expect(within(current).getByText("3")).toBeDefined();
    // The panel says what it covers.
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

    // The way to the record of what came before, without a rail item.
    expect(
      within(current)
        .getByRole("link", { name: /Incident history/ })
        .getAttribute("href"),
    ).toBe("/orgs/acme-ops/incidents/history");

    // The Overview reads only the state now, so it asks for the smallest
    // period there is and never one a person chose.
    expect(summaries(requests)).toEqual(["2026-09-19..2026-09-19"]);
  });

  it("no longer holds incident history, or anything that chose a period", async () => {
    api(READ);
    renderOverview();

    await screen.findByRole("region", { name: "Current operations" });

    expect(
      screen.queryByRole("region", { name: "Incident history" }),
    ).toBeNull();
    expect(screen.queryByRole("tablist", { name: "Period" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "7 days" })).toBeNull();
    expect(
      screen.queryByRole("region", { name: "Incidents in this period" }),
    ).toBeNull();
    expect(screen.queryByLabelText("Totals for this period")).toBeNull();
  });

  it("says all is clear when nothing is active", async () => {
    api(READ, { summary: quiet, active: [] });
    renderOverview();

    const current = await screen.findByRole("region", {
      name: "Current operations",
    });

    expect(await within(current).findByText("All clear")).toBeDefined();
    expect(within(current).queryByRole("table")).toBeNull();
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

  describe("operational activity", () => {
    const section = () =>
      screen.findByRole("region", { name: "Operational activity" });

    /** The section once its 26 weeks have arrived. */
    const loaded = async () => {
      const activity = await section();

      await within(activity).findByRole("grid", {
        name: /Operational activity/,
      });

      return activity;
    };

    /** A date as the reader's locale writes it, which is how it is shown. */
    const namedDate = (date: string) => {
      const [year, month, day] = date.split("-").map(Number);

      return new Intl.DateTimeFormat(undefined, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      }).format(new Date(Date.UTC(year, month - 1, day)));
    };

    /** A day's square, by the date in its accessible name. */
    const dayOn = (date: string) =>
      screen.getByRole("button", {
        // Today says so, between its date and what it holds.
        name: new RegExp(`^${namedDate(date)}( \\(today\\))? \u2014`),
      });

    it("draws the whole year, asking only for the days that have happened", async () => {
      const { requests } = api(READ, { activity: FULL_YEAR });
      renderOverview();

      const activity = await loaded();

      // January to today: there is nothing to ask about the rest of the year.
      expect(activities(requests)).toEqual(["2026-01-01..2026-09-19"]);

      const grid = within(activity).getByRole("grid", {
        name: /Operational activity in 2026/,
      });
      const rows = within(grid).getAllByRole("row");

      expect(rows).toHaveLength(7);
      expect(
        rows.map((row) => within(row).getAllByRole("gridcell").length),
      ).toEqual(Array.from({ length: 7 }, () => YEAR_COLUMNS));
      // Sunday first, and the year's first Sunday heads its column.
      expect(within(rows[0]).getByRole("rowheader").textContent).toBe("Sunday");
      expect(within(rows[0]).getAllByRole("button")[0]).toBe(
        dayOn("2026-01-04"),
      );
      // Today is the last day with anything behind it.
      expect(within(rows[6]).getAllByRole("button").at(-1)).toBe(
        dayOn("2026-09-19"),
      );

      // The scale is explained once, and the grid holds no figures.
      expect(within(activity).getByText("Quiet")).toBeDefined();
      expect(within(activity).getByText("Busy")).toBeDefined();
    });

    it("names all twelve months and all seven weekdays", async () => {
      api(READ);
      renderOverview();

      const activity = await loaded();

      for (const month of [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec",
      ]) {
        expect(within(activity).getByText(month)).toBeDefined();
      }

      for (const weekday of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]) {
        expect(within(activity).getByText(weekday)).toBeDefined();
      }
    });

    it("tells the year's past days, today, and the days still to come apart", async () => {
      api(READ, { activity: FULL_YEAR });
      renderOverview();

      const activity = await loaded();
      const grid = within(activity).getByRole("grid", { name: /Operational/ });

      // Every day of the year so far is a square that can be chosen.
      expect(within(grid).getAllByRole("button")).toHaveLength(WINDOW_DAYS);
      // The rest of the year is drawn, but is not a quiet day.
      expect(grid.querySelectorAll("[data-future]")).toHaveLength(
        365 - WINDOW_DAYS,
      );
      // Today is marked, and nothing else is.
      expect(grid.querySelectorAll("[data-today]")).toHaveLength(1);
      expect(dayOn("2026-09-19").dataset.today).toBe("true");
      // A past day with nothing on it is still a day.
      expect(dayOn(QUIET_DAY).dataset.level).toBe("0");
    });

    it("places a busy day at its own level, and keeps the rest quiet", async () => {
      api(READ);
      renderOverview();
      await loaded();

      expect(dayOn(BUSY_DAY).dataset.level).toBe("4");
      expect(dayOn("2026-09-15").dataset.level).toBe("2");
      expect(dayOn(QUIET_DAY).dataset.level).toBe("0");
      expect(dayOn(QUIET_DAY).getAttribute("aria-label")).toMatch(
        /no activity$/,
      );
    });

    it("sums the grid up in a line until a day is chosen", async () => {
      api(READ);
      renderOverview();

      const activity = await loaded();

      expect(activity.textContent).toMatch(
        /18\s*events on\s*2\s*days so far this year/,
      );
      expect(
        within(activity).getByText("Select a day to see what happened on it."),
      ).toBeDefined();
    });

    it("shows what happened on a chosen day, and the incidents behind it", async () => {
      const user = userEvent.setup();
      const { requests } = api(READ);

      renderOverview();
      await loaded();

      await user.click(dayOn(BUSY_DAY));

      const activity = await section();

      expect(
        within(activity).getByRole("heading", { level: 3 }).textContent,
      ).toContain(namedDate(BUSY_DAY));
      expect(activity.textContent).toMatch(/14 events/);

      // Only what happened: no row of zeroes.
      const counts = within(activity).getByLabelText(
        "What happened on this day",
      );

      expect(counts.textContent).toMatch(/Declared2/);
      expect(counts.textContent).toMatch(/Responses started3/);
      expect(counts.textContent).toMatch(/Updates7/);
      expect(counts.textContent).toMatch(/Resolved2/);
      expect(counts.textContent).not.toMatch(/Responses completed/);
      expect(counts.textContent).not.toMatch(/Severity or team/);

      // The incidents, each linked, with how much of the day was theirs.
      const worst = within(activity).getByRole("link", {
        name: /INC-57\s+Payment API 5xx during database failover/,
      });

      expect(worst.getAttribute("href")).toBe("/orgs/acme-ops/incidents/57");
      expect(
        within(activity)
          .getByRole("link", { name: /INC-58/ })
          .getAttribute("href"),
      ).toBe("/orgs/acme-ops/incidents/58");
      expect(activity.textContent).toMatch(/9 events/);
      expect(activity.textContent).toMatch(/and 3 more incidents/);

      // Through to the other question, for that one day.
      expect(
        within(activity)
          .getByRole("link", { name: /View this day in Incident history/ })
          .getAttribute("href"),
      ).toBe("/orgs/acme-ops/incidents/history?from=2026-09-17&to=2026-09-17");

      // The day came out of the answer already on screen.
      expect(activities(requests)).toEqual(["2026-01-01..2026-09-19"]);
    });

    it("puts the chosen day beside the calendar, in a pane of its own", async () => {
      const user = userEvent.setup();

      api(READ);
      renderOverview();
      await loaded();

      await user.click(dayOn(BUSY_DAY));

      const activity = await section();
      const grid = within(activity).getByRole("grid", { name: /Operational/ });
      const calendarPane = grid.closest(".rounded-md");
      const detail = within(activity)
        .getByLabelText("What happened on this day")
        .closest(".rounded-md");

      // Two surfaces, neither inside the other, sharing one fixed height.
      expect(calendarPane).not.toBeNull();
      expect(detail).not.toBeNull();
      expect(calendarPane?.contains(detail!)).toBe(false);
      expect(calendarPane?.className).toMatch(/lg:h-\[19rem\]/);
      expect(detail?.className).toMatch(/lg:h-\[19rem\]/);

      const panes = calendarPane?.parentElement?.className ?? "";

      // Two columns from `lg` up, and one below it.
      expect(panes).toMatch(/lg:grid-cols-\[3fr_2fr\]/);
      // Wider still, the chosen day takes a fixed column and the calendar
      // takes the rest, so the year stays as scannable as the width allows.
      expect(panes).toMatch(/xl:grid-cols-\[minmax\(0,1fr\)_20rem\]/);
      expect(panes).not.toMatch(/grid-cols-2/);
    });

    it("lays the breakdown out in two even columns, whatever it holds", async () => {
      const user = userEvent.setup();

      api(READ);
      renderOverview();
      await loaded();

      await user.click(dayOn(BUSY_DAY));

      const counts = await screen.findByLabelText("What happened on this day");

      // Two columns, so six kinds of event are three rows and never a
      // different number: the room left over belongs to the incident list.
      expect(counts.className).toMatch(/grid-cols-2/);
      expect(counts.className).toMatch(/shrink-0/);
      expect(counts.className).not.toMatch(/flex-wrap/);
    });

    it("scrolls a long list of incidents inside the chosen day's pane", async () => {
      const user = userEvent.setup();

      api(READ);
      renderOverview();
      await loaded();

      await user.click(dayOn(BUSY_DAY));

      const list = await screen.findByRole("list", {
        name: "Incidents involved on this day",
      });

      // The list gives, so the pane does not: it is what scrolls.
      expect(list.className).toMatch(/overflow-y-auto/);
      expect(list.className).toMatch(/min-h-0/);
      // And it scrolls the way the calendar's weeks do.
      expect(list.className).toMatch(/scrollbar-thin/);
      // The date, the breakdown and the way on stay put.
      expect(
        screen.getByLabelText("What happened on this day").className,
      ).not.toMatch(/overflow-y-auto/);
    });

    it("says calmly that a quiet day held nothing", async () => {
      const user = userEvent.setup();

      api(READ);
      renderOverview();
      await loaded();

      await user.click(dayOn(QUIET_DAY));

      const activity = await section();

      expect(
        within(activity).getByRole("heading", { level: 3 }).textContent,
      ).toContain(namedDate(QUIET_DAY));
      expect(
        within(activity).getByText("Nothing was recorded on this day."),
      ).toBeDefined();
      // Nothing that would read as broken.
      expect(
        within(activity).queryByLabelText("What happened on this day"),
      ).toBeNull();
      expect(activity.textContent).not.toMatch(/View this day in Incident/);
    });

    it("offers no Incident history link until a day is chosen", async () => {
      const user = userEvent.setup();

      api(READ);
      renderOverview();

      const activity = await loaded();

      // The section is about days; the way through belongs to one of them.
      expect(
        within(activity).queryByRole("link", { name: /Incident history/ }),
      ).toBeNull();

      await user.click(dayOn(BUSY_DAY));

      // And once a day is chosen, it carries that day's date with it.
      expect(
        within(await section())
          .getByRole("link", { name: /View this day in Incident history/ })
          .getAttribute("href"),
      ).toBe("/orgs/acme-ops/incidents/history?from=2026-09-17&to=2026-09-17");
    });

    it("says so plainly when the organization has done nothing yet", async () => {
      api(READ, { activity: NO_ACTIVITY });
      renderOverview();

      const activity = await loaded();

      // The grid is still drawn: 26 quiet weeks is a real answer.
      expect(
        within(activity).getByRole("grid", { name: /Operational/ }),
      ).toBeDefined();
      expect(
        within(activity).getByText("No operational activity in 2026"),
      ).toBeDefined();
      expect(activity.textContent).not.toMatch(/Select a day/);
    });

    it("keeps the rest of the overview when activity cannot be read", async () => {
      api(READ, { activity: () => apiError(500) });
      renderOverview();

      const activity = await section();

      expect(
        await within(activity).findByRole("alert", {}, { timeout: 4000 }),
      ).toBeDefined();
      expect(within(activity).queryByRole("grid")).toBeNull();

      // The panels above it are unaffected: each asks for its own.
      const current = await screen.findByRole("region", {
        name: "Current operations",
      });

      expect(within(current).getByText("3")).toBeDefined();
      await within(current).findByRole("table", { name: "Active incidents" });
    });

    it("shows a member the same organization history as an admin", async () => {
      api([...READ, "incidents:respond"], { role: "MEMBER" });
      renderOverview();

      const activity = await loaded();

      expect(
        within(activity).getByRole("grid", { name: /Operational activity/ }),
      ).toBeDefined();
      expect(dayOn(BUSY_DAY).dataset.level).toBe("4");
    });

    it("draws only the days it was given, and the year around them", async () => {
      api(READ);
      renderOverview();

      const activity = await loaded();
      const grid = within(activity).getByRole("grid", { name: /Operational/ });

      // A day with no answer behind it is not drawn as a quiet one.
      expect(within(grid).getAllByRole("button")).toHaveLength(RECENT_DAYS);
      expect(
        within(grid).getAllByRole("row").length * YEAR_COLUMNS,
      ).toBe(7 * YEAR_COLUMNS);
    });

    it("scrolls the weeks rather than shrinking them", async () => {
      api(READ);
      renderOverview();

      const activity = await loaded();
      const grid = within(activity).getByRole("grid", { name: /Operational/ });
      const scroller = grid.closest(".overflow-x-auto");

      expect(scroller).not.toBeNull();
      // The weekday labels stay outside the scrolling area.
      expect(scroller?.contains(within(activity).getByText("Mon"))).toBe(false);
    });

    it("has no accessibility violations with a day chosen", async () => {
      const user = userEvent.setup();

      api(READ);

      const { container } = renderOverview();

      await loaded();
      await user.click(dayOn(BUSY_DAY));
      await expectNoAxeViolations(container);
      // A year of days is ~370 squares for axe to walk, which jsdom does far
      // more slowly than a browser.
    }, 30_000);
  });

  describe("what needs you", () => {
    const MANAGE = [...READ, "incidents:manage", "incidents:respond"];
    const RESPOND = [...READ, "incidents:respond"];
    /** The caller's own membership, as organizationDetail gives it. */
    const ME = organizationDetail([]).membership.id;

    const detail = (
      overrides: Partial<IncidentDetailResponse> = {},
    ): IncidentDetailResponse => ({
      ...incident(),
      resolution: null,
      responders: [],
      ...overrides,
    });

    /** Response work complete: Priya finished last, three minutes ago. */
    const complete = detail({
      status: "INVESTIGATING",
      responders: [
        {
          membershipId: "0199a1b2-c3d4-7000-8000-0000000000b1",
          name: "Sam Okafor",
          status: "COMPLETED",
          startedAt: "2026-09-19T10:05:00.000Z",
          completedAt: "2026-09-19T11:20:00.000Z",
        },
        {
          membershipId: "0199a1b2-c3d4-7000-8000-0000000000b2",
          name: "Priya Shah",
          status: "COMPLETED",
          startedAt: "2026-09-19T10:10:00.000Z",
          completedAt: "2026-09-19T11:57:00.000Z",
        },
      ],
    });

    /** Declared two hours ago on Risk; nobody there has started. */
    const unclaimed = detail({
      id: "0199a1b2-c3d4-7000-8000-0000000000f2",
      number: 43,
      title: "Fraud scores missing",
      severity: "SEV2",
      team: {
        id: "0199a1b2-c3d4-7000-8000-0000000000c2",
        name: "Risk",
        slug: "risk",
      },
    });

    /** The caller has been investigating for forty minutes. */
    const mine = detail({
      id: "0199a1b2-c3d4-7000-8000-0000000000f3",
      number: 44,
      title: "Settlement files late",
      severity: "SEV3",
      status: "INVESTIGATING",
      responders: [
        {
          membershipId: ME,
          name: "Ada Lovelace",
          status: "INVESTIGATING",
          startedAt: "2026-09-19T11:20:00.000Z",
          completedAt: null,
        },
      ],
    });

    it("shows the admin what is ready to resolve, and no empty work of their own", async () => {
      api(MANAGE, {
        attention: {
          manage: { readyToResolve: [complete] },
          respond: { needsYourTeam: [], yourResponses: [] },
        },
      });
      const { container } = renderOverview();

      const waiting = await screen.findByRole("region", {
        name: "Waiting on you",
      });
      const ready = within(waiting).getByRole("list", {
        name: "Ready to resolve",
      });
      const row = within(ready).getByRole("listitem");

      expect(
        within(row)
          .getByRole("link", { name: "INC-42 Card payments failing" })
          .getAttribute("href"),
      ).toBe("/orgs/acme-ops/incidents/42");
      expect(row.textContent).toMatch(/SEV1/);
      expect(row.textContent).toMatch(
        /Response work complete — ready to resolve/,
      );
      expect(row.textContent).toMatch(/Payments/);
      expect(row.textContent).toMatch(
        /2 responders finished, last Priya Shah 3m ago/,
      );
      // Nothing to act on here: the incident page resolves.
      expect(within(waiting).queryByRole("button")).toBeNull();
      // On no team, the admin is not shown two lists that never fill.
      expect(screen.queryByRole("region", { name: "Your work" })).toBeNull();

      await screen.findByRole("region", { name: "Current operations" });
      await expectNoAxeViolations(container);
    });

    it("tells the admin plainly when nothing is waiting", async () => {
      api(MANAGE, {
        attention: {
          manage: { readyToResolve: [] },
          respond: { needsYourTeam: [], yourResponses: [] },
        },
      });
      renderOverview();

      const waiting = await screen.findByRole("region", {
        name: "Waiting on you",
      });

      expect(
        within(waiting).getByText("Nothing is waiting for your action."),
      ).toBeDefined();
      expect(within(waiting).queryByRole("list")).toBeNull();
    });

    it("shows a member what their team needs and what they are working on, apart", async () => {
      api(RESPOND, {
        role: "MEMBER",
        attention: {
          manage: null,
          respond: { needsYourTeam: [unclaimed], yourResponses: [mine] },
        },
      });
      const { container } = renderOverview();

      const work = await screen.findByRole("region", { name: "Your work" });
      const needs = within(work).getByRole("list", { name: "Needs your team" });
      const yours = within(work).getByRole("list", {
        name: "Your active responses",
      });

      expect(
        within(needs).getByRole("link", { name: "INC-43 Fraud scores missing" }),
      ).toBeDefined();
      expect(needs.textContent).toMatch(/Risk needs a responder/);
      expect(needs.textContent).toMatch(
        /No one has started investigating this incident/,
      );
      expect(needs.textContent).toMatch(/Open 2h/);

      expect(
        within(yours).getByRole("link", {
          name: "INC-44 Settlement files late",
        }),
      ).toBeDefined();
      expect(yours.textContent).toMatch(/You are investigating/);
      expect(yours.textContent).toMatch(/Started 40m ago/);

      expect(within(work).queryByRole("button")).toBeNull();
      expect(
        screen.queryByRole("region", { name: "Waiting on you" }),
      ).toBeNull();

      await screen.findByRole("region", { name: "Current operations" });
      await expectNoAxeViolations(container);
    });

    it("keeps a member's empty lists to a line each", async () => {
      api(RESPOND, {
        role: "MEMBER",
        attention: {
          manage: null,
          respond: { needsYourTeam: [], yourResponses: [] },
        },
      });
      const { container } = renderOverview();

      const work = await screen.findByRole("region", { name: "Your work" });

      expect(
        within(work).getByText("No team incidents need picking up."),
      ).toBeDefined();
      expect(
        within(work).getByText("You have no active responses."),
      ).toBeDefined();
      expect(within(work).queryByRole("list")).toBeNull();

      await expectNoAxeViolations(container);
    });

    it("puts a list with work above an empty one, which is a line rather than a list", async () => {
      api(RESPOND, {
        role: "MEMBER",
        attention: {
          manage: null,
          respond: { needsYourTeam: [], yourResponses: [mine] },
        },
      });
      const { container } = renderOverview();

      const work = await screen.findByRole("region", { name: "Your work" });

      expect(
        within(work)
          .getAllByRole("heading", { level: 3 })
          .map(({ textContent }) => textContent),
      ).toEqual(["Your active responses", "Needs your team"]);
      expect(within(work).getAllByRole("list")).toHaveLength(1);
      expect(
        within(work).getByText("No team incidents need picking up."),
      ).toBeDefined();

      await expectNoAxeViolations(container);
    });

    it("shows an admin on a team both what waits on them and their own work", async () => {
      api(MANAGE, {
        attention: {
          manage: { readyToResolve: [] },
          respond: { needsYourTeam: [unclaimed], yourResponses: [] },
        },
      });
      renderOverview();

      const work = await screen.findByRole("region", { name: "Your work" });

      expect(
        screen.getByRole("region", { name: "Waiting on you" }),
      ).toBeDefined();
      expect(
        within(work).getByRole("list", { name: "Needs your team" }),
      ).toBeDefined();
      expect(
        within(work).getByText("You have no active responses."),
      ).toBeDefined();
    });

    it("reads attention from the shared cache without polling it itself", async () => {
      const { requests } = api(RESPOND, {
        role: "MEMBER",
        attention: {
          manage: null,
          respond: { needsYourTeam: [], yourResponses: [] },
        },
      });
      const { queryClient } = renderOverview();

      const work = await screen.findByRole("region", { name: "Your work" });
      const key = queryKeys.incidentAttention(organization.id);

      // The rail polls; the Overview only reads. No interval of its own.
      const observers = queryClient.getQueryCache().find({ queryKey: key })!
        .observers;

      expect(observers.length).toBeGreaterThan(0);
      expect(
        observers.map(({ options }) => options.refetchInterval ?? false),
      ).toEqual(observers.map(() => false));
      expect(
        requests.filter(
          (request) => route(request) === `GET ${base}/incidents/attention`,
        ),
      ).toHaveLength(1);

      // What the rail's next poll puts in the cache, the Overview shows.
      act(() =>
        queryClient.setQueryData(key, {
          manage: null,
          respond: { needsYourTeam: [unclaimed], yourResponses: [] },
        }),
      );

      expect(
        await within(work).findByRole("list", { name: "Needs your team" }),
      ).toBeDefined();
    });

    it("keeps the rest of the overview when attention cannot be read", async () => {
      api(MANAGE, { attention: () => apiError(500) });
      renderOverview();

      // A 5xx is retried once, a second later, before it is shown.
      expect(
        await screen.findByRole("alert", {}, { timeout: 4000 }),
      ).toBeDefined();
      expect(
        await screen.findByRole("region", { name: "Current operations" }),
      ).toBeDefined();
      expect(
        screen.queryByRole("region", { name: "Waiting on you" }),
      ).toBeNull();
    });
  });
});
