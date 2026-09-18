import { QueryClient } from "@tanstack/react-query";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OrganizationScope } from "@/components/organizations/organization-scope";
import type {
  IncidentDetailResponse,
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
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => navigation.params,
  usePathname: () => "/orgs/acme-ops/incidents",
  useRouter: () => ({ replace: vi.fn(), push: navigation.push }),
}));

/** What a MEMBER holds: every read, and incident response. */
const MEMBER = [
  "incidents:manage",
  "incidents:read",
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
  role: "OWNER",
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

/** An incident as the single-incident routes return it; lists ignore lead and responders. */
const incident = (
  overrides: Partial<IncidentDetailResponse> = {},
): IncidentDetailResponse => ({
  id: "0199a1b2-c3d4-7000-8000-0000000000f1",
  number: 42,
  title: "Card payments failing",
  summary: "Card declines since 14:02.",
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
  lead: null,
  responders: [],
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
    services = [paymentApi],
    handler = () => undefined,
  }: {
    active?: IncidentResponse[];
    resolved?: IncidentResponse[];
    detail?: IncidentDetailResponse;
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
      case `GET ${base}/services`:
        return jsonResponse(200, services);
      case `GET ${base}/teams`:
        return jsonResponse(200, [payments, platform]);
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
    navigation.push.mockReset();
  });

  describe("the list", () => {
    it("shows what is happening: severity in words, the incident, where, who, status, and how long", async () => {
      api(READ_ONLY, {
        active: [incident(), incident({ number: 7, severity: "SEV3", title: "Reports delayed", status: "MONITORING" })],
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
      expect(within(second).getByText("Monitoring")).toBeDefined();
      expect(await screen.findByText("No resolved incidents")).toBeDefined();
    });

    it("makes each row one link, and folds where and who under the title for narrow screens", async () => {
      api(READ_ONLY, {
        active: [incident(), incident({ number: 7, severity: "SEV3", title: "Reports delayed", status: "MONITORING" })],
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

    it("offers no declaration without incidents:manage", async () => {
      api(READ_ONLY);

      inOrganization(<IncidentsView />);

      await screen.findByRole("table", { name: "Active incidents" });

      expect(screen.queryByRole("button", { name: "Declare incident" })).toBeNull();
    });

    it("lets a member declare, without any configuration permission", async () => {
      api(MEMBER);

      inOrganization(<IncidentsView />);

      expect(
        await screen.findByRole("button", { name: "Declare incident" }),
      ).toBeDefined();
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
      const { requests } = api(MEMBER, {
        services: [paymentApi, legacyPortal],
        handler: (request) =>
          route(request) === `POST ${base}/incidents`
            ? jsonResponse(201, incident({ number: 43 }))
            : undefined,
      });

      inOrganization(<IncidentsView />);

      await user.click(await screen.findByRole("button", { name: "Declare incident" }));

      const form = screen.getByRole("region", { name: "Declare an incident" });
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

    it("explains a service archived meanwhile, and refreshes the services", async () => {
      const user = userEvent.setup();
      const { requests } = api(MEMBER, {
        handler: (request) =>
          route(request) === `POST ${base}/incidents`
            ? apiError(409, "SERVICE_ARCHIVED")
            : undefined,
      });

      inOrganization(<IncidentsView />);

      await user.click(await screen.findByRole("button", { name: "Declare incident" }));
      await user.selectOptions(await screen.findByLabelText("Affected service"), paymentApi.id);
      await user.click(
        within(screen.getByRole("region", { name: "Declare an incident" })).getByRole("button", {
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

    it("shows what the record holds, and no timeline", async () => {
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
      ).toBe("/orgs/acme-ops/teams/payments");
      expect(screen.getByText("Ada Lovelace")).toBeDefined();
      expect(screen.queryByText(/timeline/i)).toBeNull();
      // Read-only: nothing to change.
      expect(screen.queryByRole("button", { name: "Resolve…" })).toBeNull();
      expect(screen.queryByLabelText("Status")).toBeNull();
    });

    it("sends only what changed in the response", async () => {
      const user = userEvent.setup();
      const { requests } = api(MEMBER, {
        handler: (request) =>
          route(request) === `PATCH ${base}/incidents/42`
            ? jsonResponse(200, incident({ status: "IDENTIFIED", team: { id: platform.id, name: "Platform", slug: "platform" } }))
            : undefined,
      });

      inOrganization(<IncidentDetail />);

      const response = (await screen.findByRole("heading", { name: "Response" }))
        .closest("section") as HTMLElement;

      await user.selectOptions(within(response).getByLabelText("Status"), "IDENTIFIED");
      await user.selectOptions(await within(response).findByLabelText("Responsible team"), platform.id);
      await user.click(within(response).getByRole("button", { name: "Save" }));

      await waitFor(() =>
        expect(requests.find((r) => route(r) === `PATCH ${base}/incidents/42`)?.body).toEqual({
          status: "IDENTIFIED",
          teamId: platform.id,
        }),
      );
      // Resolving is its own action, never a status in this form.
      expect(within(response).queryByRole("option", { name: "Resolved" })).toBeNull();
    });

    it("resolves only after confirmation", async () => {
      const user = userEvent.setup();
      const { requests } = api(MEMBER, {
        handler: (request) =>
          route(request) === `PATCH ${base}/incidents/42`
            ? jsonResponse(200, incident({ status: "RESOLVED", resolvedAt: "2026-09-18T13:00:00.000Z" }))
            : undefined,
      });

      inOrganization(<IncidentDetail />);

      await user.click(await screen.findByRole("button", { name: "Resolve…" }));

      expect(requests.some((r) => r.method === "PATCH")).toBe(false);

      await user.click(screen.getByRole("button", { name: "Resolve incident" }));

      expect(await screen.findByText(/A resolved incident is kept as it is; if the problem returns/)).toBeDefined();
      expect(requests.find((r) => route(r) === `PATCH ${base}/incidents/42`)?.body).toEqual({
        status: "RESOLVED",
      });
      expect(screen.queryByLabelText("Status")).toBeNull();
    });

    it("offers nothing to change once resolved", async () => {
      api(MEMBER, {
        detail: incident({ status: "RESOLVED", resolvedAt: "2026-09-18T13:00:00.000Z" }),
      });

      inOrganization(<IncidentDetail />);

      expect(await screen.findByRole("heading", { level: 1 })).toBeDefined();
      expect(screen.getByText("Lasted")).toBeDefined();
      expect(screen.queryByRole("button", { name: "Resolve…" })).toBeNull();
      expect(screen.queryByRole("heading", { name: "Response" })).toBeNull();
      expect(screen.queryByRole("heading", { name: "Details" })).toBeNull();
      expect(screen.queryByRole("heading", { name: "People" })).toBeNull();
    });

    it("explains a change refused because someone resolved it meanwhile, and refetches it", async () => {
      const user = userEvent.setup();
      const { requests } = api(MEMBER, {
        handler: (request) =>
          route(request) === `PATCH ${base}/incidents/42`
            ? apiError(409, "INCIDENT_RESOLVED")
            : undefined,
      });

      inOrganization(<IncidentDetail />);

      const response = (await screen.findByRole("heading", { name: "Response" }))
        .closest("section") as HTMLElement;

      await user.selectOptions(within(response).getByLabelText("Severity"), "SEV2");
      await user.click(within(response).getByRole("button", { name: "Save" }));

      expect(await screen.findByText(/resolved by someone else/)).toBeDefined();
      await waitFor(() =>
        expect(count(requests, `GET ${base}/incidents/42`)).toBeGreaterThan(1),
      );
    });

    it("shows who leads and responds, with nothing to change for a reader", async () => {
      api(READ_ONLY, {
        detail: incident({
          lead: { membershipId: daniel.id, name: "Daniel Okafor" },
          responders: [
            { membershipId: daniel.id, name: "Daniel Okafor" },
            { membershipId: ada.id, name: "Ada Lovelace" },
          ],
        }),
      });

      inOrganization(<IncidentDetail />);

      expect(await screen.findByText("Incident lead")).toBeDefined();
      expect(screen.getByText("Daniel Okafor, Ada Lovelace")).toBeDefined();
      expect(screen.queryByRole("heading", { name: "People" })).toBeNull();
    });

    it("says plainly when nobody leads or responds yet", async () => {
      api(READ_ONLY);

      inOrganization(<IncidentDetail />);

      expect(await screen.findByText("No lead assigned")).toBeDefined();
      expect(screen.getByText("No responders yet")).toBeDefined();
    });

    it("assigns and clears the lead, from any member of the organization", async () => {
      const user = userEvent.setup();
      const { requests } = api(MEMBER, {
        handler: (request) =>
          route(request) === `PATCH ${base}/incidents/42`
            ? jsonResponse(
                200,
                incident({
                  lead: request.body && (request.body as { leadMembershipId: string | null }).leadMembershipId
                    ? { membershipId: daniel.id, name: "Daniel Okafor" }
                    : null,
                }),
              )
            : undefined,
      });

      inOrganization(<IncidentDetail />);

      const people = (await screen.findByRole("heading", { name: "People" }))
        .closest("section") as HTMLElement;

      await user.selectOptions(await within(people).findByLabelText("Incident lead"), daniel.id);
      await user.click(within(people).getByRole("button", { name: "Save lead" }));

      // The record shows the new lead once the API answers.
      await waitFor(() =>
        expect(
          screen.getByText("Incident lead", { selector: "dt" }).closest("div")?.textContent,
        ).toContain("Daniel Okafor"),
      );
      expect(requests.filter((r) => route(r) === `PATCH ${base}/incidents/42`)[0].body).toEqual({
        leadMembershipId: daniel.id,
      });

      await user.selectOptions(within(people).getByLabelText("Incident lead"), "");
      await user.click(within(people).getByRole("button", { name: "Save lead" }));

      await waitFor(() =>
        expect(requests.filter((r) => route(r) === `PATCH ${base}/incidents/42`)[1]?.body).toEqual({
          leadMembershipId: null,
        }),
      );
    });

    it("adds and removes responders", async () => {
      const user = userEvent.setup();
      const { requests } = api(MEMBER, {
        detail: incident({
          responders: [{ membershipId: ada.id, name: "Ada Lovelace" }],
        }),
        handler: (request) => {
          if (route(request) === `POST ${base}/incidents/42/responders`) {
            return jsonResponse(
              201,
              incident({
                responders: [
                  { membershipId: ada.id, name: "Ada Lovelace" },
                  { membershipId: daniel.id, name: "Daniel Okafor" },
                ],
              }),
            );
          }
          if (route(request) === `DELETE ${base}/incidents/42/responders/${ada.id}`) {
            return jsonResponse(204);
          }
          return undefined;
        },
      });

      inOrganization(<IncidentDetail />);

      const responders = (await screen.findByRole("heading", { name: "Responders" }))
        .closest("section") as HTMLElement;

      // Ada already responds, so only Daniel is offered.
      const add = await within(responders).findByLabelText("Add a responder");
      expect(within(add).getAllByRole("option").map((o) => o.textContent)).toEqual([
        "Daniel Okafor",
      ]);

      await user.click(within(responders).getByRole("button", { name: "Add responder" }));

      await waitFor(() =>
        expect(
          requests.find((r) => route(r) === `POST ${base}/incidents/42/responders`)?.body,
        ).toEqual({ membershipId: daniel.id }),
      );
      expect(await within(responders).findByText("Daniel Okafor")).toBeDefined();

      await user.click(
        within(responders).getByRole("button", { name: "Remove Ada Lovelace from responders" }),
      );

      await waitFor(() =>
        expect(count(requests, `DELETE ${base}/incidents/42/responders/${ada.id}`)).toBe(1),
      );
    });

    it("explains a responder refused because the incident was resolved meanwhile", async () => {
      const user = userEvent.setup();
      api(MEMBER, {
        handler: (request) =>
          route(request) === `POST ${base}/incidents/42/responders`
            ? apiError(409, "INCIDENT_RESOLVED")
            : undefined,
      });

      inOrganization(<IncidentDetail />);

      const responders = (await screen.findByRole("heading", { name: "Responders" }))
        .closest("section") as HTMLElement;

      await within(responders).findByLabelText("Add a responder");
      await user.click(within(responders).getByRole("button", { name: "Add responder" }));

      expect(await screen.findByText(/resolved by someone else/)).toBeDefined();
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
    it("stores a changed incident and stales both lists, and nothing outside incidents", () => {
      const queryClient = new QueryClient();
      const orgId = organization.id;
      const changed = incident({ status: "MONITORING" });

      queryClient.setQueryData(queryKeys.incidentList(orgId, "active"), { pages: [], pageParams: [] });
      queryClient.setQueryData(queryKeys.incidentList(orgId, "resolved"), { pages: [], pageParams: [] });
      queryClient.setQueryData(queryKeys.services(orgId), []);

      storeIncident(queryClient, orgId, changed);

      expect(queryClient.getQueryData(queryKeys.incident(orgId, 42))).toEqual(changed);
      expect(queryClient.getQueryState(queryKeys.incidentList(orgId, "active"))?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(queryKeys.incidentList(orgId, "resolved"))?.isInvalidated).toBe(true);
      expect(queryClient.getQueryState(queryKeys.services(orgId))?.isInvalidated).toBe(false);
      expect(queryClient.getQueryState(queryKeys.incident(orgId, 42))?.isInvalidated).toBe(false);
    });
  });
});
