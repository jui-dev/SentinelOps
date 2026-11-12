import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OrganizationScope } from "@/components/organizations/organization-scope";
import type {
  ActivityEntryDetailResponse,
  ActivityEntryResponse,
  ActivityPageResponse,
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

import {
  dayHeading,
  formatValue,
  inlineChange,
  noteOf,
  periodStart,
  sentenceText,
  timeAgo,
} from "./activity-meta";
import { ActivityView } from "./activity-view";

vi.mock("next/navigation", () => ({
  useParams: () => ({ orgSlug: "acme-ops" }),
  usePathname: () => "/orgs/acme-ops/activity",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const ADMIN = ["organization:read", "memberships:read", "memberships:read-all", "activity:read"];
const MANAGER = ["organization:read", "memberships:read", "memberships:read-all"];
const base = `/organizations/${organization.id}`;

const SAM_ID = "0199a1b2-c3d4-7000-8000-0000000000bb";
const ago = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString();

const entry = (
  id: string,
  overrides: Partial<ActivityEntryResponse>,
): ActivityEntryResponse => ({
  id: `0199a1b2-c3d4-7000-8000-0000000001${id}`,
  reference: `ACT-0000-01${id.toUpperCase()}`,
  action: "TEAM_CREATED",
  area: "TEAMS",
  occurredAt: ago(5),
  actor: { id: currentUser.id, name: "Ada Lovelace" },
  subject: null,
  changes: [],
  client: { ipAddress: "10.0.4.2", browser: "Chrome on Windows" },
  repeat: null,
  ...overrides,
});

const roleChanged = entry("a1", {
  action: "ROLE_CHANGED",
  area: "PEOPLE",
  occurredAt: ago(2),
  subject: { type: "MEMBERSHIP", id: SAM_ID, name: "Sam Okafor" },
  changes: [{ field: "role", before: "RESPONDER", after: "INCIDENT_MANAGER" }],
});
const serviceChanged = entry("a2", {
  action: "SERVICE_UPDATED",
  area: "SERVICES",
  occurredAt: ago(30),
  subject: { type: "SERVICE", id: "svc", name: "Checkout API" },
  changes: [
    { field: "criticality", before: "HIGH", after: "CRITICAL" },
    { field: "team", before: "Payments", after: "Risk" },
  ],
});
const memberAdded = entry("a3", {
  action: "MEMBER_ADDED",
  area: "PEOPLE",
  occurredAt: ago(60 * 26),
  subject: { type: "MEMBERSHIP", id: SAM_ID, name: "Sam Okafor" },
  changes: [
    { field: "email", before: null, after: "sam@example.com" },
    { field: "role", before: null, after: "RESPONDER" },
  ],
});

const page = (
  entries: ActivityEntryResponse[],
  nextCursor: string | null = null,
): ActivityPageResponse => ({
  entries,
  nextCursor,
  areaCounts: { PEOPLE: 2, TEAMS: 0, SERVICES: 1, KNOWN_ISSUES: 0, ORGANIZATION: 0 },
  securityTotals: null,
});

const detail: ActivityEntryDetailResponse = {
  ...roleChanged,
  history: [memberAdded],
  subjectNow: { exists: true, slug: null },
  attempts: null,
  next: null,
  usualClient: null,
};

const members = [
  {
    id: "0199a1b2-c3d4-7000-8000-0000000000aa",
    role: "ADMIN",
    createdAt: "2026-09-01T12:00:00.000Z",
    user: { id: currentUser.id, name: "Ada Lovelace", email: "ada@example.com", passwordChangeRequired: false },
    teams: [],
  },
  {
    id: SAM_ID,
    role: "INCIDENT_MANAGER",
    createdAt: "2026-09-19T12:00:00.000Z",
    user: { id: "0199a1b2-c3d4-7000-8000-000000000002", name: "Sam Okafor", email: "sam@example.com", passwordChangeRequired: false },
    teams: [],
  },
];

/** The query a request for the log asked with, or null for any other. */
const logQuery = (request: SentRequest) =>
  request.method === "GET" && request.path.startsWith(`${base}/activity?`)
    ? new URLSearchParams(request.path.split("?")[1])
    : null;

const PRIYA_ID = "0199a1b2-c3d4-7000-8000-000000000003";
const priya = { id: PRIYA_ID, name: "Priya Shah" };
const priyaSubject = { type: "MEMBERSHIP" as const, id: SAM_ID, name: "Priya Shah" };
const firefox = { ipAddress: "203.0.113.7", browser: "Firefox on Linux" };

const blocked = entry("c1", {
  action: "SIGN_IN_BLOCKED",
  area: "SECURITY",
  occurredAt: ago(10),
  actor: priya,
  subject: priyaSubject,
  changes: [{ field: "blockedUntil", before: null, after: ago(-5) }],
  client: firefox,
});
const wrong = entry("c2", {
  action: "SIGN_IN_FAILED",
  area: "SECURITY",
  occurredAt: ago(10),
  actor: priya,
  subject: priyaSubject,
  client: firefox,
  repeat: { count: 5, firstAt: ago(14) },
});
const signedIn = entry("c3", {
  action: "SIGNED_IN",
  area: "SECURITY",
  occurredAt: ago(20),
  subject: { type: "MEMBERSHIP", id: members[0].id, name: "Ada Lovelace" },
  changes: [{ field: "with", before: null, after: "ONE_TIME_PASSWORD" }],
});

const securityPage: ActivityPageResponse = {
  entries: [blocked, wrong, signedIn],
  nextCursor: null,
  areaCounts: null,
  securityTotals: { signIns: 38, failedSignIns: 6, blocked: 1 },
};

const wrongDetail: ActivityEntryDetailResponse = {
  ...wrong,
  history: [],
  subjectNow: { exists: true, slug: null },
  attempts: [ago(14), ago(13), ago(12), ago(11), ago(10)],
  next: blocked,
  usualClient: { ipAddress: "10.0.4.15", browser: "Chrome on Windows" },
};

const api = (
  permissions: string[],
  answer: (query: URLSearchParams) => ActivityPageResponse = () =>
    page([roleChanged, serviceChanged, memberAdded]),
) =>
  mockApi((request) => {
    const query = logQuery(request);

    if (query?.get("view") === "security") return jsonResponse(200, securityPage);
    if (query) return jsonResponse(200, answer(query));
    if (route(request) === `GET ${base}/activity/${wrong.id}`) {
      return jsonResponse(200, wrongDetail);
    }

    switch (route(request)) {
      case "POST /auth/refresh":
        return refreshed("token");
      case "GET /auth/me":
        return jsonResponse(200, currentUser);
      case `GET ${base}`:
        return jsonResponse(200, organizationDetail(permissions));
      case `GET ${base}/memberships`:
        return jsonResponse(200, members);
      case `GET ${base}/activity/${roleChanged.id}`:
        return jsonResponse(200, detail);
      default:
        return apiError(404, "NOT_FOUND");
    }
  });

const render = () =>
  renderWithSession(
    <OrganizationScope>
      <ActivityView />
    </OrganizationScope>,
  );

const queries = (requests: SentRequest[]) =>
  requests.map(logQuery).filter((query) => query !== null);

describe("activity log", () => {
  beforeEach(() => {
    clearAccessToken();
  });

  it("lists the changes by day, as sentences, with who, the change, and the area", async () => {
    api(ADMIN);
    render();

    const table = await screen.findByRole("table", { name: "Changes" });
    const rows = within(table).getAllByRole("row");

    // The day headings sit between the rows of their days.
    expect(
      within(table)
        .getAllByRole("columnheader")
        .filter((cell) => cell.getAttribute("colspan") === "5")
        .map((cell) => cell.textContent),
    ).toEqual(
      [...new Set([roleChanged, memberAdded].map((each) => dayHeading(each.occurredAt, new Date())))],
    );

    const sam = rows.find((row) => row.textContent?.includes("Changed the role of"));

    expect(sam?.textContent).toMatch(/Ada Lovelace.*Admin.*Changed the role of Sam Okafor.*Responder.*Incident Manager.*People/);
    expect(
      rows.find((row) => row.textContent?.includes("Checkout API"))?.textContent,
    ).toMatch(/High.*Critical.*and 1 more change.*Services/);
    expect(
      rows.find((row) => row.textContent?.includes("Added the member"))?.textContent,
    ).toMatch(/As a Responder/);

    // Each area in the filter says how many it holds.
    const areas = screen.getByLabelText("Area") as HTMLSelectElement;

    expect(areas.value).toBe("");
    expect([...areas.options].map((option) => option.textContent)).toEqual([
      "All areas (3)",
      "People (2)",
      "Teams (0)",
      "Services (1)",
      "Known issues (0)",
      "Organization (0)",
    ]);
    expect(screen.getByText("Showing 3 changes from the last 7 days")).toBeDefined();
    await expectNoAxeViolations(document.body);
  });

  it("narrows the log by area, person, search and period", async () => {
    const user = userEvent.setup();
    const { requests } = api(ADMIN);

    render();
    await screen.findByRole("table", { name: "Changes" });

    // The default: the Changes view over the last 7 days.
    const first = queries(requests)[0];

    expect(first.get("view")).toBe("changes");
    expect(Date.parse(first.get("since") ?? "")).toBeLessThan(Date.now() - 6 * 24 * 3_600_000);

    await user.selectOptions(screen.getByLabelText("Area"), "SERVICES");
    await waitFor(() => expect(queries(requests).at(-1)?.get("area")).toBe("SERVICES"));

    await user.selectOptions(screen.getByLabelText("Done by"), "Sam Okafor");
    await waitFor(() =>
      expect(queries(requests).at(-1)?.get("actorId")).toBe(members[1].user.id),
    );

    await user.type(screen.getByLabelText("Search"), "checkout");
    await waitFor(() => expect(queries(requests).at(-1)?.get("q")).toBe("checkout"));

    await user.selectOptions(screen.getByLabelText("Period"), "All time");
    await waitFor(() => expect(queries(requests).at(-1)?.has("since")).toBe(false));
  });

  it("shows older entries when asked", async () => {
    const user = userEvent.setup();
    const { requests } = api(ADMIN, (query) =>
      query.get("cursor") === "older"
        ? page([memberAdded])
        : page([roleChanged, serviceChanged], "older"),
    );

    render();
    await user.click(await screen.findByRole("button", { name: "Show older" }));

    expect(await screen.findByText(/Added the member/)).toBeDefined();
    expect(queries(requests).at(-1)?.get("cursor")).toBe("older");
    expect(screen.queryByRole("button", { name: "Show older" })).toBeNull();
  });

  it("opens one change in full: every field, when and from where, its history, and a way to it", async () => {
    const user = userEvent.setup();

    api(ADMIN);
    render();

    await user.click(
      await screen.findByRole("button", {
        name: "View details: Changed the role of Sam Okafor",
      }),
    );

    const dialog = await screen.findByRole("dialog", { name: "Role changed" });

    expect(within(dialog).getByRole("row", { name: /Role Responder Incident Manager/ })).toBeDefined();
    expect(dialog.textContent).toMatch(/10\.0\.4\.2 · Chrome on Windows/);
    expect(dialog.textContent).toContain(roleChanged.reference);
    expect(await within(dialog).findByText(/Ada Lovelace — added the member Sam Okafor/)).toBeDefined();
    expect(
      within(dialog).getByRole("link", { name: "Open Sam Okafor in Members" }).getAttribute("href"),
    ).toBe(`/orgs/acme-ops/members/${SAM_ID}`);
    await expectNoAxeViolations(document.body);

    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("says why the table is empty", async () => {
    api(ADMIN, () => ({ ...page([]), areaCounts: { PEOPLE: 0, TEAMS: 0, SERVICES: 0, KNOWN_ISSUES: 0, ORGANIZATION: 0 } }));
    render();

    expect(await screen.findByText("Nothing was changed in the last 7 days.")).toBeDefined();
  });

  it("keeps sign-ins on their own tab: the totals, the result of each, and a block standing out", async () => {
    const user = userEvent.setup();
    const { requests } = api(ADMIN);

    render();
    await user.click(await screen.findByRole("tab", { name: "Sign-ins & security" }));

    const table = await screen.findByRole("table", { name: "Sign-ins and security" });

    expect(queries(requests).at(-1)?.get("view")).toBe("security");
    // Each total beside what it counts.
    const total = (label: string) =>
      within(screen.getByText(label).parentElement as HTMLElement).getByRole("definition")
        .textContent;

    expect(total("Sign-ins in the last 7 days")).toBe("38");
    expect(total("Wrong passwords")).toBe("6");
    expect(total("Sign-ins blocked for 15 minutes")).toBe("1");

    const rows = within(table).getAllByRole("row");
    const row = (text: string) => rows.find((each) => each.textContent?.includes(text));

    expect(row("Blocked")?.textContent).toMatch(/Sign-ins refused until .*Priya Shah.*203\.0\.113\.7 · Firefox on Linux/);
    expect(row("Wrong password ×5")?.textContent).toMatch(/ to /);
    expect(row("Signed in")?.textContent).toMatch(/First sign-in, with a one-time password/);
    await expectNoAxeViolations(document.body);

    await user.selectOptions(screen.getByLabelText("Result"), "Blocked");
    await waitFor(() =>
      expect(queries(requests).at(-1)?.get("result")).toBe("SIGN_IN_BLOCKED"),
    );
  });

  it("opens wrong passwords in full: each attempt, what happened next, and where they usually sign in from", async () => {
    const user = userEvent.setup();

    api(ADMIN);
    render();
    await user.click(await screen.findByRole("tab", { name: "Sign-ins & security" }));
    await user.click(
      await screen.findByRole("button", {
        name: "View details: Wrong password ×5, Priya Shah",
      }),
    );

    const dialog = await screen.findByRole("dialog", { name: "Priya Shah" });

    expect(await within(dialog).findByText("What happened next")).toBeDefined();
    expect(dialog.textContent).toMatch(/Sign-ins blocked at/);
    expect(within(dialog).getAllByText(/^Wrong password/).length).toBeGreaterThanOrEqual(5);
    expect(dialog.textContent).toMatch(/the last before sign-ins were blocked/);
    expect(within(dialog).getByText("New for this account")).toBeDefined();
    expect(dialog.textContent).toMatch(/Usually from10\.0\.4\.15 · Chrome on Windows/);
    expect(
      within(dialog).getByRole("link", { name: "Open Priya Shah in Members" }),
    ).toBeDefined();
    await expectNoAxeViolations(document.body);
  });

  it.each([
    ["an Incident Manager", MANAGER],
    ["a Reporter", ["organization:read", "memberships:read", "incidents:declare"]],
    ["a Responder", ["organization:read", "memberships:read", "responses:work"]],
  ])("is the Admin's alone: %s is told so, and the log is not asked for", async (_, permissions) => {
    const { requests } = api(permissions);

    render();

    expect(await screen.findByText("Only the Admin sees the activity log")).toBeDefined();
    expect(queries(requests)).toEqual([]);
  });
});

describe("activity log wording", () => {
  it("names values the way people say them", () => {
    expect(formatValue("role", "INCIDENT_MANAGER")).toBe("Incident Manager");
    expect(formatValue("criticality", "CRITICAL")).toBe("Critical");
    expect(formatValue("usualSeverity", "SEV2")).toBe("SEV2 · Major");
    expect(formatValue("status", "ARCHIVED")).toBe("Archived");
    expect(formatValue("name", null)).toBe("—");
  });

  it("shows a creation's role as a note, not a change", () => {
    expect(inlineChange(memberAdded)).toBeNull();
    expect(noteOf(memberAdded)).toBe("As a Responder");
    expect(noteOf({ ...memberAdded, changes: [{ field: "role", before: null, after: "INCIDENT_MANAGER" }] })).toBe(
      "As an Incident Manager",
    );
  });

  it("reads who joined or left a team in the sentence", () => {
    expect(
      sentenceText(
        entry("b1", {
          action: "TEAM_MEMBER_REMOVED",
          subject: { type: "TEAM", id: "t", name: "Risk" },
          changes: [{ field: "member", before: "Ben", after: null }],
        }),
      ),
    ).toBe("Took Ben off Risk");
  });

  it("keeps a period's start to the minute, and none for all time", () => {
    const now = Date.parse("2026-11-12T14:32:47.123Z");

    expect(periodStart("24h", now)).toBe("2026-11-11T14:32:00.000Z");
    expect(periodStart("all", now)).toBeUndefined();
    expect(timeAgo("2026-11-12T12:30:00.000Z", now)).toBe("2 hours ago");
    expect(timeAgo("2026-11-12T14:32:30.000Z", now)).toBe("just now");
  });
});
