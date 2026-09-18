import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OrganizationScope } from "@/components/organizations/organization-scope";
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
import { ServiceSettings } from "./service-settings";
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

const paymentApi = {
  id: "0199a1b2-c3d4-7000-8000-0000000000e1",
  name: "Payment API",
  slug: "payment-api",
  description: "Takes card payments.",
  criticality: "CRITICAL" as const,
  ownerTeam: { id: payments.id, name: payments.name, slug: payments.slug },
  createdAt: "2026-09-18T12:00:00.000Z",
  updatedAt: "2026-09-18T13:00:00.000Z",
};

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
    it("lists services with their owner and criticality, without slugs or health", async () => {
      api(READ);

      inOrganization(<ServicesView />);

      const link = await screen.findByRole("link", { name: "Payment API" });

      expect(link.getAttribute("href")).toBe(
        "/orgs/acme-ops/services/payment-api",
      );
      expect(
        screen.getByRole("link", { name: "Payments" }).getAttribute("href"),
      ).toBe("/orgs/acme-ops/teams/payments");
      expect(screen.getByText("Critical")).toBeDefined();
      expect(screen.getByText("Takes card payments.")).toBeDefined();
      expect(screen.queryByText("payment-api")).toBeNull();
      expect(screen.queryByText(/healthy|degraded|outage/i)).toBeNull();
    });

    it("offers no creation without services:manage", async () => {
      api(READ, { services: [] });

      inOrganization(<ServicesView />);

      expect(await screen.findByText("No services yet")).toBeDefined();
      expect(screen.getByText(/An owner or admin can add one/)).toBeDefined();
      expect(screen.queryByRole("button", { name: "New service" })).toBeNull();
    });

    it("does not tell a manager with the form open that someone else must add one", async () => {
      const user = userEvent.setup();
      api(MANAGE, { services: [] });

      inOrganization(<ServicesView />);

      await user.click(
        (await screen.findAllByRole("button", { name: "New service" }))[0],
      );
      await screen.findByLabelText("Criticality");

      expect(screen.getByText("No services yet")).toBeDefined();
      expect(screen.queryByText(/An owner or admin can add one/)).toBeNull();
    });

    it("explains that a service needs a team when there are none", async () => {
      const user = userEvent.setup();
      api(MANAGE, { services: [], teams: [] });

      inOrganization(<ServicesView />);

      await user.click(
        (await screen.findAllByRole("button", { name: "New service" }))[0],
      );

      const form = screen.getByRole("region", { name: "New service" });

      expect(await within(form).findByText("Create a team first")).toBeDefined();
      expect(
        within(form).getByRole("link", { name: "Go to Teams" }).getAttribute("href"),
      ).toBe("/orgs/acme-ops/teams");
      expect(within(form).queryByLabelText("Name")).toBeNull();
    });

    it("creates a service from name, description, owner, and criticality, then opens it", async () => {
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

      const form = screen.getByRole("region", { name: "New service" });

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
        expect(navigation.push).toHaveBeenCalledWith(
          "/orgs/acme-ops/services/storefront",
        ),
      );
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

  describe("a service", () => {
    beforeEach(() => {
      navigation.params = { orgSlug: "acme-ops", serviceSlug: "payment-api" };
    });

    it("shows its name, description, owner, and what its criticality means — nothing invented", async () => {
      api(READ);

      inService(<ServiceDetail />);

      expect(
        await screen.findByRole("heading", { level: 1, name: "Payment API" }),
      ).toBeDefined();
      expect(screen.getByText("Takes card payments.")).toBeDefined();
      expect(
        screen.getByRole("link", { name: "Payments" }).getAttribute("href"),
      ).toBe("/orgs/acme-ops/teams/payments");
      expect(screen.getByText("Critical")).toBeDefined();
      expect(
        screen.getByText(/Failure stops the organization's core work/),
      ).toBeDefined();
      expect(screen.queryByText("payment-api")).toBeNull();
      expect(screen.queryByText(/incident/i)).toBeNull();
      expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
    });

    it("offers settings to those who may manage services", async () => {
      api(MANAGE);

      inService(<ServiceDetail />);

      expect(
        (await screen.findByRole("link", { name: "Settings" })).getAttribute(
          "href",
        ),
      ).toBe("/orgs/acme-ops/services/payment-api/settings");
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

  describe("settings", () => {
    beforeEach(() => {
      navigation.params = { orgSlug: "acme-ops", serviceSlug: "payment-api" };
    });

    it("saves the name, description, and criticality", async () => {
      const user = userEvent.setup();
      const { requests } = api(MANAGE, {
        handler: (request) =>
          route(request) === `PATCH ${base}/services/${paymentApi.id}`
            ? jsonResponse(200, { ...paymentApi, criticality: "HIGH" })
            : undefined,
      });

      inService(<ServiceSettings />);

      const details = (await screen.findByRole("heading", { name: "Details" }))
        .closest("section") as HTMLElement;

      await user.selectOptions(
        within(details).getByLabelText("Criticality"),
        "HIGH",
      );
      await user.click(within(details).getByRole("button", { name: "Save" }));

      expect(await screen.findByText("Service updated.")).toBeDefined();
      expect(
        requests.find(
          (r) => route(r) === `PATCH ${base}/services/${paymentApi.id}`,
        )?.body,
      ).toEqual({
        name: "Payment API",
        description: "Takes card payments.",
        criticality: "HIGH",
      });
    });

    it("moves the service to another team and refreshes team counts", async () => {
      const user = userEvent.setup();
      const moved = {
        ...paymentApi,
        ownerTeam: { id: platform.id, name: "Platform", slug: "platform" },
      };
      const { requests } = api(MANAGE, {
        handler: (request) =>
          route(request) === `PATCH ${base}/services/${paymentApi.id}`
            ? jsonResponse(200, moved)
            : undefined,
      });

      inService(<ServiceSettings />);

      const select = await screen.findByRole("combobox", {
        name: "Owner team",
      });

      expect((select as HTMLSelectElement).value).toBe(payments.id);

      await user.selectOptions(select, platform.id);
      await user.click(screen.getByRole("button", { name: "Change owner" }));

      expect(await screen.findByText("Now owned by Platform.")).toBeDefined();
      expect(
        requests.find(
          (r) => route(r) === `PATCH ${base}/services/${paymentApi.id}`,
        )?.body,
      ).toEqual({ ownerTeamId: platform.id });
      await waitFor(() =>
        expect(count(requests, `GET ${base}/teams`)).toBeGreaterThan(1),
      );
    });

    it("deletes only after confirmation, then returns to the list", async () => {
      const user = userEvent.setup();
      const { requests } = api(MANAGE, {
        handler: (request) =>
          route(request) === `DELETE ${base}/services/${paymentApi.id}`
            ? jsonResponse(204)
            : undefined,
      });

      inService(<ServiceSettings />);

      await user.click(
        await screen.findByRole("button", { name: "Delete service…" }),
      );

      expect(requests.some((r) => r.method === "DELETE")).toBe(false);

      await user.click(screen.getByRole("button", { name: "Delete service" }));

      await waitFor(() =>
        expect(navigation.push).toHaveBeenCalledWith("/orgs/acme-ops/services"),
      );
      expect(
        requests.some(
          (r) => route(r) === `DELETE ${base}/services/${paymentApi.id}`,
        ),
      ).toBe(true);
    });

    it("offers nothing to change without services:manage", async () => {
      api(READ);

      inService(<ServiceSettings />);

      expect(
        await screen.findByText(/do not have permission to change this service/),
      ).toBeDefined();
      expect(screen.queryByLabelText("Name")).toBeNull();
    });
  });
});
