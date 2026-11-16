import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OrganizationScope } from "@/components/organizations/organization-scope";
import type { IncidentResponse, ServiceResponse } from "@/lib/api/contracts";
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

import { ServiceDetail } from "./service-detail";
import { ServiceScope } from "./service-scope";
import { ServicesView } from "./services-view";

const navigation = vi.hoisted(() => ({
  params: { orgSlug: "acme-ops" } as { orgSlug: string; serviceSlug?: string },
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => navigation.params,
  usePathname: () => "/orgs/acme-ops/services",
  useRouter: () => ({ replace: vi.fn(), push: navigation.push }),
}));

const MANAGE = [
  "memberships:read",
  "organization:read",
  "services:manage",
  "services:read",
  "teams:manage",
  "teams:read",
];
const READ = [
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
  serviceCount: 0,
};

const paymentApi: ServiceResponse = {
  id: "0199a1b2-c3d4-7000-8000-0000000000e1",
  name: "Payment API",
  slug: "payment-api",
  description: "Takes card payments.",
  criticality: "CRITICAL" as const,
  ownerTeam: { id: payments.id, name: payments.name, slug: payments.slug },
  archivedAt: null,
  createdAt: "2026-09-18T12:00:00.000Z",
  updatedAt: "2026-09-18T13:00:00.000Z",
};

const legacyPortal: ServiceResponse = {
  ...paymentApi,
  id: "0199a1b2-c3d4-7000-8000-0000000000e2",
  name: "Legacy Portal",
  slug: "legacy-portal",
  description: null,
  criticality: "LOW",
  archivedAt: "2026-09-18T14:00:00.000Z",
};

/** An incident on the Payment API; by default active. */
const anIncident = (
  number: number,
  overrides: Partial<IncidentResponse> = {},
): IncidentResponse => ({
  id: `0199a1b2-c3d4-7000-8000-0000000001${String(number).padStart(2, "0")}`,
  number,
  title: `Incident ${number}`,
  severityConfirmed: true,
  responseAccess: "OPEN",
  assignees: [],
  knownIssue: null,
  summary: null,
  severity: "SEV3",
  status: "INVESTIGATING",
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
  createdBy: { id: "0199a1b2-c3d4-7000-8000-000000000001", name: "Ada" },
  createdAt: "2026-09-18T12:00:00.000Z",
  updatedAt: "2026-09-18T12:00:00.000Z",
  resolvedAt: null,
  ...overrides,
});

const resolvedIncident = (number: number) =>
  anIncident(number, {
    status: "RESOLVED",
    resolvedAt: "2026-09-18T13:00:00.000Z",
  });

const incidentPage = (items: IncidentResponse[]) => ({
  items,
  page: { cursor: null, hasMore: false },
});

type Handler = (request: SentRequest) => Response | undefined;

const api = (
  permissions: string[],
  {
    services = [paymentApi],
    teams = [payments, platform],
    handler = () => undefined,
  }: {
    services?: (typeof paymentApi)[];
    teams?: (typeof payments)[];
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
      case `GET ${base}/services`:
        return jsonResponse(200, services);
      case `GET ${base}/teams`:
        return jsonResponse(200, teams);
      default:
        return apiError(404);
    }
  });

const inOrganization = (page: React.ReactNode) =>
  renderWithSession(<OrganizationScope>{page}</OrganizationScope>);

const inService = (page: React.ReactNode) =>
  inOrganization(<ServiceScope>{page}</ServiceScope>);

const count = (requests: SentRequest[], key: string) =>
  requests.filter((r) => route(r) === key).length;

