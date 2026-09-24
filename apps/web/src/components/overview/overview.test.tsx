import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OrganizationLanding } from "@/components/organizations/organization-landing";
import { OrganizationScope } from "@/components/organizations/organization-scope";
import { OverviewSummary } from "@/components/overview/overview-summary";
import type { CurrentOperationsState } from "@/components/overview/use-current-operations";
import type {
  ActivityIncidentResponse,
  IncidentAttentionResponse,
  IncidentDetailResponse,
  IncidentOccurrenceResponse,
  IncidentResponse,
  IncidentSeverity,
  IncidentSummaryResponse,
  OperationalActivityDayResponse,
  OperationalActivityResponse,
  ServiceOccurrenceResponse,
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

/** An overseer: `incidents:read-all` is what the Overview is offered on. */
const READ = [
  "incidents:read",
  "incidents:read-all",
  "memberships:read",
  "organization:read",
  "services:read",
  "teams:read",
];

/** A member: every read the Overview needs, except oversight. */
const MEMBER_READ = READ.filter(
  (permission) => permission !== "incidents:read-all",
);

/** The requests only the organization-wide Overview makes. */
const OVERSIGHT_REQUESTS = [
  "/incidents/summary",
  "/incidents/occurrence",
  "/incidents/activity",
  "/incidents?state=active",
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
    // Two people investigating, on two teams: enough to tell a count of
    // members from a count of responses.
    responders: { active: 2, teams: 2 },
    activeByStatus: { DECLARED: 1, INVESTIGATING: 2 },
    // A SEV1 has typically taken six hours; nothing else has enough
    // resolutions to say.
    typicalResolution: {
      from: "2026-06-22",
      to: "2026-09-19",
      minimumSample: 5,
      bySeverity: {
        SEV1: { resolved: 7, medianMs: 6 * 3_600_000 },
        SEV2: { resolved: 2, medianMs: null },
        SEV3: { resolved: 0, medianMs: null },
        SEV4: { resolved: 0, medianMs: null },
      },
    },
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
  current: {
    active: 0,
    activeBySeverity: none,
    affectedServices: [],
    responders: { active: 0, teams: 0 },
    activeByStatus: { DECLARED: 0, INVESTIGATING: 0 },
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
  },
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
const OCCURRENCE = `GET ${base}/incidents/occurrence`;

const DAY_MS = 86_400_000;

/** The thirty whole UTC days ending on the 19th: the Overview's last thirty. */
const LAST_30 = { from: "2026-08-21", to: "2026-09-19" };

/**
 * An occurrence over the last thirty days, shaped like a real sparse month:
 * most days quiet, a few with one to three incidents. `declared` names the
 * busy days; every other tracked day is quiet. The 19th — today, read at
 * noon — is not over. `rolling` gives the API's averages; a day it leaves
 * out has none. Days before `trackedFrom` have no history.
 */
/** One service as the occurrence ranking names it. */
const ranked = (
  name: string,
  declared: number,
  share: number,
  overrides: Partial<ServiceOccurrenceResponse> = {},
): ServiceOccurrenceResponse => ({
  id: `svc-${name.toLowerCase().replace(/\W+/g, "-")}`,
  name,
  slug: name.toLowerCase().replace(/\W+/g, "-"),
  criticality: "HIGH",
  archivedAt: null,
  declared,
  share,
  ...overrides,
});

/**
 * Where the default fixture's eight incidents were declared: two tied at
 * one, in the API's order, and one of them against a service since
 * archived. The names are deliberately out of alphabetical order where the
 * API tied them, so a client that re-sorted would be caught.
 */
const RANKED: IncidentOccurrenceResponse["services"] = {
  top: [
    ranked("Payment API", 4, 0.5),
    ranked("Authentication", 2, 0.25),
    ranked("Search", 1, 0.125),
    ranked("Fraud Detection", 1, 0.125, {
      archivedAt: "2026-09-01T09:00:00.000Z",
    }),
  ],
  others: { services: 0, declared: 0 },
};

const occurrenceOver = ({
  declared = {
    "2026-08-24": 1,
    "2026-09-03": 2,
    "2026-09-10": 1,
    "2026-09-17": 3,
    "2026-09-19": 1,
  },
  rolling = {
    "2026-08-21": 0.14,
    "2026-09-03": 0.43,
    "2026-09-17": 0.57,
    "2026-09-18": 0.57,
  },
  trackedFrom = "2026-03-24",
  previous = {
    from: "2026-07-22",
    to: "2026-08-20",
    declared: 6,
    comparable: true,
    minimumSample: 5,
    changePercent: 33,
  },
  incidentFreeDays,
  services,
}: {
  declared?: Record<string, number>;
  rolling?: Record<string, number>;
  trackedFrom?: string | null;
  previous?: IncidentOccurrenceResponse["previous"];
  incidentFreeDays?: number;
  services?: IncidentOccurrenceResponse["services"];
} = {}): IncidentOccurrenceResponse => {
  const days = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(
      Date.parse(`${LAST_30.from}T00:00:00.000Z`) + index * DAY_MS,
    )
      .toISOString()
      .slice(0, 10);
    const tracked = trackedFrom !== null && date >= trackedFrom;

    return {
      date,
      declared: declared[date] ?? 0,
      complete: date !== LAST_30.to,
      tracked,
      rollingAverage: rolling[date] ?? null,
    };
  });
  const counted = days.filter((day) => day.complete && day.tracked);
  const total = days.reduce((sum, day) => sum + day.declared, 0);

  return {
    ...LAST_30,
    asOf: "2026-09-19T12:00:00.000Z",
    trackedFrom,
    declared: total,
    incidentFreeDays:
      incidentFreeDays ?? counted.filter((day) => day.declared === 0).length,
    completeDays: counted.length,
    days,
    previous,
    // Nothing declared, nothing ranked: the API's own rule.
    services:
      services ??
      (total > 0 ? RANKED : { top: [], others: { services: 0, declared: 0 } }),
  };
};

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
    occurrence = occurrenceOver(),
    role = "ADMIN",
  }: {
    summary?:
      | ((from: string, to: string) => IncidentSummaryResponse)
      | (() => Response);
    active?: IncidentResponse[] | (() => Response);
    attention?: IncidentAttentionResponse | (() => Response);
    activity?: OperationalActivityResponse | (() => Response);
    occurrence?: IncidentOccurrenceResponse | (() => Response | Promise<Response>);
    role?: string;
  } = {},
) =>
  mockApi((request) => {
    if (route(request).startsWith(`${OCCURRENCE}?`)) {
      return typeof occurrence === "function"
        ? occurrence()
        : jsonResponse(200, occurrence);
    }

    if (route(request).startsWith(`${SUMMARY}?`)) {
      const [from, to] = periodOf(request).split("..");
      const answer = summary(from, to);

      return answer instanceof Response ? answer : jsonResponse(200, answer);
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
        return typeof active === "function"
          ? active()
          : jsonResponse(200, {
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
      <OrganizationLanding />
    </OrganizationScope>,
  );

/**
 * Which workspace `/orgs/[orgSlug]` resolves to, and — for a member — that
 * resolving it begins none of the organization-wide requests. Not "they are
 * abandoned quickly": the assertion is that they were never sent, because the
 * sections that would send them are never mounted.
 */
describe("the organization landing", () => {
  beforeEach(() => {
    clearAccessToken();
    vi.useFakeTimers({
      toFake: ["Date"],
      now: new Date("2026-09-19T12:00:00.000Z"),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives an overseer the organization's Overview", async () => {
    api(READ);
    renderOverview();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Overview" }),
    ).toBeDefined();
    expect(screen.queryByText("My Operations")).toBeNull();
  });

  it("gives a member My Operations, and asks the organization for nothing", async () => {
    const { requests } = api(MEMBER_READ, { role: "MEMBER" });
    renderOverview();

    expect(
      await screen.findByRole("heading", { level: 1, name: "My Operations" }),
    ).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Overview" })).toBeNull();

    // Never sent — not sent and refused, not sent and cancelled.
    const asked = requests.map((request) => request.path);

    for (const oversight of OVERSIGHT_REQUESTS) {
      expect(asked.some((path) => path.includes(oversight))).toBe(false);
    }

    // The only thing asked of the organization is who is asking.
    expect(asked.filter((path) => path.startsWith(base))).toEqual([base]);
  });

  it("offers a member the way to the incidents that are theirs", async () => {
    api(MEMBER_READ, { role: "MEMBER" });
    renderOverview();

    const onward = await screen.findByRole("link", { name: /Go to Incidents/ });

    expect(onward.getAttribute("href")).toBe("/orgs/acme-ops/incidents");
  });

  it("borrows none of the Overview's panels to look populated", async () => {
    api(MEMBER_READ, { role: "MEMBER" });
    renderOverview();

    await screen.findByRole("heading", { level: 1, name: "My Operations" });

    for (const panel of [
      "Current operations",
      "Recent operational health",
      "Operational activity",
    ]) {
      expect(screen.queryByRole("region", { name: panel })).toBeNull();
    }
  });
});

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

  it("shows where response stands now", async () => {
    const { requests } = api(READ);
    renderOverview();

    const current = await screen.findByRole("region", {
      name: "Current operations",
    });

    // The panel says what it covers.
    expect(within(current).getByText("Now")).toBeDefined();

    // The split by severity leads the panel, and is all of the posture: how
    // many are active is the summary row's figure, and the most severe
    // level is the first count that is not nought.
    const bySeverity = await within(current).findByLabelText(
      "Active incidents by severity",
    );
    expect(bySeverity.textContent).toMatch(/SEV1\s*Critical\s*1/);
    expect(bySeverity.textContent).toMatch(/SEV3\s*Moderate\s*2/);
    expect(within(current).queryByText(/Most severe/)).toBeNull();
    expect(within(current).queryByText("active incidents")).toBeNull();

    const rows = await within(current).findByRole("list", {
      name: "Active incidents",
    });
    const top = within(rows).getByRole("link", {
      name: /INC-42\s+Card payments failing/,
    });
    expect(top.getAttribute("href")).toBe("/orgs/acme-ops/incidents/42");
    expect(
      within(current).getByRole("link", { name: /View all 3 active incidents/ }).getAttribute("href"),
    ).toBe("/orgs/acme-ops/incidents");

    // Compact counts, not a bar: every level is there, a level with none
    // quietened, and nothing drawn in proportion.
    for (const level of ["SEV1", "SEV2", "SEV3", "SEV4"]) {
      expect(bySeverity.textContent).toContain(level);
    }
    expect(bySeverity.textContent).toMatch(/SEV2\s*Major\s*0/);
    // The counts strip — by status and by severity — draws nothing in
    // proportion; the only bars in the panel are each row's duration.
    const strip = bySeverity.parentElement!.parentElement!;
    expect(strip.querySelector("[style*='width']")).toBeNull();

    // By status: each active status in its lifecycle pill, from the
    // summary's aggregate — one declared, two investigating, though only one
    // row is listed.
    const byStatus = within(current).getByLabelText("Active incidents by status");
    expect(byStatus.textContent).toBe("Declared1Investigating2");
    expect(
      within(byStatus).getByText("Declared").className,
    ).toContain("bg-status-declared-subtle");

    // One view: no second list of services to correlate the rows against.
    expect(
      within(current).queryByRole("list", { name: "Affected services" }),
    ).toBeNull();
    expect(within(current).queryByRole("table")).toBeNull();

    // The panel offers no standing way out: the list's own link is the
    // only one, and the record of what came before is reached from a day.
    expect(
      within(current).queryByRole("link", { name: /Incident history/ }),
    ).toBeNull();

    // One request, for the thirty days the resolved figure counts. The
    // state now does not depend on the period, so both halves of that one
    // answer are read rather than a second summary being asked for. Never
    // a period a person chose: the Overview offers no way to choose one.
    expect(summaries(requests)).toEqual(["2026-08-21..2026-09-19"]);
  });

  describe("incidents and the services they affect", () => {
    const TEAMS = {
      payments: {
        id: "0199a1b2-c3d4-7000-8000-0000000000c1",
        name: "Payments",
        slug: "payments",
      },
      risk: {
        id: "0199a1b2-c3d4-7000-8000-0000000000c2",
        name: "Risk",
        slug: "risk",
      },
      platform: {
        id: "0199a1b2-c3d4-7000-8000-0000000000c3",
        name: "Platform",
        slug: "platform",
      },
    };
    const SERVICES = {
      payments: {
        id: "0199a1b2-c3d4-7000-8000-0000000000e1",
        name: "Payment API",
        slug: "payment-api",
        criticality: "CRITICAL" as const,
        archivedAt: null,
      },
      fraud: {
        id: "0199a1b2-c3d4-7000-8000-0000000000e2",
        name: "Fraud Detection",
        slug: "fraud-detection",
        criticality: "HIGH" as const,
        archivedAt: null,
      },
      auth: {
        id: "0199a1b2-c3d4-7000-8000-0000000000e3",
        name: "Authentication",
        slug: "authentication",
        criticality: "NORMAL" as const,
        archivedAt: null,
      },
      search: {
        id: "0199a1b2-c3d4-7000-8000-0000000000e4",
        name: "Search",
        slug: "search",
        criticality: "LOW" as const,
        archivedAt: null,
      },
    };

    const on = (
      number: number,
      title: string,
      severity: IncidentSeverity,
      status: "DECLARED" | "INVESTIGATING",
      service: keyof typeof SERVICES,
      team: keyof typeof TEAMS,
      createdAt: string,
    ) =>
      incident({
        id: `0199a1b2-c3d4-7000-8000-0000000001${number}`,
        number,
        title,
        severity,
        status,
        service: SERVICES[service],
        team: TEAMS[team],
        createdAt,
      });

    /**
     * Six active incidents across four services, in the list's own order —
     * most severe, then longest-running. Two share the Payment API and two
     * Authentication; the sixth, on Search, is beyond the five shown.
     */
    const ACTIVE = [
      on(74, "Elevated card declines from one acquirer", "SEV2", "INVESTIGATING", "payments", "payments", "2026-09-18T11:00:00.000Z"),
      on(73, "Webhook retries backing up", "SEV3", "INVESTIGATING", "payments", "payments", "2026-09-18T03:40:00.000Z"),
      on(75, "Transaction monitoring alerts delayed", "SEV3", "DECLARED", "fraud", "risk", "2026-09-18T16:40:00.000Z"),
      on(72, "Intermittent slow sign-in", "SEV4", "INVESTIGATING", "auth", "platform", "2026-09-17T05:00:00.000Z"),
      on(76, "Stale password reset emails", "SEV4", "DECLARED", "auth", "platform", "2026-09-19T11:15:00.000Z"),
      on(77, "Search results lag", "SEV4", "DECLARED", "search", "platform", "2026-09-19T11:50:00.000Z"),
    ];

    const affectedService = (
      service: keyof typeof SERVICES,
      team: keyof typeof TEAMS,
      activeIncidents: number,
      worstSeverity: IncidentSeverity,
    ) => ({
      ...SERVICES[service],
      ownerTeam: TEAMS[team],
      activeIncidents,
      worstSeverity,
    });

    const spread = (from: string, to: string): IncidentSummaryResponse => ({
      ...quiet(from, to),
      current: {
        active: 6,
        activeBySeverity: { SEV1: 0, SEV2: 1, SEV3: 2, SEV4: 3 },
        affectedServices: [
          affectedService("payments", "payments", 2, "SEV2"),
          affectedService("fraud", "risk", 1, "SEV3"),
          affectedService("auth", "platform", 2, "SEV4"),
          affectedService("search", "platform", 1, "SEV4"),
        ],
        responders: { active: 3, teams: 2 },
        activeByStatus: { DECLARED: 3, INVESTIGATING: 3 },
        typicalResolution: {
          from: "2026-06-22",
          to: "2026-09-19",
          minimumSample: 5,
          bySeverity: {
            SEV1: { resolved: 0, medianMs: null },
            // INC-74, open 1d 1h, is past a typical 12h.
            SEV2: { resolved: 9, medianMs: 12 * 3_600_000 },
            // Too few SEV3s to say what is typical: no bar at all.
            SEV3: { resolved: 3, medianMs: null },
            // INC-72 is past a typical day; INC-76, at 45m, is not.
            SEV4: { resolved: 11, medianMs: 24 * 3_600_000 },
          },
        },
      },
    });

    /** The rows, once they have arrived. */
    const rows = async () => {
      const current = await screen.findByRole("region", {
        name: "Current operations",
      });
      const list = await within(current).findByRole("list", {
        name: "Active incidents",
      });

      return within(list).getAllByRole("listitem");
    };

    /** A row's incident link: the first link in it, and the one it stretches. */
    const incidentOf = (row: HTMLElement) =>
      within(row).getAllByRole("link")[0];

    it("puts each incident beside the service it affects", async () => {
      api(READ, { summary: spread, active: ACTIVE });
      renderOverview();

      const listed = await rows();

      expect(
        listed.map((row) => {
          const [incidentLink, serviceLink] = within(row).getAllByRole("link");

          return [
            incidentLink.getAttribute("href"),
            serviceLink.textContent,
            serviceLink.getAttribute("href"),
          ];
        }),
      ).toEqual([
        ["/orgs/acme-ops/incidents/74", "Payment API", "/orgs/acme-ops/services/payment-api"],
        ["/orgs/acme-ops/incidents/73", "Payment API", "/orgs/acme-ops/services/payment-api"],
        ["/orgs/acme-ops/incidents/75", "Fraud Detection", "/orgs/acme-ops/services/fraud-detection"],
        ["/orgs/acme-ops/incidents/72", "Authentication", "/orgs/acme-ops/services/authentication"],
        ["/orgs/acme-ops/incidents/76", "Authentication", "/orgs/acme-ops/services/authentication"],
      ]);
    });

    it("keeps incidents on one service as rows of their own", async () => {
      api(READ, { summary: spread, active: ACTIVE });
      renderOverview();

      const listed = await rows();
      const onPayments = listed.filter((row) =>
        within(row).queryByRole("link", { name: "Payment API" }),
      );

      // Two incidents, two rows — not one service row holding both.
      expect(onPayments).toHaveLength(2);
      for (const row of onPayments) {
        expect(row.textContent).toContain("2 active incidents");
      }

      // Every service cell is two lines, the count included — one active
      // incident is still something worth knowing about a service.
      const fraud = listed[2];
      expect(fraud.textContent).toContain("Fraud Detection");
      expect(fraud.textContent).toContain("1 active incident");
      expect(fraud.textContent).not.toContain("1 active incidents");
    });

    it("reads severity, status, duration and service off each row", async () => {
      api(READ, { summary: spread, active: ACTIVE });
      renderOverview();

      const [declines, , monitoring, signIn, resets] = await rows();

      expect(incidentOf(declines).textContent).toMatch(
        /INC-74\s*Elevated card declines from one acquirer/,
      );
      expect(declines.textContent).toMatch(/SEV2\s*Major/);
      expect(declines.textContent).toContain("Investigating");
      expect(declines.textContent).toContain("Open 1d 1h");
      expect(declines.textContent).toContain("Team Payments");
      expect(declines.textContent).toMatch(/Affects\s*Payment API/);

      expect(monitoring.textContent).toMatch(/SEV3\s*Moderate/);
      expect(monitoring.textContent).toContain("Declared");
      expect(monitoring.textContent).toContain("Open 19h 20m");
      expect(monitoring.textContent).toContain("Team Risk");
      expect(monitoring.textContent).toContain("Fraud Detection");

      expect(signIn.textContent).toMatch(/SEV4\s*Minor/);
      expect(signIn.textContent).toContain("Open 2d 7h");
      expect(signIn.textContent).toContain("Authentication");

      expect(resets.textContent).toContain("Open 45m");

      // Criticality is a standing classification, not what is happening
      // now: no row draws it, in any form.
      for (const row of [declines, monitoring, signIn, resets]) {
        expect(row.textContent).not.toMatch(/\b(?:Critical|High|Normal|Low)\b/);
      }
    });

    /** A row's duration bar — the track and its fill — if it has one. */
    const barOf = (row: HTMLElement) => {
      const fill = row.querySelector<HTMLElement>("[style*='width']");

      return fill
        ? { fill, track: fill.parentElement as HTMLElement }
        : undefined;
    };

    it("reads each duration against its severity's typical time to resolve", async () => {
      api(READ, { summary: spread, active: ACTIVE });
      renderOverview();

      const [declines, retries, monitoring, signIn, resets] = await rows();

      // INC-74: a SEV2, open 1d 1h, where a SEV2 has typically taken 12h.
      // Full, and said to be past it — never more than full.
      const past = barOf(declines)!;
      expect(past.fill.style.width).toBe("100%");
      expect(within(declines).getByText("Past typical")).toBeDefined();
      expect(declines.textContent).toContain("past a typical 12h for a SEV2");

      // INC-76: a SEV4 open 45m, of a typical day — a thirty-second of it.
      const early = barOf(resets)!;
      expect(early.fill.style.width).toBe("3.125%");
      expect(within(resets).queryByText("Past typical")).toBeNull();
      expect(resets.textContent).toContain("of a typical 1d for a SEV4");

      // INC-72, a SEV4 open 2d 7h: past its typical day too.
      expect(barOf(signIn)!.fill.style.width).toBe("100%");

      // SEV3s have too few resolutions to call anything typical: no bar, and
      // nothing said about a typical time, rather than a bar against a guess.
      for (const row of [retries, monitoring]) {
        expect(barOf(row)).toBeUndefined();
        expect(row.textContent).not.toMatch(/typical/i);
      }
    });

    it("fills the bar neutrally, whatever the incident's status", async () => {
      api(READ, { summary: spread, active: ACTIVE });
      renderOverview();

      const [declines, , , , resets] = await rows();

      // Investigating and declared alike: the bar is about time, not where
      // the response stands nor how bad the incident is.
      for (const row of [declines, resets]) {
        const { className } = barOf(row)!.fill;

        expect(className).toContain("bg-fg-subtle");
        expect(className).not.toMatch(/status-|signal-/);
      }
    });

    it("draws the bar as decoration, and says the comparison in words", async () => {
      api(READ, { summary: spread, active: ACTIVE });
      renderOverview();

      const [declines] = await rows();
      const { track } = barOf(declines)!;

      expect(track.getAttribute("aria-hidden")).toBe("true");
      expect(track.getAttribute("title")).toBe("Typical for a SEV2: 12h");
      // The words a screen reader hears sit outside anything hidden.
      const spoken = within(declines).getByText(/past a typical 12h/);
      expect(spoken.closest("[aria-hidden='true']")).toBeNull();
    });

    it("counts every active incident by status, not only the rows shown", async () => {
      api(READ, { summary: spread, active: ACTIVE });
      renderOverview();

      await rows();

      const byStatus = screen.getByLabelText("Active incidents by status");

      // Six active, five listed: the counts are the summary's own.
      expect(byStatus.textContent).toBe("Declared3Investigating3");
      // Lifecycle as a pill, severity as a glyph — the two never trade looks.
      expect(byStatus.querySelectorAll(".rounded-full")).toHaveLength(2);
      expect(
        screen
          .getByLabelText("Active incidents by severity")
          .querySelector(".rounded-full"),
      ).toBeNull();
    });

    it("names the affected services that have no row", async () => {
      api(READ, { summary: spread, active: ACTIVE });
      renderOverview();

      await rows();

      const elsewhere = screen.getByRole("list", { name: "Also affected" });
      const search = within(elsewhere).getByRole("link", { name: "Search" });

      expect(search.getAttribute("href")).toBe("/orgs/acme-ops/services/search");
      expect(elsewhere.textContent).toContain("1 active incident");
      // Services already on a row are not named twice.
      expect(elsewhere.textContent).not.toMatch(/Payment API|Authentication/);
      expect(
        screen.getByRole("link", { name: /View all 6 active incidents/ }),
      ).toBeDefined();
    });

    it("names nothing beneath when every affected service has a row", async () => {
      api(READ);
      renderOverview();

      await rows();

      expect(screen.queryByRole("list", { name: "Also affected" })).toBeNull();
    });

    it("names the service without linking it for a role that cannot read services", async () => {
      api(READ.filter((permission) => permission !== "services:read"), {
        summary: spread,
        active: ACTIVE,
      });
      renderOverview();

      const [declines] = await rows();

      // The incident is still the row's link; the service is only its name.
      expect(within(declines).getAllByRole("link")).toHaveLength(1);
      expect(declines.textContent).toContain("Payment API");
      expect(
        screen.queryByRole("link", { name: "Payment API" }),
      ).toBeNull();
      expect(
        within(screen.getByRole("list", { name: "Also affected" })).queryByRole(
          "link",
        ),
      ).toBeNull();
    });

    it("draws each incident once, whatever the width", async () => {
      api(READ, { summary: spread, active: ACTIVE });
      const { container } = renderOverview();

      const listed = await rows();

      // One tree for every width: the stacked rows and the columns are the
      // same elements, so nothing is read, or tabbed to, twice.
      expect(screen.getAllByRole("link", { name: /INC-74/ })).toHaveLength(1);
      for (const row of listed) {
        expect(within(row).getAllByText("Affects")).toHaveLength(1);
        expect(within(row).getAllByText("Open", { exact: false })).toHaveLength(1);
      }

      // The column header is drawn only where there are columns, and is
      // not read out: each row says the same in its own words.
      const header = container.querySelector('[aria-hidden="true"].xl\\:grid');

      expect(header?.textContent).toBe(
        "SeverityIncidentStatusDurationAffected service",
      );
      expect(header?.className).toMatch(/(^|\s)hidden(\s|$)/);

      // Only the incident's link draws the row's focus; the service's link
      // is its own stop, above the stretched one.
      const [incidentLink, serviceLink] = within(listed[0]).getAllByRole("link");

      expect(incidentLink.hasAttribute("data-row-link")).toBe(true);
      expect(serviceLink.hasAttribute("data-row-link")).toBe(false);
      expect(serviceLink.className).toMatch(/relative z-10/);
    });

    it("draws the critical edge on a SEV1 row only", async () => {
      api(READ, { active: [incident(), { ...ACTIVE[0] }] });
      renderOverview();

      const [sev1, sev2] = await rows();

      expect(sev1.className).toMatch(/before:bg-signal-critical/);
      expect(sev2.className).not.toMatch(/signal-critical/);
    });

    it("keeps the split by severity when the rows cannot be read", async () => {
      api(READ, { active: () => apiError(500) });
      renderOverview();

      const current = await screen.findByRole("region", {
        name: "Current operations",
      });

      expect(
        await within(current).findByRole("alert", {}, { timeout: 4000 }),
      ).toBeDefined();
      expect(
        within(current).getByLabelText("Active incidents by severity"),
      ).toBeDefined();
      expect(
        within(current).queryByRole("list", { name: "Active incidents" }),
      ).toBeNull();
    });

    it("says it is loading the rows while the split is already shown", async () => {
      // The list's answer never comes; the summary's does.
      api(READ, { active: () => new Promise<Response>(() => {}) as never });
      renderOverview();

      const current = await screen.findByRole("region", {
        name: "Current operations",
      });

      await within(current).findByLabelText("Active incidents by severity");
      // A status region, by its words: the role takes no name from them.
      expect(
        within(current)
          .getByText("Loading active incidents…")
          .closest('[role="status"]'),
      ).not.toBeNull();
    });

    it("has no accessibility violations", async () => {
      api(READ, { summary: spread, active: ACTIVE });
      const { container } = renderOverview();

      await rows();
      await expectNoAxeViolations(container);
    }, 30_000);
  });

  describe("the summary", () => {
    /** One card's number and the line beneath it. */
    const figure = async (label: string) => {
      const row = await screen.findByLabelText("Operational summary");
      const term = within(row).getByText(label);
      const card = term.closest("div");

      if (!card) throw new Error(`No card around ${label}`);

      return card.textContent ?? "";
    };

    it("states the organization's position in four figures", async () => {
      api(READ);
      renderOverview();

      // The term first, as a definition list requires; the number is
      // drawn above it, not read before it.
      // Three active, the severities that are actually present, in words —
      // separated by their glyphs, with no dot to strand at a line's start.
      expect(await figure("Active incidents")).toMatch(
        /^Active incidents3\s*1 critical\s*2 moderate/,
      );
      // One affected service, and it is a critical one.
      expect(await figure("Services impacted")).toMatch(
        /^Services impacted11 critical service/,
      );
      // Two members investigating, across two teams.
      expect(await figure("Responders active")).toMatch(
        /^Responders active2Across 2 teams/,
      );
      // The period's resolved count, said as the period it covers — never
      // as a change against a period nothing asked for.
      expect(await figure("Resolved incidents")).toMatch(
        /^Resolved incidents9Last 30 days/,
      );
      // The comparison with a previous period is Incident trend's, below.
      expect(
        within(screen.getByLabelText("Operational summary")).queryByText(
          /vs previous|% /,
          { exact: false },
        ),
      ).toBeNull();
      expect(
        screen.getByLabelText("Operational summary").textContent,
      ).not.toContain("·");
    });

    /** Each card's family: the vocabulary of what it counts. */
    const families = async () => {
      const row = await screen.findByLabelText("Operational summary");

      return Object.fromEntries(
        [...row.querySelectorAll("[data-family]")].map((card) => [
          card.querySelector("dt")?.textContent,
          card.getAttribute("data-family"),
        ]),
      );
    };

    it("draws each card in the vocabulary of what it counts", async () => {
      api(READ);
      renderOverview();

      // A SEV1 is active, so the incidents card is the critical signal's;
      // services are the service blue; responders are the lifecycle's
      // investigating blue, and resolved its teal.
      expect(await families()).toEqual({
        "Active incidents": "critical",
        "Services impacted": "service",
        "Responders active": "investigating",
        "Resolved incidents": "resolved",
      });

      const row = screen.getByLabelText("Operational summary");
      const card = row.querySelector('[data-family="critical"]');

      expect(card?.className).toContain(
        "[--family:var(--color-signal-critical)]",
      );
      // Only the incidents card carries its family in its frame; the rest
      // are neutral cards, their colour in the icon's tile alone.
      expect(card?.getAttribute("data-trace")).toBe("true");
      expect(card?.className).toMatch(/(?:^|\s)tint-family(?:\s|$)/);
      const traced = row.querySelectorAll("[data-trace]");
      expect(traced).toHaveLength(1);
      for (const other of row.querySelectorAll("[data-family]:not([data-trace])")) {
        expect(other.className).not.toMatch(/(?:^|\s)tint-family(?:\s|$)/);
        expect(other.className).toContain("border-line-subtle");
      }
    });

    it("takes the incidents card's colour from the worst severity active", async () => {
      api(READ, {
        summary: (from, to) => {
          const answer = busy(from, to);

          return {
            ...answer,
            current: {
              ...answer.current,
              activeBySeverity: { SEV1: 0, SEV2: 1, SEV3: 2, SEV4: 0 },
            },
          };
        },
      });
      renderOverview();

      // No SEV1, so not red: the card says what is actually worst.
      expect((await families())["Active incidents"]).toBe("high");
    });

    it("gives a nought no colour, and nothing active the all-clear", async () => {
      api(READ, { summary: quiet, active: [] });
      renderOverview();

      expect(await families()).toEqual({
        "Active incidents": "nominal",
        "Services impacted": "neutral",
        "Responders active": "neutral",
        "Resolved incidents": "neutral",
      });
      // All clear is said by the icon alone: no card carries a trace.
      expect(
        screen.getByLabelText("Operational summary").querySelectorAll("[data-trace]"),
      ).toHaveLength(0);
    });

    it("marks each card's icon as decoration", async () => {
      api(READ);
      renderOverview();

      const row = await screen.findByLabelText("Operational summary");

      for (const tile of row.querySelectorAll(".tint-family-tile")) {
        expect(tile.getAttribute("aria-hidden")).toBe("true");
      }
      expect(row.querySelectorAll(".tint-family-tile")).toHaveLength(4);
    });

    it("says what each figure counts, for a screen reader", async () => {
      api(READ);
      renderOverview();

      const row = await screen.findByLabelText("Operational summary");

      expect(row.textContent).toContain(
        "Members whose own response is still under way, each counted once however many incidents they are on.",
      );
    });

    it("speaks plainly when nothing is happening", async () => {
      api(READ, { summary: quiet, active: [] });
      renderOverview();

      expect(await figure("Active incidents")).toMatch(
        /^Active incidents0Nothing needs a response/,
      );
      expect(await figure("Services impacted")).toMatch(
        /^Services impacted0No critical service affected/,
      );
      expect(await figure("Responders active")).toMatch(
        /^Responders active0No response under way/,
      );
    });

    /** The query as the row reads it: what it has, and whether it failed. */
    const asState = (
      data?: IncidentSummaryResponse["current"] & { resolved: number },
      isError = false,
    ) => ({ data, isError }) as CurrentOperationsState;

    it("draws the frames, and no figures, until the summary arrives", () => {
      const { container } = render(
        <OverviewSummary state={asState(undefined)} />,
      );
      const busyRow = container.querySelector('[aria-busy="true"]');

      // The labels hold the row's height, and nothing stands in for a
      // count: a dash where a figure goes reads as a figure.
      expect(busyRow).not.toBeNull();
      expect(busyRow?.textContent).toContain("Responders active");
      expect(busyRow?.textContent).not.toMatch(/\d/);
      expect(screen.queryByLabelText("Operational summary")).toBeNull();
    });

    it("draws nothing at all when the summary cannot be read", () => {
      const { container } = render(
        <OverviewSummary state={asState(undefined, true)} />,
      );

      expect(container.firstChild).toBeNull();
    });

    it("leaves the one failure to the section that owns the request", async () => {
      api(READ, { summary: () => apiError(500) });
      renderOverview();

      const current = await screen.findByRole("region", {
        name: "Current operations",
      });

      // One request failed, so one thing says so — beneath, where the
      // detail is, and not twice over.
      await within(current).findByRole("alert", {}, { timeout: 4000 });
      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(screen.queryByLabelText("Operational summary")).toBeNull();
    });
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
    expect(
      within(current).queryByRole("list", { name: "Active incidents" }),
    ).toBeNull();
    expect(
      within(current).queryByLabelText("Active incidents by severity"),
    ).toBeNull();
  });

  // A grant that oversees the organization but may not read its incidents.
  // No role holds it today; the Overview keeps the branch so that one which
  // did would find a page that says why it is empty rather than being so.
  it("asks nothing about incidents without incidents:read", async () => {
    const { requests } = api(["organization:read", "incidents:read-all"]);
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
      const calendarPane = grid.closest("[data-pane]");
      const detail = within(activity)
        .getByLabelText("What happened on this day")
        .closest("[data-pane]");

      // Two surfaces, neither inside the other, sharing one fixed height.
      expect(calendarPane).not.toBeNull();
      expect(detail).not.toBeNull();
      expect(calendarPane?.contains(detail!)).toBe(false);
      expect(calendarPane?.className).toMatch(/lg:h-\[19rem\]/);
      expect(detail?.className).toMatch(/lg:h-\[19rem\]/);
      // The same ink as the calendar; what the day says on navy insets
      // within it, with no rule between them.
      expect(detail?.className).toContain("bg-ink");
      const insets = detail!.querySelectorAll(".bg-ink-inset");
      expect(insets.length).toBeGreaterThanOrEqual(2);
      expect(detail!.innerHTML).not.toMatch(/border-b|divide-y/);

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

      expect(
        within(current).getByLabelText("Active incidents by severity"),
      ).toBeDefined();
      await within(current).findByRole("list", { name: "Active incidents" });
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

  describe("recent operational health", () => {
    const occurrences = (requests: SentRequest[]) =>
      requests
        .filter((request) => route(request).startsWith(`${OCCURRENCE}?`))
        .map(periodOf);

    const section = () =>
      screen.findByRole("region", { name: "Recent operational health" });

    /** The chart's days, once it is drawn. */
    const chartDays = async () =>
      within(await section()).findByRole("list", {
        name: "Incidents declared per day",
      });

    const dayColumn = (days: HTMLElement, date: string) =>
      days.querySelector<HTMLLIElement>(`[data-date="${date}"]`)!;

    it("sits between the state now and the year, labelled with the time it covers", async () => {
      const { requests } = api(READ);
      const { container } = renderOverview();

      const recent = await section();

      expect(within(recent).getByText("Last 30 days")).toBeDefined();
      expect(
        within(recent).getByText(
          "How often incidents were declared, and where they concentrated. Days are UTC.",
        ),
      ).toBeDefined();
      expect(
        [...container.querySelectorAll("section[id]")].map(({ id }) => id),
      ).toEqual([
        "current-operations",
        "recent-operational-health",
        "operational-activity",
      ]);

      // Its own request, for the same thirty days the summary counts —
      // one "last 30 days" on the page — and asked for once.
      await chartDays();
      expect(occurrences(requests)).toEqual(["2026-08-21..2026-09-19"]);
      expect(summaries(requests)).toEqual(["2026-08-21..2026-09-19"]);
    });

    it("gives the chart's two figures, in the API's own terms", async () => {
      api(READ);
      renderOverview();

      const recent = await section();
      const figures = await within(recent).findByText("Incidents declared");
      const list = figures.closest("dl")!;

      expect(list.textContent).toContain("Incidents declared8");
      // Shown short beside its glyph; read whole.
      const shown = within(list).getByText("33% vs previous 30 days");
      expect(shown.getAttribute("aria-hidden")).toBe("true");
      expect(shown.previousElementSibling?.textContent).toBe("↑");
      expect(
        within(list).getByText("33% more than the previous 30 days").className,
      ).toContain("sr-only");
      // Incident-free days, of the complete days the API counted them over.
      expect(list.textContent).toContain(
        "Incident-free days25 of 29 complete days",
      );
      // Two badges in the view's header, on its name's line and off the
      // chart's ink panel; the key is the panel's caption, beneath it.
      const header = within(recent)
        .getByRole("heading", { name: "Incident trend" })
        .closest<HTMLElement>("[data-view-header]")!;
      expect(header.contains(list)).toBe(true);
      expect(list.closest(".ink-region")).toBeNull();
      expect(list.querySelectorAll(":scope > div.rounded-md.border")).toHaveLength(2);
      const panel = header.nextElementSibling!;
      expect(panel.className).toContain("ink-region");
      expect(panel.querySelector("[data-date]")).not.toBeNull();
      expect(within(header).queryByText("7-day average")).toBeNull();
      expect(
        within(panel.nextElementSibling as HTMLElement).getByText("7-day average"),
      ).toBeDefined();
      expect(header.textContent).toContain("Incidents declared per UTC day");
      // Chart statistics, not another row of cards.
      expect(within(recent).queryByRole("term", { name: /card/ })).toBeNull();
      expect(list.className).not.toContain("grid");
    });

    it("never manufactures a percentage the API did not give", async () => {
      api(READ, {
        occurrence: occurrenceOver({
          previous: {
            from: "2026-07-22",
            to: "2026-08-20",
            declared: 3,
            comparable: true,
            minimumSample: 5,
            changePercent: null,
          },
        }),
      });
      renderOverview();

      const recent = await section();

      expect(
        await within(recent).findByText(
          "5 more than the previous 30 days (3)",
        ),
      ).toBeDefined();
      // The trend's own words; the services' shares beside it are the API's.
      const trend = within(recent).getByRole("heading", {
        name: "Incident trend",
      }).parentElement!.parentElement!;

      expect(trend.textContent).not.toMatch(/%/);
    });

    it("draws each day as the API gave it: bars, quiet days, today so far", async () => {
      api(READ);
      renderOverview();

      const days = await chartDays();

      expect(within(days).getAllByRole("listitem")).toHaveLength(30);

      // A busy day: its bar, in proportion to the top of the scale (3).
      const busy = dayColumn(days, "2026-09-17");
      expect(busy.textContent).toBe(
        "Thursday, September 17: 3 incidents declared, 7-day average 0.6.",
      );
      expect(busy.querySelector<HTMLElement>("[style]")!.style.height).toBe(
        "100%",
      );
      expect(
        dayColumn(days, "2026-09-03").querySelector<HTMLElement>("[style]")!
          .style.height,
      ).toMatch(/^66\.66/);

      // A quiet day: counted, so on the baseline, with a stub and no bar.
      const quiet = dayColumn(days, "2026-09-05");
      expect(quiet.textContent).toBe(
        "Saturday, September 5: No incidents declared.",
      );
      expect(quiet.className).toContain("border-b");
      expect(quiet.querySelector("[style]")).toBeNull();
      expect(quiet.querySelector(".bg-line-strong")).not.toBeNull();

      // Today: counted so far, hollow, with no average.
      const today = dayColumn(days, "2026-09-19");
      expect(today.textContent).toBe(
        "Today, Saturday, September 19: 1 incident declared so far.",
      );
      expect(
        today.querySelector<HTMLElement>("[style]")!.className,
      ).toContain("bg-trend-bar/30");

      // The key names today's hollow bar, and the axis names today.
      const recent = await section();
      expect(within(recent).getByText("Today, so far")).toBeDefined();
      expect(within(recent).getByText("Today")).toBeDefined();
    });

    it("draws the average only where the API gave one, never bridging a gap", async () => {
      api(READ);
      const { container } = renderOverview();

      await chartDays();
      const recent = container.querySelector("#recent-operational-health")!;
      const lines = [...recent.querySelectorAll("svg:not(.lucide) path")].map((path) =>
        path.getAttribute("d"),
      );

      // The ring and the line trace the same path: three runs of points,
      // each its own move — 21 August alone, 3 September alone, then the
      // 17th and 18th joined.
      expect(new Set(lines).size).toBe(1);
      expect(lines[0]!.match(/M/g)).toHaveLength(3);
      expect(lines[0]!.match(/L/g)).toHaveLength(1);
    });

    it("keeps a day before history apart from a quiet one", async () => {
      api(READ, {
        occurrence: occurrenceOver({
          trackedFrom: "2026-09-01",
          previous: {
            from: "2026-07-22",
            to: "2026-08-20",
            declared: 0,
            comparable: false,
            minimumSample: 5,
            changePercent: null,
          },
        }),
      });
      renderOverview();

      const days = await chartDays();
      const before = dayColumn(days, "2026-08-28");

      expect(before.textContent).toBe(
        "Friday, August 28: before this organization's history.",
      );
      // No baseline and no mark: nothing was counted, so nothing is drawn.
      expect(before.className).not.toContain("border-b");
      expect(before.querySelector("span:not(.sr-only)")).toBeNull();

      const recent = await section();
      expect(
        within(recent).getByText(
          "History begins Sep 1. Earlier days have no record.",
        ),
      ).toBeDefined();
      expect(
        within(recent).getByText(
          "No comparison yet: history does not cover the previous 30 days",
        ),
      ).toBeDefined();
    });

    it("tells a day's figures on hover and on focus, and moves between days by key", async () => {
      const user = userEvent.setup();
      api(READ);
      const { container } = renderOverview();

      const days = await chartDays();
      const tooltip = () =>
        container.querySelector<HTMLElement>(
          "#recent-operational-health [aria-hidden='true'].shadow-overlay",
        );

      await user.hover(dayColumn(days, "2026-09-03"));
      expect(tooltip()!.textContent).toBe(
        "Thu, Sep 32 incidents declared7-day average 0.4",
      );
      await user.unhover(dayColumn(days, "2026-09-03"));
      expect(tooltip()).toBeNull();

      // One Tab stop, entered at today.
      const columns = within(days).getAllByRole("listitem");
      expect(columns.filter((column) => column.tabIndex === 0)).toEqual([
        dayColumn(days, "2026-09-19"),
      ]);

      dayColumn(days, "2026-09-19").focus();
      await waitFor(() =>
        expect(tooltip()!.textContent).toContain("today"),
      );
      expect(tooltip()!.textContent).toContain("1 incident declared so far");

      await user.keyboard("{ArrowLeft}");
      expect(document.activeElement).toBe(dayColumn(days, "2026-09-18"));
      expect(tooltip()!.textContent).toContain("7-day average 0.6");

      await user.keyboard("{Home}");
      expect(document.activeElement).toBe(dayColumn(days, "2026-08-21"));
      await user.keyboard("{End}");
      expect(document.activeElement).toBe(dayColumn(days, "2026-09-19"));
      expect(
        columns.filter((column) => column.tabIndex === 0),
      ).toEqual([dayColumn(days, "2026-09-19")]);
    });

    it("says so when nothing was declared, rather than drawing an empty chart", async () => {
      api(READ, {
        occurrence: occurrenceOver({
          declared: {},
          rolling: {},
          previous: {
            from: "2026-07-22",
            to: "2026-08-20",
            declared: 4,
            comparable: true,
            minimumSample: 5,
            changePercent: null,
          },
        }),
      });
      renderOverview();

      const recent = await section();

      expect(
        await within(recent).findByText(
          "No incidents declared in the last 30 days",
        ),
      ).toBeDefined();
      expect(
        within(recent).getByText("4 fewer than the previous 30 days (4)."),
      ).toBeDefined();
      expect(
        within(recent).queryByRole("list", {
          name: "Incidents declared per day",
        }),
      ).toBeNull();
    });

    it("says there is not enough history, when there is none", async () => {
      api(READ, { occurrence: occurrenceOver({ declared: {}, trackedFrom: null }) });
      renderOverview();

      const recent = await section();

      expect(
        await within(recent).findByText("Not enough history yet"),
      ).toBeDefined();
    });

    it("holds its place while loading, and fails on its own", async () => {
      let respond!: (response: Response) => void;
      let asked = 0;
      api(READ, {
        // The first answer waits; a server error is retried once, and the
        // retry fails at once.
        occurrence: () =>
          (asked += 1) === 1
            ? new Promise<Response>((resolve) => (respond = resolve))
            : apiError(500),
      });
      renderOverview();

      const recent = await section();

      expect(
        within(recent).getByText("Loading recent operational health…"),
      ).toBeDefined();

      await waitFor(() => expect(respond).toBeDefined());
      respond(apiError(500));

      await within(recent).findByRole("alert", {}, { timeout: 4000 });
      // The rest of the page stands: one failure, said once, where it is.
      expect(screen.getAllByRole("alert")).toHaveLength(1);
      expect(await screen.findByLabelText("Operational summary")).toBeDefined();
      expect(
        await screen.findByRole("list", { name: "Active incidents" }),
      ).toBeDefined();
    });

    it("takes no severity, feedback, or lifecycle colour", async () => {
      api(READ);
      const { container } = renderOverview();

      await chartDays();
      const recent = container.querySelector("#recent-operational-health")!;

      expect(recent.innerHTML).not.toMatch(
        /(signal|danger|warning|success|info|status)-/,
      );
    });

    describe("services under pressure", () => {
      const servicesList = async () =>
        within(await section()).findByRole("list", {
          name: "Services under pressure",
        });

      const rows = async () =>
        within(await servicesList()).getAllByRole("listitem");

      it("ranks the services as the API did, ties in its order", async () => {
        api(READ);
        renderOverview();

        const items = await rows();

        expect(items.map((item) => item.textContent)).toEqual([
          "Payment API: 4 incidents, 50% of incidents declared4 incidents50%",
          "Authentication: 2 incidents, 25% of incidents declared2 incidents25%",
          "Search: 1 incident, 13% of incidents declared1 incident13%",
          "Fraud Detection(archived): 1 incident, 13% of incidents declared1 incident13%",
        ]);
        // An ordered list, and no rank drawn that a tie would contradict.
        expect((await servicesList()).tagName).toBe("OL");
      });

      it("draws each bar as the service's share of every incident, not of the busiest", async () => {
        api(READ);
        const { container } = renderOverview();

        await servicesList();
        const bars = [
          ...container.querySelectorAll<HTMLElement>("[data-share-bar]"),
        ];

        expect(bars.map((bar) => bar.style.width)).toEqual([
          "50%",
          "25%",
          "12.5%",
          "12.5%",
        ]);
        // Decoration: the figures are read in words.
        for (const bar of bars) {
          expect(bar.closest('[aria-hidden="true"]')).not.toBeNull();
        }
      });

      it("keeps the bars in their own colour, and leaves criticality out", async () => {
        api(READ);
        const { container } = renderOverview();

        await servicesList();
        const pair = container.querySelector('[data-pair="services"]')!;

        // The view's own silver-aqua, never a state's nor the calendar's.
        for (const bar of pair.querySelectorAll("[data-share-bar]")) {
          expect(bar.className).toContain("bg-pressure-bar");
        }
        // Said what it counts — its definition is its key.
        expect(pair.textContent).toContain(
          "Share of the last 30 days' incidents, by service",
        );
        for (const bar of pair.querySelectorAll("[data-share-bar]")) {
          expect(bar.parentElement!.className).toContain("bg-pressure-track");
        }

        expect(pair.innerHTML).not.toMatch(
          /(signal|danger|warning|success|info|status|activity)-|bg-accent/,
        );
        expect(pair.textContent).not.toMatch(/High|Critical/);
      });

      it("keeps an archived service where the API ranked it, and says so quietly", async () => {
        api(READ);
        renderOverview();

        const items = await rows();

        expect(within(items[3]).getByText("(archived)")).toBeDefined();
        expect(
          items.filter((item) => item.textContent?.includes("(archived)")),
        ).toHaveLength(1);
      });

      it("lists only the services there are, with nothing standing in for the rest", async () => {
        api(READ, {
          occurrence: occurrenceOver({
            services: {
              top: [ranked("Payment API", 8, 1)],
              others: { services: 0, declared: 0 },
            },
          }),
        });
        const { container } = renderOverview();

        expect(await rows()).toHaveLength(1);
        expect(
          container.querySelector<HTMLElement>("[data-share-bar]")!.style.width,
        ).toBe("100%");
        expect(
          container.querySelector('[data-pair="services"]')!.textContent,
        ).not.toMatch(/Not ranked|more service/);
      });

      it("sums what the ranking leaves out in a line, never as a service", async () => {
        api(READ, {
          occurrence: occurrenceOver({
            services: {
              top: [
                ranked("Payment API", 3, 0.375),
                ranked("Authentication", 1, 0.125),
              ],
              others: { services: 3, declared: 4 },
            },
          }),
        });
        const { container } = renderOverview();

        expect(await rows()).toHaveLength(2);
        const recent = await section();
        const remainder = within(recent).getByText(
          "3 more services · 4 incidents",
        );

        expect(
          within(recent).getByText(
            "Not ranked: 3 more services, with 4 incidents between them.",
          ),
        ).toBeDefined();
        // Outside the ranking, with no bar and no percentage: the API gave
        // the remainder no share.
        expect(remainder.closest("ol")).toBeNull();
        expect(remainder.textContent).not.toMatch(/%/);
        expect(container.querySelectorAll("[data-share-bar]")).toHaveLength(2);
      });

      it("shows a share too small to round as under one percent, never nought", async () => {
        api(READ, {
          occurrence: occurrenceOver({
            services: {
              top: [ranked("Payment API", 1, 0.004)],
              others: { services: 40, declared: 249 },
            },
          }),
        });
        renderOverview();

        const [item] = await rows();

        expect(item.textContent).toContain("<1%");
        expect(item.textContent).not.toContain(" 0%");
      });

      it("draws nothing to rank when nothing was declared, leaving the trend the width", async () => {
        api(READ, { occurrence: occurrenceOver({ declared: {}, rolling: {} }) });
        const { container } = renderOverview();

        const recent = await section();

        await within(recent).findByText(
          "No incidents declared in the last 30 days",
        );
        expect(within(recent).queryByText("Services under pressure")).toBeNull();
        expect(container.querySelector('[data-pair="services"]')).toBeNull();
        expect(recent.innerHTML).not.toMatch(/xl:grid-cols-/);
      });

      it("draws nothing to rank without history", async () => {
        api(READ, {
          occurrence: occurrenceOver({ declared: {}, trackedFrom: null }),
        });
        renderOverview();

        const recent = await section();

        await within(recent).findByText("Not enough history yet");
        expect(within(recent).queryByText("Services under pressure")).toBeNull();
      });

      it("links each service for a role that can read services", async () => {
        api(READ);
        renderOverview();

        expect(
          within(await servicesList())
            .getByRole("link", { name: "Payment API" })
            .getAttribute("href"),
        ).toBe("/orgs/acme-ops/services/payment-api");
      });

      it("names each service without linking it for a role that cannot read services", async () => {
        api(READ.filter((permission) => permission !== "services:read"));
        renderOverview();

        const list = await servicesList();

        expect(within(list).queryAllByRole("link")).toHaveLength(0);
        expect(within(list).getByText("Payment API")).toBeDefined();
      });

      it("sits beside the trend from xl, in a narrow column, and beneath it below", async () => {
        api(READ);
        const { container } = renderOverview();

        await servicesList();
        const pair = container.querySelector<HTMLElement>(
          '[data-pair="services"]',
        )!;
        const grid = pair.parentElement!;

        expect(grid.className).toMatch(/xl:grid-cols-\[minmax\(0,1fr\)_21rem\]/);
        expect(grid.className.split(/\s+/)).toContain("grid-cols-1");
        // When before where: the trend first, in the DOM and on the page.
        expect(
          grid.firstElementChild?.querySelector("#incident-trend-title"),
        ).not.toBeNull();
        expect(grid.lastElementChild).toBe(pair);
        // Each view in a frame of its own, which is what parts them: no
        // rule between, beside or stacked. From xl the two share the
        // section's rows, so their headers and their panels are level.
        expect(pair.className).not.toMatch(/border/);
        expect(grid.className).toContain("xl:grid-rows-[auto_1fr_auto]");
        const frames = grid.querySelectorAll(".bg-view");
        expect(frames).toHaveLength(2);
        for (const frame of frames) {
          expect(frame.className).toContain("xl:grid-rows-subgrid");
        }
        // Each view's content on its ink panel, as the calendar's is.
        const panels = grid.querySelectorAll(".ink-region.bg-ink");
        expect(panels).toHaveLength(2);
        expect(panels[0].querySelector("[data-date]")).not.toBeNull();
        expect(panels[1].querySelector("[data-share-bar]")).not.toBeNull();
      });

      it("has no accessibility violations with a remainder and an archived service", async () => {
        api(READ, {
          occurrence: occurrenceOver({
            services: { ...RANKED, others: { services: 2, declared: 3 } },
          }),
        });
        const { container } = renderOverview();

        await servicesList();
        await chartDays();
        await expectNoAxeViolations(
          container.querySelector<HTMLElement>("#recent-operational-health")!,
        );
      });
    });
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

    describe("where it sits, and how its panels share the width", () => {
      /** The page's sections, by id, in the order they are drawn. */
      const sectionOrder = (container: HTMLElement) =>
        [...container.querySelectorAll("section[id]")].map(({ id }) => id);

      /** The element whose children the action panels are — the real one. */
      const cellsOf = (panel: HTMLElement) => {
        const grid = panel.parentElement;

        if (!grid) throw new Error("The panel has no parent");

        return { grid, cells: [...grid.children] };
      };

      const isGrid = (element: Element) =>
        element.className.split(/\s+/).includes("grid");

      it("reads from the state down to the work, both panels side by side", async () => {
        api(MANAGE, {
          attention: {
            manage: { readyToResolve: [complete] },
            respond: { needsYourTeam: [unclaimed], yourResponses: [mine] },
          },
        });
        const { container } = renderOverview();

        const waiting = await screen.findByRole("region", {
          name: "Waiting on you",
        });
        const work = screen.getByRole("region", { name: "Your work" });
        const summary = await screen.findByLabelText("Operational summary");
        const current = screen.getByRole("region", {
          name: "Current operations",
        });

        // State, then what needs the viewer, then what is happening, then
        // the last thirty days, then the year.
        expect(sectionOrder(container)).toEqual([
          "waiting-on-you",
          "your-work",
          "current-operations",
          "recent-operational-health",
          "operational-activity",
        ]);
        // The four figures come before every section.
        expect(
          summary.compareDocumentPosition(waiting) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        expect(
          waiting.compareDocumentPosition(current) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();

        // The rendered tree, not the component structure: both panels are
        // direct cells of one grid, and nothing else is.
        const { grid, cells } = cellsOf(waiting);

        expect(cells).toEqual([waiting, work]);
        expect(isGrid(grid)).toBe(true);
        expect(grid.className).toContain("2xl:grid-cols-2");
      });

      it("frames Waiting on you as a decision only while one is waiting", async () => {
        api(MANAGE, {
          attention: {
            manage: { readyToResolve: [complete] },
            respond: { needsYourTeam: [unclaimed], yourResponses: [mine] },
          },
        });
        renderOverview();

        const waiting = await screen.findByRole("region", {
          name: "Waiting on you",
        });
        const work = screen.getByRole("region", { name: "Your work" });

        expect(waiting.getAttribute("data-tone")).toBe("action");
        // The accent is spent where it points at something — the count, the
        // row to act on — not on the panel's frame nor across its surface.
        expect(waiting.className).not.toMatch(/accent/);
        expect(waiting.firstElementChild?.className).not.toMatch(/accent/);
        const header = waiting.firstElementChild as HTMLElement;

        // Ready to resolve is the resolved teal's, badge and list alike.
        expect(within(header).getByText("1").className).toContain(
          "bg-status-resolved-solid",
        );
        const list = within(waiting).getByRole("list", {
          name: "Ready to resolve",
        });
        expect(list.className).toContain("bg-status-resolved-subtle");
        expect(list.className).not.toMatch(/accent/);
        // Work under way is not a decision: related, not the same.
        expect(work.getAttribute("data-tone")).toBe("default");
        // The page's main operational section holds its place by its edge.
        expect(
          screen
            .getByRole("region", { name: "Current operations" })
            .getAttribute("data-tone"),
        ).toBe("primary");
      });

      it("drops the decision frame when nothing is waiting", async () => {
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

        expect(waiting.getAttribute("data-tone")).toBe("default");
      });

      it("gives an admin's one panel the whole width", async () => {
        // On no team: the work lists would never fill, so they are not shown.
        api(MANAGE, {
          attention: {
            manage: { readyToResolve: [complete] },
            respond: { needsYourTeam: [], yourResponses: [] },
          },
        });
        renderOverview();

        const waiting = await screen.findByRole("region", {
          name: "Waiting on you",
        });
        const { grid, cells } = cellsOf(waiting);

        expect(screen.queryByRole("region", { name: "Your work" })).toBeNull();
        expect(cells).toEqual([waiting]);
        expect(isGrid(grid)).toBe(true);
        // One column at every width: no empty half beside it.
        expect(grid.className).toContain("grid-cols-1");
        expect(grid.className).not.toContain("grid-cols-2");
      });

      it.each([
        ["with work to show", { needsYourTeam: [unclaimed], yourResponses: [] }],
        ["with nothing yet", { needsYourTeam: [], yourResponses: [] }],
      ])(
        "gives a member their work at the whole width, %s",
        async (_, respond) => {
          api(RESPOND, {
            role: "MEMBER",
            attention: { manage: null, respond },
          });
          renderOverview();

          const work = await screen.findByRole("region", { name: "Your work" });
          const { grid, cells } = cellsOf(work);

          // Nothing of what only an admin decides reaches a member.
          expect(
            screen.queryByRole("region", { name: "Waiting on you" }),
          ).toBeNull();
          expect(screen.queryByText("Ready to resolve")).toBeNull();

          expect(cells).toEqual([work]);
          expect(isGrid(grid)).toBe(true);
          expect(grid.className).toContain("grid-cols-1");
          expect(grid.className).not.toContain("grid-cols-2");
        },
      );

      it("leaves nothing behind when neither panel is the caller's", async () => {
        api(READ);
        renderOverview();

        const activity = await screen.findByRole("region", {
          name: "Operational activity",
        });

        await waitFor(() =>
          expect(screen.queryByText("Loading what needs you…")).toBeNull(),
        );

        expect(
          screen.queryByRole("region", { name: "Waiting on you" }),
        ).toBeNull();
        expect(screen.queryByRole("region", { name: "Your work" })).toBeNull();
        // Activity is the page's last section, with no empty grid after it.
        expect(activity.parentElement?.lastElementChild).toBe(activity);
      });

      it("has no accessibility violations as a whole page", async () => {
        api(MANAGE, {
          attention: {
            manage: { readyToResolve: [complete] },
            respond: { needsYourTeam: [unclaimed], yourResponses: [mine] },
          },
        });
        const { container } = renderOverview();

        await screen.findByRole("region", { name: "Your work" });
        await screen.findByRole("list", { name: "Active incidents" });
        await screen.findByRole("grid", { name: /Operational activity/ });
        await expectNoAxeViolations(container);
      }, 30_000);
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
