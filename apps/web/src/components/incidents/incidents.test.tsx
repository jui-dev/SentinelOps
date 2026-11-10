import { QueryClient } from "@tanstack/react-query";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OrganizationScope } from "@/components/organizations/organization-scope";
import type {
  IncidentActivityResponse,
  IncidentDetailResponse,
  IncidentListItemResponse,
  IncidentResponderResponse,
  IncidentResponse,
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
import { renderWithSession } from "@/test/render";

import { IncidentDetail } from "./incident-detail";
import { LIVE_POLL_MS, storeIncident } from "./incident-queries";
import { IncidentsView } from "./incidents-view";
import { formatAge } from "./live-status";

const navigation = vi.hoisted(() => ({
  params: { orgSlug: "acme-ops" } as {
    orgSlug: string;
    incidentNumber?: string;
  },
  search: "",
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => navigation.params,
  usePathname: () => "/orgs/acme-ops/incidents",
  useSearchParams: () => new URLSearchParams(navigation.search),
  useRouter: () => ({ replace: navigation.replace, push: navigation.push }),
}));

/** What the ADMIN holds: everything, the incident lifecycle included. */
const ADMIN = [
  "incidents:manage",
  "incidents:read",
  "incidents:read-all",
  "incidents:respond",
  "invitations:manage",
  "invitations:read",
  "members:manage",
  "memberships:read",
  "organization:read",
  "organization:update",
  "services:manage",
  "services:read",
  "teams:manage",
  "teams:read",
];
/** What a MEMBER holds: every read, and posting operational updates. */
const MEMBER = [
  "incidents:read",
  "incidents:respond",
  "memberships:read",
  "organization:read",
  "services:read",
  "teams:read",
];
const READ_ONLY = [
  "incidents:read",
  "memberships:read",
  "organization:read",
  "services:read",
  "teams:read",
];

/**
 * Read-only oversight: every incident, and nothing to change. Whoever holds
 * incidents:read-all reads the organization's Incidents page; without it, a
 * member's (see "a member's incidents").
 */
const OVERSIGHT = [...READ_ONLY, "incidents:read-all"];

const base = `/organizations/${organization.id}`;

const payments = {
  id: "0199a1b2-c3d4-7000-8000-0000000000c1",
  name: "Payments",
  slug: "payments",
  description: null,
  memberCount: 2,
  serviceCount: 1,
  createdAt: "2026-09-18T12:00:00.000Z",
  updatedAt: "2026-09-18T12:00:00.000Z",
};
const platform = {
  ...payments,
  id: "0199a1b2-c3d4-7000-8000-0000000000c2",
  name: "Platform",
  slug: "platform",
};

const paymentApi = {
  id: "0199a1b2-c3d4-7000-8000-0000000000e1",
  name: "Payment API",
  slug: "payment-api",
  description: null,
  criticality: "CRITICAL" as const,
  ownerTeam: { id: payments.id, name: "Payments", slug: "payments" },
  archivedAt: null as string | null,
  createdAt: "2026-09-18T12:00:00.000Z",
  updatedAt: "2026-09-18T12:00:00.000Z",
};
const legacyPortal = {
  ...paymentApi,
  id: "0199a1b2-c3d4-7000-8000-0000000000e2",
  name: "Legacy Portal",
  slug: "legacy-portal",
  archivedAt: "2026-09-18T12:00:00.000Z",
};

/** Two members of the organization: the caller, and Daniel on no team. */
const ada = {
  id: currentUser.memberships[0].id,
  role: "ADMIN",
  createdAt: "2026-09-01T12:00:00.000Z",
  user: { id: currentUser.id, name: "Ada Lovelace", email: currentUser.email },
};
const daniel = {
  id: "0199a1b2-c3d4-7000-8000-0000000000ab",
  role: "MEMBER",
  createdAt: "2026-09-02T12:00:00.000Z",
  user: {
    id: "0199a1b2-c3d4-7000-8000-000000000002",
    name: "Daniel Okafor",
    email: "daniel@example.test",
  },
};

/** Someone on the incident's responsible team, as the team routes list them. */
const onTeam = (member: typeof ada) => ({
  membershipId: member.id,
  addedAt: "2026-09-03T12:00:00.000Z",
  user: member.user,
});

/**
 * An incident as the single-incident routes return it, with its responders —
 * by default nobody yet. Lists ignore the responders.
 */
const incident = (
  overrides: Partial<IncidentDetailResponse> = {},
): IncidentDetailResponse => ({
  id: "0199a1b2-c3d4-7000-8000-0000000000f1",
  number: 42,
  title: "Card payments failing",
  summary: "Card declines since 14:02.",
  resolution: null,
  severity: "SEV1",
  status: "INVESTIGATING",
  service: {
    id: paymentApi.id,
    name: "Payment API",
    slug: "payment-api",
    criticality: "CRITICAL",
    archivedAt: null,
  },
  team: { id: payments.id, name: "Payments", slug: "payments" },
  createdBy: { id: currentUser.id, name: "Ada Lovelace" },
  createdAt: "2026-09-18T12:00:00.000Z",
  updatedAt: "2026-09-18T12:00:00.000Z",
  resolvedAt: null,
  responders: [],
  ...overrides,
});

/** Sam, a second member, for responders other than the caller and Daniel. */
const sam = {
  ...daniel,
  id: "0199a1b2-c3d4-7000-8000-0000000000ac",
  user: { ...daniel.user, id: "0199a1b2-c3d4-7000-8000-000000000003", name: "Sam Okafor" },
};

/** Someone who started investigating; by default still investigating. */
const responder = (
  member: typeof ada,
  status: IncidentResponderResponse["status"] = "INVESTIGATING",
): IncidentResponderResponse => ({
  membershipId: member.id,
  name: member.user.name,
  status,
  startedAt: "2026-09-18T12:05:00.000Z",
  completedAt: status === "COMPLETED" ? "2026-09-18T12:40:00.000Z" : null,
});

/** A timeline entry; by default an update Daniel posted. */
const activity = (
  overrides: Partial<IncidentActivityResponse> = {},
): IncidentActivityResponse => ({
  id: "0199a1b2-c3d4-7000-8000-000000000101",
  type: "UPDATE",
  message: "Investigating elevated database latency.",
  fromValue: null,
  toValue: null,
  actor: { id: daniel.user.id, name: "Daniel Okafor" },
  createdAt: "2026-09-18T12:05:00.000Z",
  ...overrides,
});

/** The signed-in caller's membership, as organizationDetail gives it. */
const CALLER = "0199a1b2-c3d4-7000-8000-0000000000aa";

/**
 * An incident as a list gives it: its responders counted, the caller's own
 * response among them, and when it was last updated — by default never.
 */
const listItem = (
  item: IncidentResponse & Partial<IncidentDetailResponse & IncidentListItemResponse>,
): IncidentListItemResponse => {
  const yours = (item.responders ?? []).find(
    ({ membershipId }) => membershipId === CALLER,
  );

  return {
    response: {
      investigating: (item.responders ?? []).filter(
        ({ status }) => status === "INVESTIGATING",
      ).length,
      completed: (item.responders ?? []).filter(({ status }) => status === "COMPLETED")
        .length,
    },
    lastUpdateAt: null,
    yourResponse: yours
      ? {
          status: yours.status,
          startedAt: yours.startedAt,
          completedAt: yours.completedAt,
        }
      : null,
    ...item,
  };
};

const page = (items: IncidentResponse[], cursor: string | null = null) => ({
  items: items.map(listItem),
  page: { cursor, hasMore: cursor !== null },
});

/** Where response stands now, as the Incidents page's band reads it. */
const summary = {
  current: {
    active: 4,
    activeBySeverity: { SEV1: 1, SEV2: 1, SEV3: 1, SEV4: 1 },
    affectedServices: [],
    responders: { active: 2, teams: 1 },
    activeByStatus: { DECLARED: 1, INVESTIGATING: 3 },
    readyToResolve: 1,
    typicalResolution: {
      from: "2026-06-21",
      to: "2026-09-18",
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
    from: "2026-08-20",
    to: "2026-09-18",
    declared: 9,
    declaredBySeverity: { SEV1: 1, SEV2: 3, SEV3: 4, SEV4: 1 },
    resolved: 9,
    stillOpen: 0,
    resolutionMedianMs: null,
    history: { total: 0, items: [] },
  },
};

type Handler = (request: SentRequest) => Response | undefined;

const api = (
  permissions: string[],
  {
    active = [incident()],
    resolved = [] as IncidentResponse[],
    detail = incident(),
    timeline = [] as IncidentActivityResponse[],
    // The caller and Daniel respond for Payments, the default team.
    teamMembers = [onTeam(ada), onTeam(daniel)],
    services = [paymentApi],
    handler = () => undefined,
  }: {
    active?: IncidentResponse[];
    resolved?: IncidentResponse[];
    detail?: IncidentDetailResponse;
    timeline?: IncidentActivityResponse[];
    teamMembers?: ReturnType<typeof onTeam>[];
    services?: (typeof paymentApi)[];
    handler?: Handler;
  } = {},
) =>
  mockApi((request) => {
    const handled = handler(request);

    if (handled) return handled;

    if (route(request).startsWith(`GET ${base}/incidents/summary?`)) {
      return jsonResponse(200, summary);
    }

    switch (route(request)) {
      case "POST /auth/refresh":
        return refreshed("token");
      case "GET /auth/me":
        return jsonResponse(200, currentUser);
      case `GET ${base}`:
        return jsonResponse(200, organizationDetail(permissions));
      case `GET ${base}/incidents?state=active`:
        return jsonResponse(200, page(active));
      case `GET ${base}/incidents?state=resolved`:
        return jsonResponse(200, page(resolved));
      case `GET ${base}/incidents/${detail.number}`:
        return jsonResponse(200, detail);
      case `GET ${base}/incidents/${detail.number}/timeline`:
        return jsonResponse(200, timeline);
      // No analysis has been started unless a test says otherwise.
      case `GET ${base}/incidents/${detail.number}/analysis`:
        return apiError(404, "ANALYSIS_NOT_STARTED");
      case `GET ${base}/services`:
        return jsonResponse(200, services);
      case `GET ${base}/teams`:
        return jsonResponse(200, [payments, platform]);
      case `GET ${base}/teams/${detail.team.id}/members`:
        return jsonResponse(200, teamMembers);
      case `GET ${base}/memberships`:
        return jsonResponse(200, [ada, daniel]);
      default:
        return apiError(404, "INCIDENT_NOT_FOUND");
    }
  });

const inOrganization = (ui: React.ReactNode) =>
  renderWithSession(<OrganizationScope>{ui}</OrganizationScope>);

const count = (requests: SentRequest[], key: string) =>
  requests.filter((r) => route(r) === key).length;

describe("incidents", () => {
  beforeEach(() => {
    clearAccessToken();
    navigation.params = { orgSlug: "acme-ops" };
    navigation.search = "";
    navigation.push.mockReset();
    navigation.replace.mockReset();
  });

  describe("the list", () => {
    it("shows what is happening: severity in words, the incident, where, who, status, and how long", async () => {
      api(OVERSIGHT, {
        active: [incident(), incident({ number: 7, severity: "SEV3", title: "Reports delayed", status: "DECLARED" })],
      });

      inOrganization(<IncidentsView />);

      const table = await screen.findByRole("table", { name: "Active incidents" });
      const [, first, second] = within(table).getAllByRole("row");

      expect(within(first).getByText("SEV1")).toBeDefined();
      // The word is read out even where only the code is shown.
      expect(within(first).getByText("Critical")).toBeDefined();
      expect(within(first).getByText("Card payments failing")).toBeDefined();
      expect(within(first).getByText("Payment API · Payments")).toBeDefined();
      expect(within(first).getByText("Investigating")).toBeDefined();
      expect(within(first).getAllByText(/^(<1m|\d+[mhd])/).length).toBeGreaterThan(0);
      expect(within(second).getByText("Declared")).toBeDefined();
      // Where the response stands, and when it was last updated.
      expect(within(second).getByText("No one yet")).toBeDefined();
      expect(within(first).getAllByText("None yet").length).toBeGreaterThan(0);
      // The active tab, counted; the resolved one not asked for until opened.
      expect(screen.getByRole("tab", { name: "Active 2", selected: true })).toBeDefined();
      expect(screen.getByRole("tab", { name: "Resolved", selected: false })).toBeDefined();
    });

    it("gives each row one way in, View, and opens it in place to show the latest update and who can respond", async () => {
      const user = userEvent.setup();
      api(OVERSIGHT, {
        active: [incident(), incident({ number: 7, severity: "SEV3", title: "Reports delayed", status: "DECLARED" })],
        detail: incident({ responders: [responder(daniel)] }),
        timeline: [activity()],
      });

      inOrganization(<IncidentsView />);

      const table = await screen.findByRole("table", { name: "Active incidents" });
      const [, first, second] = within(table).getAllByRole("row");

      // One link per row, named by the incident; the title is not one.
      expect(within(first).getAllByRole("link")).toHaveLength(1);
      expect(within(second).getAllByRole("link")).toHaveLength(1);
      expect(
        within(first).getByRole("link", { name: "View INC-42" }).getAttribute("href"),
      ).toBe("/orgs/acme-ops/incidents/42");

      // A click on the row opens it in place.
      await user.click(within(first).getByText("Card payments failing"));

      const latest = await screen.findByRole("region", { name: "Latest update on INC-42" });
      expect(
        await within(latest).findByText("Investigating elevated database latency."),
      ).toBeDefined();
      const who = screen.getByRole("region", { name: "Who can respond to INC-42" });
      expect(await within(who).findByText("Daniel Okafor")).toBeDefined();
      expect(within(who).getByText("investigating")).toBeDefined();
      // The rest of the team, who have not joined.
      expect(await within(who).findByText("Ada Lovelace")).toBeDefined();
      expect(within(who).getByText("not joined")).toBeDefined();

      await user.click(
        within(first).getByRole("button", { name: "Hide the latest update and responders of INC-42" }),
      );
      expect(screen.queryByRole("region", { name: "Latest update on INC-42" })).toBeNull();
      // Status is its word; the icon beside it is decoration.
      const status = within(first).getByText("Investigating");
      expect(status.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
      // SEV1 is said in words, not only by its colour or its edge.
      expect(within(first).getByText("SEV1")).toBeDefined();
      expect(within(first).getByText("Critical")).toBeDefined();
    });

    it("offers no declaration without incidents:manage", async () => {
      api(OVERSIGHT);

      inOrganization(<IncidentsView />);

      await screen.findByRole("table", { name: "Active incidents" });

      expect(screen.queryByRole("button", { name: "Declare incident" })).toBeNull();
    });

    it("lets the admin declare", async () => {
      api(ADMIN);

      inOrganization(<IncidentsView />);

      expect(
        await screen.findByRole("button", { name: "Declare incident" }),
      ).toBeDefined();
    });

    it("offers a member no declaration", async () => {
      api(MEMBER);

      inOrganization(<IncidentsView />);

      await screen.findByRole("group", { name: "Your part" });

      expect(screen.queryByRole("button", { name: "Declare incident" })).toBeNull();
    });

    it("narrows each list to the range in the URL, by the moment that defines it", async () => {
      navigation.search = "from=2026-09-12&to=2026-09-18";
      const range = "from=2026-09-12&to=2026-09-18";
      const { requests } = api(OVERSIGHT, {
        handler: (request) => {
          if (route(request) === `GET ${base}/incidents?state=active&${range}`) {
            return jsonResponse(200, page([incident()]));
          }
          if (route(request) === `GET ${base}/incidents?state=resolved&${range}`) {
            return jsonResponse(200, page([]));
          }

          return undefined;
        },
      });

      inOrganization(<IncidentsView />);

      await screen.findByRole("table", { name: "Active incidents" });

      // The range, said once, with a way out of it.
      expect(screen.getByText(/12.*18.*2026/).textContent).toMatch(/2026/);
      expect(screen.getByText("(UTC)")).toBeDefined();
      expect(
        screen.getByRole("link", { name: "Clear" }).getAttribute("href"),
      ).toBe("/orgs/acme-ops/incidents");

      // The list says which moment it is filtered on.
      expect(screen.getByText("Declared in this range.")).toBeDefined();

      expect(count(requests, `GET ${base}/incidents?state=active&${range}`)).toBe(1);
      // Asked for once its tab is opened.
      expect(count(requests, `GET ${base}/incidents?state=resolved&${range}`)).toBe(0);
      expect(navigation.replace).not.toHaveBeenCalled();
    });

    it.each([
      "from=2026-09-12",
      "from=2026-09-18&to=2026-09-12",
      "from=2026-02-30&to=2026-03-02",
      "from=2025-01-01&to=2026-09-18",
    ])("puts the URL right when its range (%s) cannot be applied", async (search) => {
      navigation.search = search;
      const { requests } = api(OVERSIGHT);

      inOrganization(<IncidentsView />);

      await screen.findByRole("table", { name: "Active incidents" });

      expect(navigation.replace).toHaveBeenCalledWith("/orgs/acme-ops/incidents", {
        scroll: false,
      });
      // What was shown meanwhile is the unfiltered page, never a guess.
      expect(count(requests, `GET ${base}/incidents?state=active`)).toBe(1);
      expect(screen.queryByRole("link", { name: "Clear" })).toBeNull();
    });

    describe("filters", () => {
      const filtered = (state: string) =>
        `GET ${base}/incidents?state=${state}&severity=SEV2&serviceId=${paymentApi.id}&teamId=${payments.id}&q=checkout`;

      it("sends the URL's filters to both lists, the service and team by id, and nothing unfiltered first", async () => {
        navigation.search = `q=checkout&severity=SEV2&service=payment-api&team=${payments.id}`;
        const { requests } = api(OVERSIGHT, {
          handler: (request) =>
            route(request) === filtered("active")
              ? jsonResponse(200, page([incident({ severity: "SEV2", title: "Checkout failing" })]))
              : route(request) === filtered("resolved")
                ? jsonResponse(200, page([]))
                : undefined,
        });

        inOrganization(<IncidentsView />);

        expect(await screen.findByText("Checkout failing")).toBeDefined();
        expect(count(requests, filtered("active"))).toBe(1);
        // Waited for the lists, rather than showing everything for a moment.
        expect(count(requests, `GET ${base}/incidents?state=active`)).toBe(0);

        const search = screen.getByRole("search", { name: "Filter incidents" });

        expect((within(search).getByLabelText("Search") as HTMLInputElement).value).toBe("checkout");
        expect(
          within(within(search).getByRole("group", { name: "Severity" })).getByRole("button", {
            pressed: true,
          }).textContent,
        ).toMatch(/^SEV2/);
        expect((within(search).getByLabelText("Service") as HTMLSelectElement).value).toBe("payment-api");
        expect((within(search).getByLabelText("Responsible team") as HTMLSelectElement).value).toBe(
          payments.id,
        );
      });

      it("applies a choice at once, keeping the period and the other filters", async () => {
        const user = userEvent.setup();
        navigation.search = "from=2026-09-12&to=2026-09-18&q=checkout";
        api(OVERSIGHT, {
          handler: (request) =>
            route(request).startsWith(`GET ${base}/incidents?state=`)
              ? jsonResponse(200, page([]))
              : undefined,
        });

        inOrganization(<IncidentsView />);

        await user.click(await screen.findByRole("button", { name: "SEV1 Critical" }));

        expect(navigation.replace).toHaveBeenLastCalledWith(
          "/orgs/acme-ops/incidents?from=2026-09-12&to=2026-09-18&q=checkout&severity=SEV1",
          { scroll: false },
        );

        await user.click(screen.getByRole("button", { name: "Clear filters" }));

        expect(navigation.replace).toHaveBeenLastCalledWith(
          "/orgs/acme-ops/incidents?from=2026-09-12&to=2026-09-18",
          { scroll: false },
        );
        // The period's own Clear keeps the filters.
        expect(screen.getByRole("link", { name: "Clear" }).getAttribute("href")).toBe(
          "/orgs/acme-ops/incidents?q=checkout",
        );
      });

      it("searches when the search is submitted, not at every keystroke", async () => {
        const user = userEvent.setup();
        api(OVERSIGHT);

        inOrganization(<IncidentsView />);

        await user.type(await screen.findByLabelText("Search"), "  INC-42 ");
        expect(navigation.replace).not.toHaveBeenCalled();

        await user.keyboard("{Enter}");

        expect(navigation.replace).toHaveBeenLastCalledWith("/orgs/acme-ops/incidents?q=INC-42", {
          scroll: false,
        });
        expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
      });

      it("narrows by where the response stands, one choice at a time", async () => {
        const user = userEvent.setup();
        navigation.search = "response=unclaimed";
        const { requests } = api(OVERSIGHT, {
          handler: (request) =>
            route(request) === `GET ${base}/incidents?state=active&response=unclaimed`
              ? jsonResponse(200, page([incident({ status: "DECLARED" })]))
              : undefined,
        });

        inOrganization(<IncidentsView />);

        expect(
          await screen.findByRole("button", { name: "Needs a responder", pressed: true }),
        ).toBeDefined();
        await waitFor(() =>
          expect(count(requests, `GET ${base}/incidents?state=active&response=unclaimed`)).toBe(1),
        );

        await user.click(screen.getByRole("button", { name: "Ready to resolve" }));
        expect(navigation.replace).toHaveBeenLastCalledWith(
          "/orgs/acme-ops/incidents?response=ready",
          { scroll: false },
        );

        // Pressed again, it no longer applies.
        await user.click(screen.getByRole("button", { name: "Needs a responder" }));
        expect(navigation.replace).toHaveBeenLastCalledWith("/orgs/acme-ops/incidents", {
          scroll: false,
        });
      });

      it("takes a filter that can never apply out of the URL, keeping the rest", async () => {
        navigation.search = `q=checkout&severity=SEV9&response=soon&service=no-such-service&team=${platform.id}`;
        api(OVERSIGHT, {
          handler: (request) =>
            route(request).startsWith(`GET ${base}/incidents?state=`)
              ? jsonResponse(200, page([]))
              : undefined,
        });

        inOrganization(<IncidentsView />);

        await waitFor(() =>
          expect(navigation.replace).toHaveBeenCalledWith(
            `/orgs/acme-ops/incidents?q=checkout&team=${platform.id}`,
            { scroll: false },
          ),
        );
      });
    });

    it("says where response stands now, from the summary the Overview shares", async () => {
      api(OVERSIGHT);

      inOrganization(<IncidentsView />);

      const band = await screen.findByLabelText("Incidents now");
      const figure = (label: string) =>
        within(band).getByText(label).nextElementSibling?.textContent;

      await waitFor(() => expect(figure("Active")).toBe("41 × SEV1"));
      expect(figure("Needs a responder")).toBe("1no one has started");
      expect(figure("Ready to resolve")).toBe("1everyone is done");
      expect(figure("Resolved")).toBe("9in the last 30 days");
    });

    it("opens the resolved tab into the URL, keeping the filters", async () => {
      const user = userEvent.setup();
      navigation.search = "q=checkout";
      api(OVERSIGHT);

      inOrganization(<IncidentsView />);

      await user.click(await screen.findByRole("tab", { name: "Resolved" }));

      expect(navigation.replace).toHaveBeenLastCalledWith(
        "/orgs/acme-ops/incidents?q=checkout&view=resolved",
        { scroll: false },
      );
    });

    it("loads the next page of resolved incidents on request, by the API's cursor", async () => {
      const user = userEvent.setup();
      navigation.search = "view=resolved";
      const { requests } = api(OVERSIGHT, {
        handler: (request) => {
          if (route(request) === `GET ${base}/incidents?state=resolved`) {
            return jsonResponse(
              200,
              page([incident({ number: 9, status: "RESOLVED", resolvedAt: "2026-09-18T13:00:00.000Z" })], "9"),
            );
          }

          if (route(request) === `GET ${base}/incidents?state=resolved&cursor=9`) {
            return jsonResponse(
              200,
              page([incident({ id: "older", number: 3, title: "Old outage", status: "RESOLVED", resolvedAt: "2026-09-18T13:00:00.000Z" })]),
            );
          }

          return undefined;
        },
      });

      inOrganization(<IncidentsView />);

      await user.click(await screen.findByRole("button", { name: "Show more" }));

      expect(await screen.findByText("Old outage")).toBeDefined();
      expect(count(requests, `GET ${base}/incidents?state=resolved&cursor=9`)).toBe(1);
      expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
    });
  });

  describe("declaring", () => {
    it("offers only services in use, names who will be responsible, and sends no team or status", async () => {
      const user = userEvent.setup();
      const { requests } = api(ADMIN, {
        services: [paymentApi, legacyPortal],
        handler: (request) =>
          route(request) === `POST ${base}/incidents`
            ? jsonResponse(201, incident({ number: 43 }))
            : undefined,
      });

      inOrganization(<IncidentsView />);

      await user.click(await screen.findByRole("button", { name: "Declare incident" }));

      const form = screen.getByRole("dialog", { name: "Declare an incident" });
      const service = await within(form).findByLabelText("Affected service");

      expect(within(service).queryByRole("option", { name: "Legacy Portal" })).toBeNull();

      await user.type(within(form).getByLabelText("Title"), "Card payments failing");
      await user.selectOptions(service, paymentApi.id);

      expect(
        within(form).getByText(/Payments will be responsible: they own Payment API, whose criticality is critical/),
      ).toBeDefined();

      // No severity is chosen for the declarer.
      const severity = within(form).getByLabelText("Severity") as HTMLSelectElement;

      expect(severity.value).toBe("");

      await user.selectOptions(severity, "SEV2");
      await user.type(within(form).getByLabelText(/Summary/), "Declines at checkout.");
      await user.click(within(form).getByRole("button", { name: "Declare incident" }));

      await waitFor(() =>
        expect(navigation.push).toHaveBeenCalledWith("/orgs/acme-ops/incidents/43"),
      );
      expect(requests.find((r) => route(r) === `POST ${base}/incidents`)?.body).toEqual({
        title: "Card payments failing",
        summary: "Declines at checkout.",
        serviceId: paymentApi.id,
        severity: "SEV2",
      });
    });

    it("declares in a dialog that Cancel closes without declaring anything", async () => {
      const user = userEvent.setup();
      const { requests } = api(ADMIN);

      inOrganization(<IncidentsView />);

      await user.click(await screen.findByRole("button", { name: "Declare incident" }));

      const form = screen.getByRole("dialog", { name: "Declare an incident" });

      await user.type(await within(form).findByLabelText("Title"), "Slow checkout");
      await user.click(within(form).getByRole("button", { name: "Cancel" }));

      expect(screen.queryByRole("dialog", { name: "Declare an incident" })).toBeNull();
      expect(requests.some((r) => route(r) === `POST ${base}/incidents`)).toBe(false);
    });

    it("explains a service archived meanwhile, and refreshes the services", async () => {
      const user = userEvent.setup();
      const { requests } = api(ADMIN, {
        handler: (request) =>
          route(request) === `POST ${base}/incidents`
            ? apiError(409, "SERVICE_ARCHIVED")
            : undefined,
      });

      inOrganization(<IncidentsView />);

      await user.click(await screen.findByRole("button", { name: "Declare incident" }));

      const form = screen.getByRole("dialog", { name: "Declare an incident" });
      const declare = within(form).getByRole("button", { name: "Declare incident" });

      // Held back, and saying why, until every required field is filled.
      expect((declare as HTMLButtonElement).disabled).toBe(true);
      expect(
        within(form).getByText(
          "Fill in Title, Affected service and Severity to continue.",
        ),
      ).toBeDefined();

      await user.type(within(form).getByLabelText("Title"), "Card payments failing");
      await user.selectOptions(await within(form).findByLabelText("Affected service"), paymentApi.id);
      await user.selectOptions(within(form).getByLabelText("Severity"), "SEV2");

      await waitFor(() => expect((declare as HTMLButtonElement).disabled).toBe(false));
      expect(within(form).queryByText(/to continue/)).toBeNull();

      await user.click(declare);

      expect(await screen.findByText(/no longer available for new incidents/)).toBeDefined();
      await waitFor(() => expect(count(requests, `GET ${base}/services`)).toBeGreaterThan(1));
    });
  });

  describe("an incident", () => {
    beforeEach(() => {
      navigation.params = { orgSlug: "acme-ops", incidentNumber: "42" };
    });

    /** The section a heading names. */
    const sectionOf = async (name: string | RegExp) =>
      (await screen.findByRole("heading", { name })).closest(
        "section",
      ) as HTMLElement;

    /** A glance tile's figure and note, by its label. */
    const tile = (label: string) =>
      within(screen.getByLabelText("INC-42 at a glance"))
        .getByText(label)
        .nextElementSibling?.textContent;

    /** Opens the Admin's drawer, and answers it. */
    const openManage = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(await screen.findByRole("button", { name: "Manage incident" }));

      return screen.findByRole("dialog", { name: "Manage incident" });
    };

    it("shows what the record holds", async () => {
      api(READ_ONLY);

      inOrganization(<IncidentDetail />);

      expect(
        await screen.findByRole("heading", { level: 1, name: "INC-42 Card payments failing" }),
      ).toBeDefined();
      expect(
        within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByText("INC-42"),
      ).toBeDefined();
      expect(screen.getByText("Card declines since 14:02.")).toBeDefined();
      expect(
        screen.getByRole("link", { name: "Payment API" }).getAttribute("href"),
      ).toBe("/orgs/acme-ops/services/payment-api");
      expect(
        screen.getByRole("link", { name: "Payments" }).getAttribute("href"),
      ).toBe("/orgs/acme-ops/teams/payments");
      const details = screen.getByLabelText("Incident details");

      expect(within(details).getByText("Critical service")).toBeDefined();
      expect(details.textContent).toMatch(/Open for.+since /);
      // Who declared it, on the lifecycle's first step.
      expect(
        within(screen.getByRole("list", { name: "Lifecycle" })).getByText(/Ada Lovelace/),
      ).toBeDefined();
      // Read-only: nothing to change.
      expect(screen.queryByRole("button", { name: "Resolve incident" })).toBeNull();
      expect(screen.queryByLabelText("Status")).toBeNull();
    });

    describe("as the admin", () => {
      it("coordinates a declared incident: awaiting the team, with no investigation to start and nothing to resolve", async () => {
        api(ADMIN, { detail: incident({ status: "DECLARED" }) });

        inOrganization(<IncidentDetail />);

        const response = await sectionOf("Response and resolution");

        expect(within(response).getByText("Waiting for Payments to start.")).toBeDefined();
        expect(
          within(response).getByText("Payments has not started investigating yet."),
        ).toBeDefined();
        // Nobody has started, so nothing to wait on: no locked Resolve either.
        expect(tile("First response")).toBe("—");
        for (const name of ["Start investigation", "Start investigating", "Resolve incident"]) {
          expect(screen.queryByRole("button", { name })).toBeNull();
        }
        expect(screen.queryByRole("heading", { name: "Your response" })).toBeNull();
        // The admin still posts updates, without responding.
        expect(within(response).getByLabelText("Post an update")).toBeDefined();
      });

      it("sees who is investigating, and why it cannot be resolved yet", async () => {
        api(ADMIN, { detail: incident({ responders: [responder(daniel), responder(sam)] }) });

        inOrganization(<IncidentDetail />);

        const response = await sectionOf("Response and resolution");

        expect(within(response).getByText("Not ready to resolve yet.")).toBeDefined();
        expect(
          within(response).getByText(
            "Daniel Okafor and Sam Okafor are still investigating. Resolve opens when everyone who started has completed.",
          ),
        ).toBeDefined();
        expect(tile("Investigating")).toBe("2");
        expect(tile("Completed")).toBe("0");
        // Everyone on the team, and where each stands — once the team is here.
        await waitFor(() =>
          expect(
            within(within(response).getByRole("list", { name: "Payments" }))
              .getAllByRole("listitem")
              .map((item) => item.textContent),
          ).toEqual([
            // The caller first: the fixtures put the Admin on Payments.
            "ALYounot joined",
            expect.stringMatching(/^DODaniel Okaforinvestigating /),
            expect.stringMatching(/^SOSam Okaforinvestigating /),
          ]),
        );
        // Resolve is shown, locked, with who it waits on.
        const resolve = within(response).getByRole("button", { name: "Resolve incident" });

        expect((resolve as HTMLButtonElement).disabled).toBe(true);
        expect(
          document.getElementById(resolve.getAttribute("aria-describedby")!)?.textContent,
        ).toBe("waiting on 2 responders");
      });

      it("sees a mixed response, still held by whoever is investigating", async () => {
        api(ADMIN, {
          detail: incident({ responders: [responder(daniel), responder(sam, "COMPLETED")] }),
        });

        inOrganization(<IncidentDetail />);

        const response = await sectionOf("Response and resolution");

        expect(tile("Investigating")).toBe("1");
        expect(tile("Completed")).toBe("1");
        expect(within(response).getByText("done")).toBeDefined();
        expect(
          within(response).getByText(
            "Daniel Okafor is still investigating. Resolve opens when everyone who started has completed.",
          ),
        ).toBeDefined();
        expect(
          (within(response).getByRole("button", { name: "Resolve incident" }) as HTMLButtonElement)
            .disabled,
        ).toBe(true);
      });

      it("resolves once response work is complete, after confirmation", async () => {
        const user = userEvent.setup();
        const { requests } = api(ADMIN, {
          detail: incident({
            responders: [responder(daniel, "COMPLETED"), responder(sam, "COMPLETED")],
          }),
          handler: (request) =>
            route(request) === `PATCH ${base}/incidents/42`
              ? jsonResponse(
                  200,
                  incident({
                    status: "RESOLVED",
                    resolvedAt: "2026-09-18T13:00:00.000Z",
                    responders: [responder(daniel, "COMPLETED"), responder(sam, "COMPLETED")],
                  }),
                )
              : undefined,
        });

        inOrganization(<IncidentDetail />);

        const response = await sectionOf("Response and resolution");

        expect(
          within(response).getByText("Everyone has completed. Ready to resolve."),
        ).toBeDefined();
        expect(
          within(response).getByText(/^2 responders completed their response\./),
        ).toBeDefined();

        await user.click(within(response).getByRole("button", { name: "Resolve incident" }));
        expect(requests.some((r) => r.method === "PATCH")).toBe(false);
        await user.type(
          within(response).getByLabelText("How was it resolved?"),
          "  Rolled back the 12:00 deploy.  ",
        );
        await user.click(within(response).getByRole("button", { name: "Resolve incident" }));

        expect(
          await screen.findByText(/kept as it is; if it returns, declare a new incident/),
        ).toBeDefined();
        expect(requests.find((r) => route(r) === `PATCH ${base}/incidents/42`)?.body).toEqual({
          status: "RESOLVED",
          resolution: "Rolled back the 12:00 deploy.",
        });
      });

      it("asks how it was resolved before it can be sent", async () => {
        const user = userEvent.setup();
        const { requests } = api(ADMIN, {
          detail: incident({ responders: [responder(daniel, "COMPLETED")] }),
        });

        inOrganization(<IncidentDetail />);

        await user.click(await screen.findByRole("button", { name: "Resolve incident" }));
        // Blank, or only spaces: not an answer, so not sendable.
        await user.type(screen.getByLabelText("How was it resolved?"), "   ");

        const resolve = screen.getByRole("button", { name: "Resolve incident" });

        await waitFor(() => expect((resolve as HTMLButtonElement).disabled).toBe(true));
        expect(
          screen.getByText("Fill in How was it resolved? to continue."),
        ).toBeDefined();
        expect(resolve.getAttribute("aria-describedby")).toBeTruthy();

        await user.click(resolve);
        expect(requests.some((r) => r.method === "PATCH")).toBe(false);
      });

      it("explains a resolution refused because someone started investigating meanwhile, and refetches", async () => {
        const user = userEvent.setup();
        const { requests } = api(ADMIN, {
          detail: incident({ responders: [responder(daniel, "COMPLETED")] }),
          handler: (request) =>
            route(request) === `PATCH ${base}/incidents/42`
              ? apiError(409, "RESPONDERS_STILL_INVESTIGATING")
              : undefined,
        });

        inOrganization(<IncidentDetail />);

        await user.click(await screen.findByRole("button", { name: "Resolve incident" }));
        await user.type(screen.getByLabelText("How was it resolved?"), "Rolled back.");
        await user.click(screen.getByRole("button", { name: "Resolve incident" }));

        expect(await screen.findByText(/Someone started investigating meanwhile/)).toBeDefined();
        await waitFor(() =>
          expect(count(requests, `GET ${base}/incidents/42`)).toBeGreaterThan(1),
        );
      });

      it("manages the incident from a drawer, and has no personal response", async () => {
        const user = userEvent.setup();
        api(ADMIN);

        inOrganization(<IncidentDetail />);

        // Not on the page until asked for.
        expect(await screen.findByRole("heading", { name: "Response and resolution" })).toBeDefined();
        expect(screen.queryByLabelText("Severity")).toBeNull();

        const drawer = await openManage(user);

        for (const heading of ["Severity and responsible team", "Title and summary"]) {
          expect(within(drawer).getByRole("heading", { name: heading })).toBeDefined();
        }

        await user.click(within(drawer).getByRole("button", { name: "Close" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(screen.queryByRole("heading", { name: "Your response" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Complete my response" })).toBeNull();
      });

      it("sends only what changed in severity and team, which has no status to choose", async () => {
        const user = userEvent.setup();
        const { requests } = api(ADMIN, {
          handler: (request) =>
            route(request) === `PATCH ${base}/incidents/42`
              ? jsonResponse(200, incident({ severity: "SEV2", team: { id: platform.id, name: "Platform", slug: "platform" } }))
              : undefined,
        });

        inOrganization(<IncidentDetail />);

        await openManage(user);
        const form = await sectionOf("Severity and responsible team");

        expect(within(form).queryByLabelText("Status")).toBeNull();

        await user.selectOptions(within(form).getByLabelText("Severity"), "SEV2");
        await user.selectOptions(await within(form).findByLabelText("Responsible team"), platform.id);
        await user.click(within(form).getByRole("button", { name: "Save" }));

        await waitFor(() =>
          expect(requests.find((r) => route(r) === `PATCH ${base}/incidents/42`)?.body).toEqual({
            severity: "SEV2",
            teamId: platform.id,
          }),
        );
      });

      it("explains a change refused because someone resolved it meanwhile, and refetches it", async () => {
        const user = userEvent.setup();
        const { requests } = api(ADMIN, {
          handler: (request) =>
            route(request) === `PATCH ${base}/incidents/42`
              ? apiError(409, "INCIDENT_RESOLVED")
              : undefined,
        });

        inOrganization(<IncidentDetail />);

        await openManage(user);
        const form = await sectionOf("Severity and responsible team");

        await user.selectOptions(within(form).getByLabelText("Severity"), "SEV2");
        await user.click(within(form).getByRole("button", { name: "Save" }));

        expect(await screen.findByText(/resolved by someone else/)).toBeDefined();
        await waitFor(() =>
          expect(count(requests, `GET ${base}/incidents/42`)).toBeGreaterThan(1),
        );
      });
    });

    describe("as a member of the responsible team", () => {
      it("starts investigating, and the page becomes their response", async () => {
        const user = userEvent.setup();
        const started = incident({ responders: [responder(ada)] });
        const { requests } = api(MEMBER, {
          detail: incident({ status: "DECLARED" }),
          handler: (request) =>
            route(request) === `POST ${base}/incidents/42/responders/me`
              ? jsonResponse(200, started)
              : undefined,
        });

        inOrganization(<IncidentDetail />);

        const yours = await sectionOf("Your response");

        expect(
          within(yours).getByText("Nobody on Payments has started yet."),
        ).toBeDefined();
        expect(
          within(within(yours).getByRole("list", { name: "How a response goes" }))
            .getAllByRole("listitem")
            .map((step) => step.textContent),
        ).toEqual([
          expect.stringMatching(/^1Start/),
          expect.stringMatching(/^2Post updates/),
          expect.stringMatching(/^3Complete your part/),
        ]);
        // Starting comes first: no composer yet.
        expect(screen.queryByLabelText("Post an update")).toBeNull();

        await user.click(within(yours).getByRole("button", { name: "Start investigating" }));

        // The page becomes their response: posting is right there, in it.
        const working = await sectionOf("Your response");

        expect(await within(working).findByText(/You're investigating/)).toBeDefined();
        expect(within(working).getByLabelText("Post an update")).toBeDefined();
        expect(
          within(working).getByRole("button", { name: "Complete my response" }),
        ).toBeDefined();
        expect(within(await sectionOf(/^Timeline/)).queryByLabelText("Post an update")).toBeNull();
        expect(count(requests, `POST ${base}/incidents/42/responders/me`)).toBe(1);
        // The timeline refetches: starting was recorded there.
        await waitFor(() =>
          expect(count(requests, `GET ${base}/incidents/42/timeline`)).toBeGreaterThan(1),
        );
      });

      it("marks their response complete, which takes the response controls away and resolves nothing", async () => {
        const user = userEvent.setup();
        const { requests } = api(MEMBER, {
          detail: incident({ responders: [responder(ada), responder(daniel)] }),
          handler: (request) =>
            route(request) === `POST ${base}/incidents/42/responders/me/complete`
              ? jsonResponse(
                  200,
                  incident({ responders: [responder(ada, "COMPLETED"), responder(daniel)] }),
                )
              : undefined,
        });

        inOrganization(<IncidentDetail />);

        const yours = await sectionOf("Your response");

        expect(screen.getByLabelText("Post an update")).toBeDefined();

        await user.click(within(yours).getByRole("button", { name: "Complete my response" }));

        const done = await sectionOf("Your response");

        expect(await within(done).findByText(/You completed your part/)).toBeDefined();
        // Daniel is still investigating: the incident stays with him.
        expect(
          within(done).getByText(/Daniel Okafor is still investigating; the Admin resolves once no one is\./),
        ).toBeDefined();
        expect(screen.queryByLabelText("Post an update")).toBeNull();
        expect(screen.queryByRole("button", { name: "Complete my response" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Start investigating" })).toBeNull();
        expect(requests.some((r) => r.method === "PATCH")).toBe(false);
      });

      it("explains a start refused because the incident was reassigned meanwhile, and refetches it and its team", async () => {
        const user = userEvent.setup();
        const { requests } = api(MEMBER, {
          handler: (request) =>
            route(request) === `POST ${base}/incidents/42/responders/me`
              ? apiError(403, "NOT_ON_RESPONSIBLE_TEAM")
              : undefined,
        });

        inOrganization(<IncidentDetail />);

        await user.click(await screen.findByRole("button", { name: "Start investigating" }));

        expect(await screen.findByText(/no longer your team's to respond to/)).toBeDefined();
        await waitFor(() => {
          expect(count(requests, `GET ${base}/incidents/42`)).toBeGreaterThan(1);
          expect(count(requests, `GET ${base}/teams/${payments.id}/members`)).toBeGreaterThan(1);
        });
      });

      it("posts an operational update while investigating, and shows it on the timeline", async () => {
        const user = userEvent.setup();
        let timeline: IncidentActivityResponse[] = [];
        const posted = activity({
          actor: { id: currentUser.id, name: "Ada Lovelace" },
          message: "Connection pool exhaustion identified.",
        });
        const { requests } = api(MEMBER, {
          detail: incident({ responders: [responder(ada)] }),
          handler: (request) => {
            if (route(request) === `GET ${base}/incidents/42/timeline`) {
              return jsonResponse(200, timeline);
            }
            if (route(request) === `POST ${base}/incidents/42/updates`) {
              timeline = [posted];
              return jsonResponse(201, posted);
            }
            return undefined;
          },
        });

        inOrganization(<IncidentDetail />);

        const composer = await screen.findByLabelText("Post an update");
        expect(await screen.findByText("No activity recorded yet.")).toBeDefined();
        expect(
          (screen.getByRole("button", { name: "Post update" }) as HTMLButtonElement).disabled,
        ).toBe(true);

        await user.type(composer, "Connection pool exhaustion identified.");
        await user.click(screen.getByRole("button", { name: "Post update" }));

        expect(
          await screen.findByText("Connection pool exhaustion identified."),
        ).toBeDefined();
        expect(
          requests.find((r) => route(r) === `POST ${base}/incidents/42/updates`)?.body,
        ).toEqual({ message: "Connection pool exhaustion identified." });
        expect((composer as HTMLTextAreaElement).value).toBe("");
      });

      it("explains an update refused because their response was already complete, and refetches", async () => {
        const user = userEvent.setup();
        const { requests } = api(MEMBER, {
          detail: incident({ responders: [responder(ada)] }),
          handler: (request) =>
            route(request) === `POST ${base}/incidents/42/updates`
              ? apiError(409, "RESPONSE_ALREADY_COMPLETED")
              : undefined,
        });

        inOrganization(<IncidentDetail />);

        await user.type(await screen.findByLabelText("Post an update"), "One more thing.");
        await user.click(screen.getByRole("button", { name: "Post update" }));

        expect(await screen.findByText(/already complete, so you cannot post more updates/)).toBeDefined();
        await waitFor(() =>
          expect(count(requests, `GET ${base}/incidents/42`)).toBeGreaterThan(1),
        );
      });

      it("explains an update refused because the incident was resolved meanwhile", async () => {
        const user = userEvent.setup();
        const { requests } = api(MEMBER, {
          detail: incident({ responders: [responder(ada)] }),
          handler: (request) =>
            route(request) === `POST ${base}/incidents/42/updates`
              ? apiError(409, "INCIDENT_RESOLVED")
              : undefined,
        });

        inOrganization(<IncidentDetail />);

        await user.type(await screen.findByLabelText("Post an update"), "Rolled back.");
        await user.click(screen.getByRole("button", { name: "Post update" }));

        expect(await screen.findByText(/updates can no longer be posted/)).toBeDefined();
        await waitFor(() =>
          expect(count(requests, `GET ${base}/incidents/42`)).toBeGreaterThan(1),
        );
      });

      it("has none of the admin's controls", async () => {
        api(MEMBER);

        inOrganization(<IncidentDetail />);

        expect(await screen.findByRole("heading", { name: "Your response" })).toBeDefined();
        expect(screen.queryByRole("button", { name: "Manage incident" })).toBeNull();
        for (const heading of ["Severity and responsible team", "Title and summary"]) {
          expect(screen.queryByRole("heading", { name: heading })).toBeNull();
        }
        expect(screen.queryByRole("button", { name: "Resolve incident" })).toBeNull();
        expect(screen.queryByLabelText("Responsible team")).toBeNull();
      });
    });

    it("keeps a responder's controls after their incident is reassigned to another team", async () => {
      // Now Platform's, and the caller is not on Platform — but they started
      // investigating while Payments was responsible.
      api(MEMBER, {
        detail: incident({
          team: { id: platform.id, name: "Platform", slug: "platform" },
          responders: [responder(ada)],
        }),
        teamMembers: [onTeam(daniel)],
      });

      inOrganization(<IncidentDetail />);

      const yours = await sectionOf("Your response");

      expect(within(yours).getByText(/You're investigating/)).toBeDefined();
      expect(
        within(yours).getByRole("button", { name: "Complete my response" }),
      ).toBeDefined();
      expect(within(yours).getByLabelText("Post an update")).toBeDefined();
    });

    it("lets a member of another team follow the incident, with nothing to do", async () => {
      api(MEMBER, {
        teamMembers: [onTeam(daniel)],
        detail: incident({ responders: [responder(daniel)] }),
        timeline: [activity()],
      });

      inOrganization(<IncidentDetail />);

      const response = await sectionOf("Response");

      expect(within(response).getByText("Response in progress.")).toBeDefined();
      expect(within(response).getByText("1 investigating · 0 complete")).toBeDefined();
      expect(
        await screen.findByText("Investigating elevated database latency."),
      ).toBeDefined();
      expect(screen.queryByRole("heading", { name: "Your response" })).toBeNull();
      for (const name of ["Start investigating", "Complete my response", "Resolve incident"]) {
        expect(screen.queryByRole("button", { name })).toBeNull();
      }
      expect(screen.queryByLabelText("Post an update")).toBeNull();
      expect(screen.queryByRole("button", { name: "Manage incident" })).toBeNull();
      // Following is not an error.
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it.each([
      ["the admin", ADMIN],
      ["a responder", MEMBER],
    ])("keeps a resolved incident read-only for %s, showing how the response ended", async (_, permissions) => {
      api(permissions, {
        detail: incident({
          status: "RESOLVED",
          resolvedAt: "2026-09-18T13:00:00.000Z",
          responders: [responder(ada, "COMPLETED"), responder(daniel, "COMPLETED")],
        }),
        timeline: [
          activity(),
          activity({
            id: "0199a1b2-c3d4-7000-8000-000000000104",
            type: "STATUS_CHANGED",
            message: null,
            fromValue: "INVESTIGATING",
            toValue: "RESOLVED",
          }),
        ],
      });

      inOrganization(<IncidentDetail />);

      // Everyone sees one ending: the Resolution, its figures, and who
      // responded — no role panel, since nothing is left to do on it.
      const resolution = await sectionOf("Resolution");

      expect(tile("Responders")).toBe("2");
      expect(within(resolution).getAllByText("done")).toHaveLength(2);
      for (const heading of ["Response and resolution", "Your response", "Response"]) {
        expect(screen.queryByRole("heading", { name: heading })).toBeNull();
      }
      // A responder finds their own part in the team, as "You".
      if (permissions !== ADMIN) {
        expect(
          within(within(resolution).getByRole("list", { name: "Payments" }))
            .getAllByRole("listitem")[0]?.textContent,
        ).toMatch(/^ALYou/);
      }
      expect(within(screen.getByLabelText("Incident details")).getByText("Lasted")).toBeDefined();

      const timeline = await sectionOf(/^Timeline/);
      const entries = await within(timeline).findAllByRole("listitem");

      // Newest first: the resolution heads it.
      expect(entries[0]?.textContent).toMatch(/Resolved the incident/);
      // Resolved before notes were required: said, not left as a gap.
      expect(
        within(await sectionOf("Resolution")).getByText(
          "Resolved before resolution notes were recorded.",
        ),
      ).toBeDefined();
      for (const name of [
        "Start investigating",
        "Complete my response",
        "Resolve incident",
      ]) {
        expect(screen.queryByRole("button", { name })).toBeNull();
      }
      expect(screen.queryByLabelText("Post an update")).toBeNull();
      expect(screen.queryByRole("button", { name: "Manage incident" })).toBeNull();
    });

    it("shows how a resolved incident ended, on the incident and on its timeline", async () => {
      const note = "Rolled back the 12:00 deploy; error rates back to baseline.";

      api(READ_ONLY, {
        detail: incident({
          status: "RESOLVED",
          resolvedAt: "2026-09-18T13:00:00.000Z",
          resolution: note,
          responders: [responder(daniel, "COMPLETED")],
        }),
        timeline: [
          activity({
            id: "0199a1b2-c3d4-7000-8000-000000000104",
            type: "STATUS_CHANGED",
            message: note,
            fromValue: "INVESTIGATING",
            toValue: "RESOLVED",
            actor: { id: currentUser.id, name: "Ada Lovelace" },
          }),
        ],
      });

      inOrganization(<IncidentDetail />);

      expect(within(await sectionOf("Resolution")).getByText(note)).toBeDefined();

      const timeline = await sectionOf(/^Timeline/);
      const [entry] = await within(timeline).findAllByRole("listitem");

      expect(entry.textContent).toMatch(
        /You\s*Resolved the incident.*ago.*Rolled back the 12:00 deploy/,
      );
    });

    it("tells the story on the timeline, newest first, with nothing to post for a reader", async () => {
      api(READ_ONLY, {
        timeline: [
          activity({
            id: "0199a1b2-c3d4-7000-8000-000000000100",
            type: "DECLARED",
            message: null,
            toValue: "SEV2",
            actor: { id: currentUser.id, name: "Ada Lovelace" },
            createdAt: "2026-09-18T12:00:00.000Z",
          }),
          activity({
            id: "0199a1b2-c3d4-7000-8000-000000000110",
            type: "RESPONSE_STARTED",
            message: null,
          }),
          activity({
            id: "0199a1b2-c3d4-7000-8000-000000000103",
            type: "STATUS_CHANGED",
            message: null,
            fromValue: "DECLARED",
            toValue: "INVESTIGATING",
          }),
          activity(),
          activity({
            id: "0199a1b2-c3d4-7000-8000-000000000102",
            type: "SEVERITY_CHANGED",
            message: null,
            fromValue: "SEV2",
            toValue: "SEV1",
          }),
          activity({
            id: "0199a1b2-c3d4-7000-8000-000000000109",
            type: "TEAM_CHANGED",
            message: null,
            fromValue: "Payments",
            toValue: "Platform",
            actor: { id: currentUser.id, name: "Ada Lovelace" },
          }),
          activity({
            id: "0199a1b2-c3d4-7000-8000-000000000111",
            type: "RESPONSE_COMPLETED",
            message: null,
          }),
        ],
      });

      inOrganization(<IncidentDetail />);

      const timeline = await sectionOf(/^Timeline/);
      const entries = await within(timeline).findAllByRole("listitem");
      // Who did what — the row's first line without its time — then what
      // they wrote, if anything.
      const said = (entry: HTMLElement) => {
        const [head, body] = entry.querySelectorAll("p");

        return `${head?.querySelector("span")?.textContent ?? ""}${body?.textContent ?? ""}`
          .replace(/\s+/g, " ")
          .trim();
      };

      expect(entries.map(said)).toEqual([
        "Daniel Okafor completed their response",
        // The caller's own entries are theirs: "You".
        "You reassigned the incident from Payments to Platform",
        expect.stringMatching(/^Daniel Okafor changed severity SEV2.*→.*SEV1/),
        "Daniel Okafor posted an updateInvestigating elevated database latency.",
        "Daniel Okafor moved the incident to Investigating",
        "Daniel Okafor started investigating",
        expect.stringMatching(/^You declared the incident at SEV2/),
      ]);
      expect(within(timeline).queryByLabelText("Post an update")).toBeNull();
    });

    it("shows a change recorded under a retired status by its word", async () => {
      api(READ_ONLY, {
        timeline: [
          activity({
            id: "0199a1b2-c3d4-7000-8000-000000000105",
            type: "STATUS_CHANGED",
            message: null,
            fromValue: "IDENTIFIED",
            toValue: "MONITORING",
          }),
        ],
      });

      inOrganization(<IncidentDetail />);

      const timeline = await sectionOf(/^Timeline/);
      const [entry] = await within(timeline).findAllByRole("listitem");

      expect(entry.textContent).toMatch(/changed status Identified.*→.*Monitoring.*ago$/);
    });

    describe("live", () => {
      it("asks for an active incident and its timeline again while it is open", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
          const { requests } = api(READ_ONLY);

          inOrganization(<IncidentDetail />);

          expect(await screen.findByText("Live · updated just now")).toBeDefined();
          const incidentAsks = count(requests, `GET ${base}/incidents/42`);
          const timelineAsks = count(requests, `GET ${base}/incidents/42/timeline`);

          await vi.advanceTimersByTimeAsync(LIVE_POLL_MS);

          await waitFor(() => {
            expect(count(requests, `GET ${base}/incidents/42`)).toBeGreaterThan(incidentAsks);
            expect(count(requests, `GET ${base}/incidents/42/timeline`)).toBeGreaterThan(
              timelineAsks,
            );
          });
        } finally {
          vi.useRealTimers();
        }
      });

      it("leaves a resolved incident as it is: nothing asked again, nothing said to be live", async () => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        try {
          const { requests } = api(READ_ONLY, {
            detail: incident({ status: "RESOLVED", resolvedAt: "2026-09-18T13:00:00.000Z" }),
          });

          inOrganization(<IncidentDetail />);

          await screen.findByRole("heading", { name: "Resolution" });
          const asks = count(requests, `GET ${base}/incidents/42`);

          await vi.advanceTimersByTimeAsync(LIVE_POLL_MS * 2);

          expect(count(requests, `GET ${base}/incidents/42`)).toBe(asks);
          expect(screen.queryByText(/Live · updated/)).toBeNull();
        } finally {
          vi.useRealTimers();
        }
      });

      it("marks what others added since the page opened, and not the caller's own", async () => {
        const user = userEvent.setup();
        let timeline: IncidentActivityResponse[] = [];
        const { requests } = api(MEMBER, {
          detail: incident({ status: "DECLARED" }),
          handler: (request) => {
            if (route(request) === `GET ${base}/incidents/42/timeline`) {
              return jsonResponse(200, timeline);
            }
            if (route(request) === `POST ${base}/incidents/42/responders/me`) {
              // Meanwhile Daniel posted; the caller's own start is theirs.
              timeline = [
                activity(),
                activity({
                  id: "0199a1b2-c3d4-7000-8000-000000000120",
                  type: "RESPONSE_STARTED",
                  message: null,
                  actor: { id: currentUser.id, name: "Ada Lovelace" },
                  createdAt: "2026-09-18T12:06:00.000Z",
                }),
              ];
              return jsonResponse(200, incident({ responders: [responder(ada)] }));
            }
            return undefined;
          },
        });

        inOrganization(<IncidentDetail />);

        expect(await screen.findByText("No activity recorded yet.")).toBeDefined();
        await user.click(await screen.findByRole("button", { name: "Start investigating" }));

        const pill = await screen.findByRole("button", { name: "1 new update" });
        const timelineCard = await sectionOf(/^Timeline/);

        await waitFor(() =>
          expect(count(requests, `GET ${base}/incidents/42/timeline`)).toBeGreaterThan(1),
        );
        // Only Daniel's entry is new.
        expect(within(timelineCard).getAllByText("New")).toHaveLength(1);

        await user.click(pill);

        expect(screen.queryByRole("button", { name: /new update/ })).toBeNull();
        // Still marked, so it can be found once scrolled to.
        expect(within(timelineCard).getAllByText("New")).toHaveLength(1);
      });
    });

    it("answers an unknown number with a not-found page", async () => {
      navigation.params = { orgSlug: "acme-ops", incidentNumber: "999" };
      api(READ_ONLY);

      inOrganization(<IncidentDetail />);

      expect(
        await screen.findByRole("heading", { name: "Incident not found" }),
      ).toBeDefined();
    });

    it("answers a number that cannot be one without asking the API", async () => {
      navigation.params = { orgSlug: "acme-ops", incidentNumber: "INC-42" };
      const { requests } = api(READ_ONLY);

      inOrganization(<IncidentDetail />);

      expect(
        await screen.findByRole("heading", { name: "Incident not found" }),
      ).toBeDefined();
      expect(requests.some((r) => r.path.includes("/incidents/"))).toBe(false);
    });
  });

  describe("a member's incidents", () => {
    /** Counts for one part: by team and severity, as the API sums them. */
    const tally = (
      byTeam: { teamId: string; count: number }[],
      bySeverity: Partial<Record<"SEV1" | "SEV2" | "SEV3" | "SEV4", number>> = {},
    ) => ({
      total: byTeam.reduce((sum, { count }) => sum + count, 0),
      byTeam,
      bySeverity: { SEV1: 0, SEV2: 0, SEV3: 0, SEV4: 0, ...bySeverity },
    });

    const parts = {
      "needs-you": tally(
        [
          { teamId: payments.id, count: 1 },
          { teamId: platform.id, count: 1 },
        ],
        { SEV1: 1, SEV3: 1 },
      ),
      investigating: tally([{ teamId: payments.id, count: 1 }], { SEV2: 1 }),
      completed: tally([]),
      active: tally([{ teamId: payments.id, count: 3 }], { SEV1: 1, SEV2: 1, SEV3: 1 }),
    };

    /** Daniel is on it; the caller has not started. */
    const waiting = incident({ responders: [responder(daniel)] });
    /** The caller is investigating. */
    const mine = incident({
      id: "0199a1b2-c3d4-7000-8000-0000000000f2",
      number: 43,
      title: "Refunds delayed",
      severity: "SEV2",
      responders: [responder(ada)],
    });

    /** The member's API: their parts, and each list by the part it asks for. */
    const memberApi = (lists: Partial<Record<string, IncidentResponse[]>> = {}) =>
      api(MEMBER, {
        handler: (request) => {
          if (route(request) === `GET ${base}/incidents/parts`) {
            return jsonResponse(200, parts);
          }
          const [path, query] = request.path.split("?");

          if (request.method === "GET" && path === `${base}/incidents` && query) {
            const params = new URLSearchParams(query);
            const key = params.get("part") ?? params.get("state") ?? "";

            return jsonResponse(200, page(lists[key] ?? []));
          }

          return undefined;
        },
      });

    it("opens on what needs them, counted by part, with no organization-wide figures or pickers", async () => {
      const { requests } = memberApi({ "needs-you": [waiting] });

      inOrganization(<IncidentsView />);

      const table = await screen.findByRole("table", { name: "Needs you" });
      const parts = screen.getByRole("group", { name: "Your part" });

      expect(
        within(parts).getByRole("button", { name: /Needs you\s*2/, pressed: true }),
      ).toBeDefined();
      expect(within(parts).getByRole("button", { name: /You're investigating\s*1/ })).toBeDefined();
      expect(within(parts).getByRole("button", { name: /All active\s*3/ })).toBeDefined();
      // The member's row waits on them: Respond opens it, where starting lives.
      expect(
        within(table).getByRole("link", { name: "Respond INC-42" }).getAttribute("href"),
      ).toBe("/orgs/acme-ops/incidents/42");
      expect(within(table).queryByRole("columnheader", { name: "Status" })).toBeNull();
      expect(within(table).getByRole("columnheader", { name: "Team response" })).toBeDefined();

      expect(
        requests.some(
          (request) => request.path === `${base}/incidents?state=active&part=needs-you`,
        ),
      ).toBe(true);
      // The Admin's figures and pickers are not a member's: nothing refused.
      expect(requests.some((request) => request.path.includes("/incidents/summary"))).toBe(
        false,
      );
      expect(screen.queryByLabelText("Incidents now")).toBeNull();
      expect(screen.queryByRole("combobox", { name: "Service" })).toBeNull();
      expect(screen.queryByRole("combobox", { name: "Responsible team" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Declare incident" })).toBeNull();
    });

    it("counts each team and severity pill for the chosen part, and filters by one at once", async () => {
      const user = userEvent.setup();
      memberApi({ "needs-you": [waiting] });

      inOrganization(<IncidentsView />);

      await screen.findByRole("table", { name: "Needs you" });
      const teams = screen.getByRole("group", { name: "Team" });
      const severities = screen.getByRole("group", { name: "Severity" });

      expect(
        within(teams).getByRole("button", { name: /All your teams\s*2/, pressed: true }),
      ).toBeDefined();
      expect(within(teams).getByRole("button", { name: /Platform\s*1/ })).toBeDefined();
      expect(within(severities).getByRole("button", { name: /SEV3.*1/ })).toBeDefined();
      expect(within(severities).getByRole("button", { name: /SEV2.*0/ })).toBeDefined();

      await user.click(within(teams).getByRole("button", { name: /Platform/ }));

      expect(navigation.replace).toHaveBeenLastCalledWith(
        `/orgs/acme-ops/incidents?team=${platform.id}`,
        { scroll: false },
      );
    });

    it("moves between parts in the URL, and offers what each row needs from them", async () => {
      const user = userEvent.setup();
      navigation.search = "view=investigating";
      const { requests } = memberApi({ investigating: [mine] });

      inOrganization(<IncidentsView />);

      const table = await screen.findByRole("table", { name: "You're investigating" });

      expect(
        requests.some(
          (request) => request.path === `${base}/incidents?state=active&part=investigating`,
        ),
      ).toBe(true);
      expect(within(table).getByRole("link", { name: "Post update INC-43" })).toBeDefined();
      expect(within(table).getByText(/you're investigating/)).toBeDefined();
      // The pills count the chosen part.
      expect(
        within(screen.getByRole("group", { name: "Severity" })).getByRole("button", {
          name: /SEV2.*1/,
        }),
      ).toBeDefined();

      await user.click(screen.getByRole("button", { name: /Needs you/ }));

      // Needs you is where the page starts, so it takes no parameter.
      expect(navigation.replace).toHaveBeenLastCalledWith("/orgs/acme-ops/incidents", {
        scroll: false,
      });
    });

    it("reads the resolved list with no part, and every row a View", async () => {
      navigation.search = "view=resolved";
      const { requests } = memberApi({
        resolved: [incident({ status: "RESOLVED", resolvedAt: "2026-09-18T14:00:00.000Z" })],
      });

      inOrganization(<IncidentsView />);

      const table = await screen.findByRole("table", { name: "Resolved" });

      expect(within(table).getByRole("link", { name: "View INC-42" })).toBeDefined();
      expect(
        requests.some((request) => request.path === `${base}/incidents?state=resolved`),
      ).toBe(true);
    });

    it("says when nothing needs them", async () => {
      memberApi();

      inOrganization(<IncidentsView />);

      expect(await screen.findByText("Nothing needs you")).toBeDefined();
    });

    it("takes out of the URL what a member's page cannot apply", async () => {
      navigation.search = "view=everything&service=payment-api&response=ready&from=2026-09-12&to=2026-09-18&q=card";
      memberApi();

      inOrganization(<IncidentsView />);

      await waitFor(() =>
        expect(navigation.replace).toHaveBeenCalledWith("/orgs/acme-ops/incidents?q=card", {
          scroll: false,
        }),
      );
    });
  });

  describe("on a phone", () => {
    beforeEach(() => {
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

    /** The section a heading names. */
    const sectionOf = async (name: string | RegExp) =>
      (await screen.findByRole("heading", { name })).closest("section") as HTMLElement;

    it("lists a member's incidents as cards, each one tap that says what it offers", async () => {
      api(MEMBER, {
        handler: (request) => {
          if (route(request) === `GET ${base}/incidents/parts`) {
            const none = { total: 0, byTeam: [], bySeverity: { SEV1: 0, SEV2: 0, SEV3: 0, SEV4: 0 } };

            return jsonResponse(200, {
              "needs-you": none,
              investigating: none,
              completed: none,
              active: none,
            });
          }
          if (request.path === `${base}/incidents?state=active&part=needs-you`) {
            return jsonResponse(200, page([incident({ responders: [responder(daniel)] })]));
          }

          return undefined;
        },
      });

      inOrganization(<IncidentsView />);

      const cards = await screen.findByRole("list", { name: "Needs you" });
      const card = within(cards).getByRole("link", {
        name: "Respond INC-42, Card payments failing",
      });

      expect(card.getAttribute("href")).toBe("/orgs/acme-ops/incidents/42");
      expect(card.textContent).toMatch(/Payment API · Payments/);
      // No table to squeeze.
      expect(screen.queryByRole("table")).toBeNull();
    });

    it("pins the update box to the foot of the screen while a member investigates", async () => {
      navigation.params = { orgSlug: "acme-ops", incidentNumber: "42" };
      api(MEMBER, { detail: incident({ responders: [responder(ada)] }) });

      inOrganization(<IncidentDetail />);

      const box = await screen.findByLabelText("Post an update");

      expect(box.closest(".fixed")).not.toBeNull();
      // The response itself is still theirs to complete, in place.
      expect(
        within(await sectionOf("Your response")).getByRole("button", {
          name: "Complete my response",
        }),
      ).toBeDefined();
    });

    it("lists the organization's incidents as cards for oversight too, each a View", async () => {
      api(OVERSIGHT);

      inOrganization(<IncidentsView />);

      const cards = await screen.findByRole("list", { name: "Active incidents" });

      expect(
        within(cards).getByRole("link", { name: "View INC-42, Card payments failing" }),
      ).toBeDefined();
      expect(screen.queryByRole("table")).toBeNull();
    });

    it("leaves the Admin's update box in place", async () => {
      navigation.params = { orgSlug: "acme-ops", incidentNumber: "42" };
      api(ADMIN);

      inOrganization(<IncidentDetail />);

      const box = await screen.findByLabelText("Post an update");

      expect(box.closest(".fixed")).toBeNull();
    });
  });

  describe("freshness", () => {
    it("says how fresh a page is in seconds, then minutes, then hours", () => {
      expect(formatAge(3_000)).toBe("just now");
      expect(formatAge(42_000)).toBe("42s ago");
      expect(formatAge(5 * 60_000 + 10_000)).toBe("5m ago");
      expect(formatAge(2 * 3_600_000)).toBe("2h ago");
      // A clock slightly ahead of the answer reads as just now.
      expect(formatAge(-1_000)).toBe("just now");
    });

    it("keeps the Incidents list live, and says so", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        const { requests } = api(OVERSIGHT);

        inOrganization(<IncidentsView />);

        expect(await screen.findByText("Live · updated just now")).toBeDefined();
        const asks = count(requests, `GET ${base}/incidents?state=active`);

        await vi.advanceTimersByTimeAsync(LIVE_POLL_MS);

        await waitFor(() =>
          expect(count(requests, `GET ${base}/incidents?state=active`)).toBeGreaterThan(
            asks,
          ),
        );
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("the cache", () => {
    it("stores a changed incident and stales both lists, the overview's counts, and its timeline, and nothing outside incidents", () => {
      const queryClient = new QueryClient();
      const orgId = organization.id;
      const changed = incident({ status: "DECLARED" });

      queryClient.setQueryData(queryKeys.incidentList(orgId, "active"), { pages: [], pageParams: [] });
      queryClient.setQueryData(queryKeys.incidentList(orgId, "resolved"), { pages: [], pageParams: [] });
      queryClient.setQueryData(queryKeys.services(orgId), []);
      queryClient.setQueryData(queryKeys.incidentTimeline(orgId, 42), []);
      queryClient.setQueryData(queryKeys.incidentSummary(orgId, "2026-09-13", "2026-09-19"), {});

      storeIncident(queryClient, orgId, changed);

      expect(queryClient.getQueryData(queryKeys.incident(orgId, 42))).toEqual(changed);
      expect(queryClient.getQueryState(queryKeys.incidentList(orgId, "active"))?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(queryKeys.incidentList(orgId, "resolved"))?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(queryKeys.incidentTimeline(orgId, 42))?.isInvalidated).toBe(true);
      expect(
        queryClient.getQueryState(queryKeys.incidentSummary(orgId, "2026-09-13", "2026-09-19"))?.isInvalidated,
      ).toBe(true);
      expect(queryClient.getQueryState(queryKeys.services(orgId))?.isInvalidated).toBe(false);
      expect(queryClient.getQueryState(queryKeys.incident(orgId, 42))?.isInvalidated).toBe(false);
    });
  });
});