describe("services", () => {
  beforeEach(() => {
    clearAccessToken();
    navigation.params = { orgSlug: "acme-ops" };
    navigation.push.mockReset();
  });

  describe("the list", () => {
    it("lists services with their owner and criticality, opened from View — without slugs", async () => {
      api(READ);

      inOrganization(<ServicesView />);

      const view = await screen.findByRole("link", { name: "View Payment API" });

      expect(view.getAttribute("href")).toBe(
        "/orgs/acme-ops/services/payment-api",
      );
      // The name is text, not a second way in.
      expect(screen.getByText("Payment API").closest("a")).toBeNull();
      expect(
        screen.getByRole("link", { name: "Payments" }).getAttribute("href"),
      ).toBe("/orgs/acme-ops/teams/payments");
      expect(
        within(screen.getByRole("table", { name: "Services" })).getByText("Critical"),
      ).toBeDefined();
      expect(screen.getByText("Takes card payments.")).toBeDefined();
      expect(screen.queryByText("payment-api")).toBeNull();
      // Without incidents:read, no status is claimed either way.
      expect(screen.queryByRole("columnheader", { name: "Status" })).toBeNull();
      expect(screen.queryByText(/active incidents/i)).toBeNull();
    });

    it("keeps archived services under their own filter, not among those in use", async () => {
      const user = userEvent.setup();
      api(READ, { services: [paymentApi, legacyPortal] });

      inOrganization(<ServicesView />);

      await screen.findByText("Payment API");
      expect(screen.queryByText("Legacy Portal")).toBeNull();

      await user.click(screen.getByRole("button", { name: "Archived 1" }));

      expect(screen.getByText("Legacy Portal")).toBeDefined();
      expect(screen.queryByText("Payment API")).toBeNull();
      expect(screen.getByRole("table", { name: "Archived services" })).toBeDefined();
    });

    it("says whether anything is wrong now, from the active incidents, worst first", async () => {
      const user = userEvent.setup();
      const authentication: ServiceResponse = {
        ...paymentApi,
        id: "0199a1b2-c3d4-7000-8000-0000000000e3",
        name: "Authentication",
        slug: "authentication",
        description: null,
        criticality: "HIGH",
      };
      const { requests } = api([...READ, "incidents:read"], {
        services: [paymentApi, authentication],
        handler: (request) =>
          route(request) === `GET ${base}/incidents?state=active`
            ? jsonResponse(
                200,
                incidentPage([
                  anIncident(9, { severity: "SEV1" }),
                  anIncident(8, { severity: "SEV3" }),
                ]),
              )
            : undefined,
      });

      inOrganization(<ServicesView />);

      expect(await screen.findByText("2 active · SEV1")).toBeDefined();
      expect(screen.getByText("No active incidents")).toBeDefined();
      // One list for every service, not one request each.
      expect(count(requests, `GET ${base}/incidents?state=active`)).toBe(1);

      await user.click(
        screen.getByRole("button", { name: "With active incidents 1" }),
      );
      expect(screen.getByText("Payment API")).toBeDefined();
      expect(screen.queryByText("Authentication")).toBeNull();

      await user.click(screen.getByRole("button", { name: "High 1" }));
      expect(screen.getByText("Authentication")).toBeDefined();
      expect(screen.queryByText("Payment API")).toBeNull();
    });

    it("finds services by name or owner team", async () => {
      const user = userEvent.setup();
      api(READ, { services: [paymentApi, { ...legacyPortal, archivedAt: null }] });

      inOrganization(<ServicesView />);

      await screen.findByText("Legacy Portal");
      await user.click(screen.getByRole("button", { name: "Open search" }));
      await user.type(screen.getByLabelText("Search services"), "payments");
      // Both are Payments', found by their team.
      expect(screen.getByText("Payment API")).toBeDefined();
      expect(screen.getByText("Legacy Portal")).toBeDefined();

      await user.clear(screen.getByLabelText("Search services"));
      await user.type(screen.getByLabelText("Search services"), "legacy");
      expect(screen.queryByText("Payment API")).toBeNull();

      await user.clear(screen.getByLabelText("Search services"));
      await user.type(screen.getByLabelText("Search services"), "nothing");
      expect(screen.getByText(/No services match/)).toBeDefined();
    });

    it("offers no creation without services:manage, and says who adds them", async () => {
      api(READ, { services: [] });

      inOrganization(<ServicesView />);

      expect(await screen.findByText("No services yet")).toBeDefined();
      expect(screen.getByText(/The Admin adds services/)).toBeDefined();
      expect(screen.queryByRole("button", { name: "New service" })).toBeNull();
    });

    it("welcomes a manager to the first service, offered once, on the page itself", async () => {
      const user = userEvent.setup();
      api(MANAGE, { services: [] });

      inOrganization(<ServicesView />);

      expect(await screen.findByText("Add your first service")).toBeDefined();
      expect(screen.queryByText(/The Admin adds services/)).toBeNull();
      // The header's button steps aside: one place for the action.
      const buttons = screen.getAllByRole("button", { name: "New service" });

      expect(buttons).toHaveLength(1);
      expect(
        screen.getByRole("link", { name: "How services fit in" }).getAttribute("href"),
      ).toBe("/orgs/acme-ops/how-it-works#step-set-up");

      await user.click(buttons[0]);

      expect(await screen.findByLabelText("Criticality")).toBeDefined();
    });

    it("says a service needs a team first when there are none, and leads to Teams", async () => {
      api(MANAGE, { services: [], teams: [] });

      inOrganization(<ServicesView />);

      expect(await screen.findByText("Services need a team first")).toBeDefined();
      expect(
        screen.getByRole("link", { name: "Go to Teams" }).getAttribute("href"),
      ).toBe("/orgs/acme-ops/teams");
      // Nothing to make a service with yet.
      expect(screen.queryByRole("button", { name: "New service" })).toBeNull();
    });

    it("closes the dialog on Cancel without creating anything", async () => {
      const user = userEvent.setup();
      const { requests } = api(MANAGE);

      inOrganization(<ServicesView />);

      await user.click(
        (await screen.findAllByRole("button", { name: "New service" }))[0],
      );

      const form = screen.getByRole("dialog", { name: "New service" });

      await user.type(await within(form).findByLabelText("Name"), "Ledger");
      await user.click(within(form).getByRole("button", { name: "Cancel" }));

      expect(screen.queryByRole("dialog", { name: "New service" })).toBeNull();
      expect(requests.some((r) => route(r) === `POST ${base}/services`)).toBe(
        false,
      );
    });

    it("creates a service from name, description, owner, and criticality in a dialog, then closes it on the list", async () => {
      const user = userEvent.setup();
      const created = {
        ...paymentApi,
        id: "new-id",
        name: "Storefront",
        slug: "storefront",
        criticality: "HIGH" as const,
        ownerTeam: { id: platform.id, name: "Platform", slug: "platform" },
      };
      const { requests } = api(MANAGE, {
        handler: (request) =>
          route(request) === `POST ${base}/services`
            ? jsonResponse(201, created)
            : undefined,
      });

      inOrganization(<ServicesView />);

      await user.click(
        (await screen.findAllByRole("button", { name: "New service" }))[0],
      );

      const form = screen.getByRole("dialog", { name: "New service" });

      expect(within(form).queryByLabelText(/slug/i)).toBeNull();

      const criticality = await within(form).findByLabelText("Criticality");

      // Normal is preselected, with its definition shown.
      expect((criticality as HTMLSelectElement).value).toBe("NORMAL");
      expect(within(form).getByText("Failure is disruptive but contained.")).toBeDefined();

      await user.type(within(form).getByLabelText("Name"), "Storefront");
      await user.type(within(form).getByLabelText(/Description/), "The shop.");
      await user.selectOptions(within(form).getByLabelText("Owner team"), platform.id);
      await user.selectOptions(criticality, "HIGH");
      await user.click(
        within(form).getByRole("button", { name: "Create service" }),
      );

      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: "New service" })).toBeNull(),
      );
      expect(navigation.push).not.toHaveBeenCalled();
      expect(
        requests.find((r) => route(r) === `POST ${base}/services`)?.body,
      ).toEqual({
        name: "Storefront",
        description: "The shop.",
        ownerTeamId: platform.id,
        criticality: "HIGH",
      });
    });

    it("shows a taken name on the name field", async () => {
      const user = userEvent.setup();
      api(MANAGE, {
        handler: (request) =>
          route(request) === `POST ${base}/services`
            ? apiError(409, "SERVICE_NAME_TAKEN")
            : undefined,
      });

      inOrganization(<ServicesView />);

      await user.click(
        (await screen.findAllByRole("button", { name: "New service" }))[0],
      );
      await user.type(await screen.findByLabelText("Name"), "payment api!");
      await user.click(screen.getByRole("button", { name: "Create service" }));

      expect(
        await screen.findByText(
          "A service with this name, or a very similar one, already exists.",
        ),
      ).toBeDefined();
      expect(screen.getByLabelText("Name").getAttribute("aria-invalid")).toBe(
        "true",
      );
    });

    it("explains an owner team deleted meanwhile, and refreshes the teams", async () => {
      const user = userEvent.setup();
      const { requests } = api(MANAGE, {
        handler: (request) =>
          route(request) === `POST ${base}/services`
            ? apiError(404, "TEAM_NOT_FOUND")
            : undefined,
      });

      inOrganization(<ServicesView />);

      await user.click(
        (await screen.findAllByRole("button", { name: "New service" }))[0],
      );
      await user.type(await screen.findByLabelText("Name"), "Ledger");
      await user.click(screen.getByRole("button", { name: "Create service" }));

      expect(
        await screen.findByText(/That team no longer exists/),
      ).toBeDefined();
      await waitFor(() =>
        expect(count(requests, `GET ${base}/teams`)).toBeGreaterThan(1),
      );
    });
  });

  describe("a row, opened", () => {
    const WITH_INCIDENTS = [...READ, "incidents:read"];
    const priya = {
      membershipId: "0199a1b2-c3d4-7000-8000-0000000000a1",
      addedAt: "2026-09-18T12:00:00.000Z",
      user: {
        id: "0199a1b2-c3d4-7000-8000-0000000000b1",
        name: "Priya Shah",
        email: "priya@example.com",
      },
    };
    const membersOfPayments = `GET ${base}/teams/${payments.id}/members`;

    it("shows the service's active incidents and who responds, asking for responders only once opened", async () => {
      const user = userEvent.setup();
      const other = anIncident(7, {
        severity: "SEV1",
        service: { ...anIncident(7).service, id: "0199a1b2-c3d4-7000-8000-0000000000e9" },
      });
      const { requests } = api(WITH_INCIDENTS, {
        handler: (request) =>
          route(request) === `GET ${base}/incidents?state=active`
            ? jsonResponse(200, incidentPage([anIncident(9, { severity: "SEV2" }), other]))
            : route(request) === membersOfPayments
              ? jsonResponse(200, [priya])
              : undefined,
      });

      inOrganization(<ServicesView />);

      const toggle = await screen.findByRole("button", {
        name: "Show incidents and responders of Payment API",
      });

      expect(count(requests, membersOfPayments)).toBe(0);

      await user.click(toggle);

      const incidents = await screen.findByRole("region", {
        name: "Active incidents of Payment API",
      });

      // Its own incidents only, each opening the incident.
      expect(within(incidents).getAllByRole("link")).toHaveLength(1);
      expect(
        within(incidents).getByRole("link", { name: /INC-9/ }).getAttribute("href"),
      ).toBe("/orgs/acme-ops/incidents/9");

      const responders = screen.getByRole("region", {
        name: "Who responds to Payment API",
      });

      expect(await within(responders).findByText("Priya Shah")).toBeDefined();
      expect(count(requests, membersOfPayments)).toBe(1);
      // Read only.
      expect(within(responders).queryByRole("button")).toBeNull();
    });

    it("names the owner team when its members cannot be read", async () => {
      const user = userEvent.setup();
      api(WITH_INCIDENTS, {
        handler: (request) =>
          route(request) === membersOfPayments ? apiError(404) : undefined,
      });

      inOrganization(<ServicesView />);

      await user.click(
        await screen.findByRole("button", {
          name: "Show incidents and responders of Payment API",
        }),
      );

      const responders = screen.getByRole("region", {
        name: "Who responds to Payment API",
      });

      expect(
        await within(responders).findByText(/which owns this service/),
      ).toBeDefined();
      expect(
        within(responders).getByRole("link", { name: "Payments" }).getAttribute("href"),
      ).toBe("/orgs/acme-ops/teams/payments");
    });

    it("opens from a click on the row, but not from its links or actions", async () => {
      const user = userEvent.setup();
      api([...MANAGE, "incidents:read"]);

      inOrganization(<ServicesView />);

      await user.click(await screen.findByText("Takes card payments."));
      expect(
        screen.getByRole("region", { name: "Active incidents of Payment API" }),
      ).toBeDefined();

      await user.click(screen.getByText("Takes card payments."));
      expect(
        screen.queryByRole("region", { name: "Active incidents of Payment API" }),
      ).toBeNull();

      await user.click(screen.getByRole("button", { name: "Edit Payment API" }));
      await screen.findByRole("dialog", { name: "Edit service" });
      expect(
        screen.queryByRole("region", { name: "Active incidents of Payment API" }),
      ).toBeNull();
    });
  });

  describe("a service", () => {
    beforeEach(() => {
      navigation.params = { orgSlug: "acme-ops", serviceSlug: "payment-api" };
    });

    it("shows its name, description, a way back, and what its criticality means — nothing invented", async () => {
      api(READ);

      inService(<ServiceDetail />);

      expect(
        await screen.findByRole("heading", { level: 1, name: "Payment API" }),
      ).toBeDefined();
      expect(screen.getByText("Takes card payments.")).toBeDefined();

      const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
      expect(
        within(breadcrumb).getByRole("link", { name: "Services" }).getAttribute("href"),
      ).toBe("/orgs/acme-ops/services");

      // Owner and criticality at a glance; no incident figures without
      // incidents:read.
      const glance = screen.getByLabelText("Payment API at a glance");
      expect(within(glance).getByText("Owner team").nextSibling?.textContent).toBe(
        "Payments",
      );
      expect(within(glance).getByText("Criticality").nextSibling?.textContent).toBe(
        "Critical",
      );
      expect(within(glance).queryByText("Active incidents")).toBeNull();

      const about = screen.getByRole("region", { name: "About" });
      expect(
        within(about).getByRole("link", { name: "Payments" }).getAttribute("href"),
      ).toBe("/orgs/acme-ops/teams/payments");
      expect(
        within(about).getByText(/Failure stops the organization's core work/),
      ).toBeDefined();
      expect(screen.queryByText("payment-api")).toBeNull();
      expect(screen.queryByText("Archived")).toBeNull();
      expect(screen.queryByRole("button", { name: "Declare incident" })).toBeNull();
    });

    describe("its incidents", () => {
      const WITH_INCIDENTS = [...READ, "incidents:read"];
      const listed = (state: string) =>
        `GET ${base}/incidents?state=${state}&serviceId=${paymentApi.id}`;

      it("lists what is active, the worst of it, and the most recent resolved, linking to Incidents filtered by it", async () => {
        const { requests } = api(WITH_INCIDENTS, {
          handler: (request) =>
            route(request) === listed("active")
              ? jsonResponse(
                  200,
                  incidentPage([
                    anIncident(8, { severity: "SEV2", title: "Card declines" }),
                    anIncident(9, { title: "Slow refunds" }),
                  ]),
                )
              : route(request).startsWith(`GET ${base}/incidents?state=resolved`)
                ? jsonResponse(
                    200,
                    incidentPage([7, 6, 5, 4, 3, 2, 1].map(resolvedIncident)),
                  )
                : undefined,
        });

        inService(<ServiceDetail />);

        const active = await screen.findByRole("table", { name: "Active incidents" });
        const resolved = await screen.findByRole("table", {
          name: "Recently resolved incidents",
        });

        expect(within(active).getByText("Card declines")).toBeDefined();
        expect(within(active).getByText("Slow refunds")).toBeDefined();
        // Every row is this service's and its owner's: neither is a column.
        expect(within(active).queryByRole("columnheader", { name: "Service" })).toBeNull();
        expect(
          within(active).queryByRole("columnheader", { name: "Responsible team" }),
        ).toBeNull();
        // Only the five most recent resolved.
        expect(within(resolved).getAllByRole("row")).toHaveLength(1 + 5);
        expect(within(resolved).queryByText("Incident 2")).toBeNull();

        // The glance counts them, and names the worst.
        const glance = screen.getByLabelText("Payment API at a glance");
        await waitFor(() =>
          expect(
            within(glance).getByText("Active incidents").nextSibling?.textContent,
          ).toBe("21 × SEV2"),
        );

        for (const link of screen.getAllByRole("link", { name: /View all in Incidents/ })) {
          expect(link.getAttribute("href")).toBe(
            "/orgs/acme-ops/incidents?service=payment-api",
          );
        }
        // One request for the active list, shared by the glance and the card.
        expect(requests.filter((r) => route(r) === listed("active"))).toHaveLength(1);
      });

      it("says when nothing is active or resolved", async () => {
        api(WITH_INCIDENTS, {
          handler: (request) =>
            route(request).startsWith(`GET ${base}/incidents?state=`)
              ? jsonResponse(200, incidentPage([]))
              : undefined,
        });

        inService(<ServiceDetail />);

        expect(await screen.findByText("No active incidents")).toBeDefined();
        expect(await screen.findByText("None resolved yet")).toBeDefined();
      });
    });

    describe("who responds", () => {
      const membersOfPayments = `GET ${base}/teams/${payments.id}/members`;

      it("lists the owner team's members, read only", async () => {
        api(READ, {
          handler: (request) =>
            route(request) === membersOfPayments
              ? jsonResponse(200, [
                  {
                    membershipId: "0199a1b2-c3d4-7000-8000-0000000000a1",
                    addedAt: "2026-09-18T12:00:00.000Z",
                    user: {
                      id: "0199a1b2-c3d4-7000-8000-0000000000b1",
                      name: "Priya Shah",
                      email: "priya@example.com",
                    },
                  },
                ])
              : undefined,
        });

        inService(<ServiceDetail />);

        const list = await screen.findByRole("list", {
          name: "Who responds to Payment API",
        });

        expect(within(list).getByText("Priya Shah")).toBeDefined();
        expect(within(list).queryByRole("button")).toBeNull();
        expect(screen.getByText(/which owns this service/)).toBeDefined();
      });

      it("names the owner team when its members cannot be read", async () => {
        api(READ, {
          handler: (request) =>
            route(request) === membersOfPayments ? apiError(404) : undefined,
        });

        inService(<ServiceDetail />);

        expect(
          await screen.findByText(/Payments responds to this service/),
        ).toBeDefined();
      });
    });

    it("offers no way to declare an incident: that is the Incidents page's", async () => {
      api([...READ, "incidents:read", "incidents:manage"], {
        handler: (request) =>
          route(request).startsWith(`GET ${base}/incidents?state=`)
            ? jsonResponse(200, incidentPage([]))
            : undefined,
      });

      inService(<ServiceDetail />);

      await screen.findByRole("heading", { level: 1, name: "Payment API" });
      expect(screen.queryByRole("button", { name: /Declare/ })).toBeNull();
      expect(screen.queryByRole("link", { name: /Declare/ })).toBeNull();
    });

    it("says when it is archived", async () => {
      navigation.params = { orgSlug: "acme-ops", serviceSlug: "legacy-portal" };
      api(READ, { services: [paymentApi, legacyPortal] });

      inService(<ServiceDetail />);

      // Said beside the name, and explained beneath it.
      expect((await screen.findAllByText("Archived")).length).toBeGreaterThan(1);
      expect(
        screen.getByText(/no new incident can be declared against it/),
      ).toBeDefined();
    });

    it("offers no Settings on the page: a service is edited from the list", async () => {
      api(MANAGE);

      inService(<ServiceDetail />);

      await screen.findByRole("heading", { level: 1, name: "Payment API" });
      expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
    });

    it("answers an unknown slug with a not-found page", async () => {
      navigation.params = { orgSlug: "acme-ops", serviceSlug: "nope" };
      api(READ);

      inService(<ServiceDetail />);

      expect(
        await screen.findByRole("heading", { name: "Service not found" }),
      ).toBeDefined();
    });
  });

  describe("editing, from the list", () => {
    /** Opens Payment API's Edit dialog from the Services list. */
    const openEdit = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(
        await screen.findByRole("button", { name: "Edit Payment API" }),
      );

      return screen.findByRole("dialog", { name: "Edit service" });
    };

    it("is offered beside View only to those who may manage services", async () => {
      api(READ);

      inOrganization(<ServicesView />);

      await screen.findByRole("link", { name: "View Payment API" });
      expect(screen.queryByRole("button", { name: /Edit/ })).toBeNull();
    });

    it("saves the details and a new owner together, sending only what changed", async () => {
      const user = userEvent.setup();
      const moved = {
        ...paymentApi,
        criticality: "HIGH" as const,
        ownerTeam: { id: platform.id, name: "Platform", slug: "platform" },
      };
      const { requests } = api(MANAGE, {
        handler: (request) =>
          route(request) === `PATCH ${base}/services/${paymentApi.id}`
            ? jsonResponse(200, moved)
            : undefined,
      });

      inOrganization(<ServicesView />);

      const dialog = await openEdit(user);
      const owner = (await within(dialog).findByLabelText(
        "Owner team",
      )) as HTMLSelectElement;

      expect(owner.value).toBe(payments.id);

      await user.selectOptions(within(dialog).getByLabelText("Criticality"), "HIGH");
      await user.selectOptions(owner, platform.id);
      await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: "Edit service" })).toBeNull(),
      );
      expect(
        requests.find(
          (r) => route(r) === `PATCH ${base}/services/${paymentApi.id}`,
        )?.body,
      ).toEqual({
        name: "Payment API",
        description: "Takes card payments.",
        criticality: "HIGH",
        ownerTeamId: platform.id,
      });
      await waitFor(() =>
        expect(count(requests, `GET ${base}/teams`)).toBeGreaterThan(1),
      );
    });

    it("sends no owner when the owner is unchanged", async () => {
      const user = userEvent.setup();
      const { requests } = api(MANAGE, {
        handler: (request) =>
          route(request) === `PATCH ${base}/services/${paymentApi.id}`
            ? jsonResponse(200, paymentApi)
            : undefined,
      });

      inOrganization(<ServicesView />);

      const dialog = await openEdit(user);

      await within(dialog).findByLabelText("Owner team");
      await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

      await waitFor(() =>
        expect(
          requests.find(
            (r) => route(r) === `PATCH ${base}/services/${paymentApi.id}`,
          )?.body,
        ).not.toHaveProperty("ownerTeamId"),
      );
    });

    it("archives the service", async () => {
      const user = userEvent.setup();
      const { requests } = api(MANAGE, {
        handler: (request) =>
          route(request) === `PATCH ${base}/services/${paymentApi.id}`
            ? jsonResponse(200, {
                ...paymentApi,
                archivedAt: "2026-09-18T15:00:00.000Z",
              })
            : undefined,
      });

      inOrganization(<ServicesView />);

      const dialog = await openEdit(user);

      await user.click(within(dialog).getByRole("button", { name: "Archive" }));

      expect(
        await within(dialog).findByRole("button", { name: "Unarchive" }),
      ).toBeDefined();
      expect(
        requests.find(
          (r) => route(r) === `PATCH ${base}/services/${paymentApi.id}`,
        )?.body,
      ).toEqual({ archived: true });
    });

    it("deletes only after confirmation, then closes on the refreshed list", async () => {
      const user = userEvent.setup();
      const { requests } = api(MANAGE, {
        handler: (request) =>
          route(request) === `DELETE ${base}/services/${paymentApi.id}`
            ? jsonResponse(204)
            : undefined,
      });

      inOrganization(<ServicesView />);

      const dialog = await openEdit(user);

      await user.click(
        within(dialog).getByRole("button", { name: "Delete service…" }),
      );
      expect(requests.some((r) => r.method === "DELETE")).toBe(false);

      await user.click(within(dialog).getByRole("button", { name: "Delete service" }));

      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: "Edit service" })).toBeNull(),
      );
      expect(
        requests.some(
          (r) => route(r) === `DELETE ${base}/services/${paymentApi.id}`,
        ),
      ).toBe(true);
      await waitFor(() =>
        expect(count(requests, `GET ${base}/services`)).toBeGreaterThan(1),
      );
    });

    it("explains that a service with incidents is archived rather than deleted", async () => {
      const user = userEvent.setup();
      api(MANAGE, {
        handler: (request) =>
          route(request) === `DELETE ${base}/services/${paymentApi.id}`
            ? apiError(409, "SERVICE_HAS_INCIDENTS")
            : undefined,
      });

      inOrganization(<ServicesView />);

      const dialog = await openEdit(user);

      await user.click(
        within(dialog).getByRole("button", { name: "Delete service…" }),
      );
      await user.click(within(dialog).getByRole("button", { name: "Delete service" }));

      expect(
        await within(dialog).findByText("This service has incidents"),
      ).toBeDefined();
      expect(within(dialog).getByText(/Archive it instead/)).toBeDefined();
      expect(screen.getByRole("dialog", { name: "Edit service" })).toBeDefined();
    });
  });
});
