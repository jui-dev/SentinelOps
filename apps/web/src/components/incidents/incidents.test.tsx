import { QueryClient } from "@tanstack/react-query";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OrganizationScope } from "@/components/organizations/organization-scope";
import type {
  IncidentActivityResponse,
  IncidentDetailResponse,
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
import { storeIncident } from "./incident-queries";
import { IncidentsView } from "./incidents-view";

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

const page = (items: IncidentResponse[], cursor: string | null = null) => ({
  items,
  page: { cursor, hasMore: cursor !== null },
});

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
      api(READ_ONLY, {
        active: [incident(), incident({ number: 7, severity: "SEV3", title: "Reports delayed", status: "DECLARED" })],
      });

      inOrganization(<IncidentsView />);

      const table = await screen.findByRole("table", { name: "Active incidents" });
      const [, first, second] = within(table).getAllByRole("row");

      expect(within(first).getByText("SEV1")).toBeDefined();
      // The word is read out even where only the code is shown.
      expect(within(first).getByText("Critical")).toBeDefined();
      expect(
        within(first).getByRole("link", { name: /INC-42 Card payments failing/ }).getAttribute("href"),
      ).toBe("/orgs/acme-ops/incidents/42");
      expect(within(first).getByText("Payment API")).toBeDefined();
      expect(within(first).getByText("Payments")).toBeDefined();
      expect(within(first).getByText("Investigating")).toBeDefined();
      expect(within(first).getByText(/^(<1m|\d+[mhd])/)).toBeDefined();
      expect(within(second).getByText("Declared")).toBeDefined();
      expect(await screen.findByText("No resolved incidents")).toBeDefined();
    });

    it("makes each row one link, and folds where and who under the title for narrow screens", async () => {
      api(READ_ONLY, {
        active: [incident(), incident({ number: 7, severity: "SEV3", title: "Reports delayed", status: "DECLARED" })],
      });

      inOrganization(<IncidentsView />);

      const table = await screen.findByRole("table", { name: "Active incidents" });
      const [, first, second] = within(table).getAllByRole("row");

      // One tab stop per row, named by the incident.
      expect(within(first).getAllByRole("link")).toHaveLength(1);
      expect(within(second).getAllByRole("link")).toHaveLength(1);
      // The service and team stay in the row where their columns are hidden.
      expect(within(first).getByText(/Payment API · Payments/)).toBeDefined();
      // Status is its word; the icon beside it is decoration.
      const status = within(first).getByText("Investigating");
      expect(status.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
      // SEV1 is said in words, not only by its colour or its edge.
      expect(within(first).getByText("SEV1")).toBeDefined();
      expect(within(first).getByText("Critical")).toBeDefined();
    });

    it("offers the way on to Incident history, whatever the caller may do", async () => {
      api(READ_ONLY);

      inOrganization(<IncidentsView />);

      await screen.findByRole("table", { name: "Active incidents" });

      expect(
        screen
          .getByRole("link", { name: /Incident history/ })
          .getAttribute("href"),
      ).toBe("/orgs/acme-ops/incidents/history");
    });

    it("offers no declaration without incidents:manage", async () => {
      api(READ_ONLY);

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

      await screen.findByRole("table", { name: "Active incidents" });

      expect(screen.queryByRole("button", { name: "Declare incident" })).toBeNull();
    });

    it("narrows each list to the range in the URL, by the moment that defines it", async () => {
      navigation.search = "from=2026-09-12&to=2026-09-18";
      const range = "from=2026-09-12&to=2026-09-18";
      const { requests } = api(READ_ONLY, {
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

      // Each list says which moment it is filtered on.
      expect(screen.getByText("Declared in this range.")).toBeDefined();
      expect(screen.getByText("Resolved in this range.")).toBeDefined();
      expect(await screen.findByText("None resolved in this range")).toBeDefined();

      expect(count(requests, `GET ${base}/incidents?state=active&${range}`)).toBe(1);
      expect(count(requests, `GET ${base}/incidents?state=resolved&${range}`)).toBe(1);
      expect(navigation.replace).not.toHaveBeenCalled();
    });

    it.each([
      "from=2026-09-12",
      "from=2026-09-18&to=2026-09-12",
      "from=2026-02-30&to=2026-03-02",
      "from=2025-01-01&to=2026-09-18",
    ])("puts the URL right when its range (%s) cannot be applied", async (search) => {
      navigation.search = search;
      const { requests } = api(READ_ONLY);

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
        const { requests } = api(READ_ONLY, {
          handler: (request) =>
            route(request) === filtered("active")
              ? jsonResponse(200, page([incident({ severity: "SEV2", title: "Checkout failing" })]))
              : route(request) === filtered("resolved")
                ? jsonResponse(200, page([]))
                : undefined,
        });

        inOrganization(<IncidentsView />);

        expect(await screen.findByText("Checkout failing")).toBeDefined();
        expect(await screen.findByText("No resolved incidents match")).toBeDefined();
        expect(count(requests, filtered("active"))).toBe(1);
        expect(count(requests, filtered("resolved"))).toBe(1);
        // Waited for the lists, rather than showing everything for a moment.
        expect(count(requests, `GET ${base}/incidents?state=active`)).toBe(0);

        const search = screen.getByRole("search", { name: "Filter incidents" });

        expect((within(search).getByLabelText("Search") as HTMLInputElement).value).toBe("checkout");
        expect((within(search).getByLabelText("Severity") as HTMLSelectElement).value).toBe("SEV2");
        expect((within(search).getByLabelText("Service") as HTMLSelectElement).value).toBe("payment-api");
        expect((within(search).getByLabelText("Responsible team") as HTMLSelectElement).value).toBe(
          payments.id,
        );
      });

      it("applies a choice at once, keeping the period and the other filters", async () => {
        const user = userEvent.setup();
        navigation.search = "from=2026-09-12&to=2026-09-18&q=checkout";
        api(READ_ONLY, {
          handler: (request) =>
            route(request).startsWith(`GET ${base}/incidents?state=`)
              ? jsonResponse(200, page([]))
              : undefined,
        });

        inOrganization(<IncidentsView />);

        await user.selectOptions(await screen.findByLabelText("Severity"), "SEV1");

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
        api(READ_ONLY);

        inOrganization(<IncidentsView />);

        await user.type(await screen.findByLabelText("Search"), "  INC-42 ");
        expect(navigation.replace).not.toHaveBeenCalled();

        await user.keyboard("{Enter}");

        expect(navigation.replace).toHaveBeenLastCalledWith("/orgs/acme-ops/incidents?q=INC-42", {
          scroll: false,
        });
        expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
      });

      it("takes a filter that can never apply out of the URL, keeping the rest", async () => {
        navigation.search = `q=checkout&severity=SEV9&service=no-such-service&team=${platform.id}`;
        api(READ_ONLY, {
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

    it("loads the next page of resolved incidents on request, by the API's cursor", async () => {
      const user = userEvent.setup();
      const { requests } = api(READ_ONLY, {
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
      await user.selectOptions(await screen.findByLabelText("Affected service"), paymentApi.id);
      await user.click(
        within(screen.getByRole("dialog", { name: "Declare an incident" })).getByRole("button", {
          name: "Declare incident",
        }),
      );

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

    /** The response panel's counts, as { label: value }. */
    const figures = (panel: HTMLElement) => {
      const counts = within(panel).getByRole("group", { name: "Response counts" });

      return Object.fromEntries(
        within(counts)
          .getAllByRole("definition")
          .map((value) => [value.previousElementSibling?.textContent, value.textContent]),
      );
    };

    /** Opens the Admin's drawer, and answers it. */
    const openManage = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(await screen.findByRole("button", { name: "Manage incident" }));

      return screen.findByRole("dialog", { name: "Manage incident" });
    };

    it("shows what the record holds", async () => {
      api(READ_ONLY);

      inOrganization(<IncidentDetail />);

      expect(
        await screen.findByRole("heading", { level: 1, name: "Card payments failing" }),
      ).toBeDefined();
      expect(screen.getByText(/INC-42/)).toBeDefined();
      expect(screen.getByText("Card declines since 14:02.")).toBeDefined();
      expect(
        screen.getByRole("link", { name: "Payment API" }).getAttribute("href"),
      ).toBe("/orgs/acme-ops/services/payment-api");
      expect(
        screen.getByRole("link", { name: "Payments" }).getAttribute("href"),
      ).toBe(`/orgs/acme-ops/teams/${payments.id}`);
      expect(screen.getByText("by Ada Lovelace")).toBeDefined();
      // Read-only: nothing to change.
      expect(screen.queryByRole("button", { name: "Resolve incident" })).toBeNull();
      expect(screen.queryByLabelText("Status")).toBeNull();
    });

    describe("as the admin", () => {
      it("coordinates a declared incident: awaiting the team, with no investigation to start and nothing to resolve", async () => {
        api(ADMIN, { detail: incident({ status: "DECLARED" }) });

        inOrganization(<IncidentDetail />);

        const response = await sectionOf("Awaiting team response");

        expect(
          within(response).getByText("Payments has not started investigating yet."),
        ).toBeDefined();
        // No counts before anyone responds.
        expect(within(response).queryByRole("list", { name: "Responders" })).toBeNull();
        for (const name of ["Start investigation", "Start investigating", "Resolve incident"]) {
          expect(screen.queryByRole("button", { name })).toBeNull();
        }
        expect(screen.queryByRole("heading", { name: "Your response" })).toBeNull();
        // The admin still posts updates, without responding.
        expect(screen.getByLabelText("Post an update")).toBeDefined();
      });

      it("sees who is investigating, and why it cannot be resolved yet", async () => {
        api(ADMIN, { detail: incident({ responders: [responder(daniel), responder(sam)] }) });

        inOrganization(<IncidentDetail />);

        const response = await sectionOf("Response in progress");

        expect(figures(response)).toEqual({
          Responders: "2",
          Investigating: "2",
          Complete: "0",
        });
        expect(
          within(within(response).getByRole("list", { name: "Responders" }))
            .getAllByRole("listitem")
            .map((item) => item.textContent),
        ).toEqual([
          expect.stringMatching(/^Daniel OkaforInvestigatingfor /),
          expect.stringMatching(/^Sam OkaforInvestigatingfor /),
        ]);
        expect(
          within(response).getByText(
            "Resolve becomes available when Daniel Okafor and Sam Okafor complete their responses.",
          ),
        ).toBeDefined();
        expect(screen.queryByRole("button", { name: "Resolve incident" })).toBeNull();
      });

      it("sees a mixed response, still held by whoever is investigating", async () => {
        api(ADMIN, {
          detail: incident({ responders: [responder(daniel), responder(sam, "COMPLETED")] }),
        });

        inOrganization(<IncidentDetail />);

        const response = await sectionOf("Response in progress");

        expect(figures(response)).toEqual({
          Responders: "2",
          Investigating: "1",
          Complete: "1",
        });
        expect(within(response).getByText("Response complete")).toBeDefined();
        expect(
          within(response).getByText(
            "Resolve becomes available when Daniel Okafor completes their response.",
          ),
        ).toBeDefined();
        expect(screen.queryByRole("button", { name: "Resolve incident" })).toBeNull();
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

        const response = await sectionOf("Response work complete");

        expect(
          within(response).getByText("2 responders completed their response."),
        ).toBeDefined();

        await user.click(within(response).getByRole("button", { name: "Resolve incident" }));
        expect(requests.some((r) => r.method === "PATCH")).toBe(false);
        await user.type(
          within(response).getByLabelText("How was it resolved?"),
          "  Rolled back the 12:00 deploy.  ",
        );
        await user.click(within(response).getByRole("button", { name: "Resolve incident" }));

        expect(
          await screen.findByText(/A resolved incident is kept as it is; if the problem returns/),
        ).toBeDefined();
        expect(requests.find((r) => route(r) === `PATCH ${base}/incidents/42`)?.body).toEqual({
          status: "RESOLVED",
          resolution: "Rolled back the 12:00 deploy.",
        });
      });

      it("asks how it was resolved before sending anything", async () => {
        const user = userEvent.setup();
        const { requests } = api(ADMIN, {
          detail: incident({ responders: [responder(daniel, "COMPLETED")] }),
        });

        inOrganization(<IncidentDetail />);

        await user.click(await screen.findByRole("button", { name: "Resolve incident" }));
        await user.type(screen.getByLabelText("How was it resolved?"), "   ");
        await user.click(screen.getByRole("button", { name: "Resolve incident" }));

        expect(await screen.findByText("Say how the incident was resolved.")).toBeDefined();
        expect(
          screen.getByLabelText("How was it resolved?").getAttribute("aria-invalid"),
        ).toBe("true");
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
        expect(await screen.findByRole("heading", { name: "Awaiting team response" })).toBeDefined();
        expect(screen.queryByLabelText("Severity")).toBeNull();

        const drawer = await openManage(user);

        for (const heading of ["Severity and responsible team", "Title and summary"]) {
          expect(within(drawer).getByRole("heading", { name: heading })).toBeDefined();
        }

        await user.click(within(drawer).getByRole("button", { name: "Close" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(screen.queryByRole("heading", { name: "Your response" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Mark my response complete" })).toBeNull();
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
          within(yours).getByText("You have not started responding to this incident."),
        ).toBeDefined();
        // Starting comes first: no composer yet.
        expect(screen.queryByLabelText("Post an update")).toBeNull();

        await user.click(within(yours).getByRole("button", { name: "Start investigating" }));

        expect(await within(yours).findByText("You are investigating")).toBeDefined();
        expect(within(yours).getByText(/^Started/)).toBeDefined();
        // Where they post is their own panel.
        expect(within(yours).getByLabelText("Post an update")).toBeDefined();
        expect(
          within(yours).getByRole("button", { name: "Mark my response complete" }),
        ).toBeDefined();
        expect(within(await sectionOf("Team response")).getByText(/Response in progress/)).toBeDefined();
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

        await user.click(within(yours).getByRole("button", { name: "Mark my response complete" }));

        expect(await within(yours).findByText("Response complete")).toBeDefined();
        expect(
          within(yours).getByText(/Your response work on this incident is complete/),
        ).toBeDefined();
        expect(screen.queryByLabelText("Post an update")).toBeNull();
        expect(screen.queryByRole("button", { name: "Mark my response complete" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Start investigating" })).toBeNull();
        // Daniel is still investigating: the incident stays in progress.
        expect(within(await sectionOf("Team response")).getByText(/Response in progress/)).toBeDefined();
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

      expect(within(yours).getByText("You are investigating")).toBeDefined();
      expect(
        within(yours).getByRole("button", { name: "Mark my response complete" }),
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

      expect(await sectionOf("Response in progress")).toBeDefined();
      expect(
        await screen.findByText("Investigating elevated database latency."),
      ).toBeDefined();
      expect(screen.queryByRole("heading", { name: "Your response" })).toBeNull();
      for (const name of ["Start investigating", "Mark my response complete", "Resolve incident"]) {
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

      // The admin sees the response as a whole; a responder, their own part
      // above the team's.
      const response =
        permissions === ADMIN
          ? await sectionOf("Response")
          : await sectionOf("Team response");

      if (permissions === ADMIN) {
        expect(
          within(response).getByText("2 responders responded to this incident."),
        ).toBeDefined();
      } else {
        expect(within(await sectionOf("Your response")).getByText("Response complete")).toBeDefined();
      }
      expect(within(response).getAllByText("Response complete")).toHaveLength(2);
      expect(screen.getByText(/^Lasted/)).toBeDefined();

      const timeline = await sectionOf(/Timeline/);
      const entries = await within(timeline).findAllByRole("listitem");

      expect(entries.at(-1)?.textContent).toMatch(/Resolved the incident$/);
      // Resolved before notes were required: said, not left as a gap.
      expect(
        within(await sectionOf("Resolution")).getByText(
          "Resolved before resolution notes were recorded.",
        ),
      ).toBeDefined();
      for (const name of [
        "Start investigating",
        "Mark my response complete",
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

      const timeline = await sectionOf(/Timeline/);
      const [entry] = await within(timeline).findAllByRole("listitem");

      expect(entry.textContent).toMatch(
        /^Ada Lovelace · .*Resolved the incident.*Rolled back the 12:00 deploy/,
      );
    });

    it("tells the story on the timeline, oldest first, with nothing to post for a reader", async () => {
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

      const timeline = await sectionOf(/Timeline/);
      const entries = await within(timeline).findAllByRole("listitem");

      expect(entries.map((entry) => entry.textContent)).toEqual([
        expect.stringMatching(/^Ada Lovelace · .*Declared the incident at SEV2/),
        expect.stringMatching(/^Daniel Okafor started investigating · [^·]*$/),
        expect.stringMatching(/^Daniel Okafor · .*The incident is now Investigating$/),
        expect.stringMatching(
          /^DODaniel Okafor posted an update · .*Investigating elevated database latency\.$/,
        ),
        expect.stringMatching(/Changed severity SEV2.*→.*SEV1/),
        expect.stringMatching(
          /^Ada Lovelace · .*Reassigned the incident from Payments to Platform$/,
        ),
        expect.stringMatching(/^Daniel Okafor completed their response · [^·]*$/),
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

      const timeline = await sectionOf(/Timeline/);
      const [entry] = await within(timeline).findAllByRole("listitem");

      expect(entry.textContent).toMatch(/Changed status Identified.*→.*Monitoring$/);
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
