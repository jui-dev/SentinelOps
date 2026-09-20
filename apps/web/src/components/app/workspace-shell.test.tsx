import { QueryClientProvider } from "@tanstack/react-query";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  IncidentAttentionResponse,
  IncidentDetailResponse,
} from "@/lib/api/contracts";
import { ATTENTION_POLL_MS } from "@/components/incidents/incident-queries";
import { queryKeys } from "@/lib/api/query-keys";
import { SessionProvider } from "@/lib/auth/session-provider";
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
import { expectNoAxeViolations } from "@/test/axe";
import { renderWithSession } from "@/test/render";

import { WorkspaceShell } from "./workspace-shell";

const navigation = vi.hoisted(() => ({
  params: {} as { orgSlug?: string },
  pathname: "/",
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => navigation.params,
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: vi.fn(), push: navigation.push }),
}));

const FULL = ["memberships:read", "organization:read", "organization:update"];
const READ = ["memberships:read", "organization:read"];

const other = {
  id: "0199a1b2-c3d4-7000-8000-00000000000b",
  name: "Borealis Platform",
  slug: "borealis",
  createdAt: "2026-09-02T12:00:00.000Z",
};

const api = ({
  permissions = FULL,
  memberships = currentUser.memberships,
}: { permissions?: string[]; memberships?: typeof currentUser.memberships } = {}) =>
  mockApi((request) => {
    switch (route(request)) {
      case "POST /auth/refresh":
        return refreshed("token");
      case "GET /auth/me":
        return jsonResponse(200, { ...currentUser, memberships });
      case `GET /organizations/${organization.id}`:
        return jsonResponse(200, organizationDetail(permissions));
      default:
        return apiError(404);
    }
  });

const at = (pathname: string, orgSlug?: string) => {
  navigation.pathname = pathname;
  navigation.params = orgSlug ? { orgSlug } : {};
};

const renderShell = () =>
  renderWithSession(
    <WorkspaceShell>
      <p>Page content</p>
    </WorkspaceShell>,
  );

const primaryNav = () => screen.getByRole("navigation", { name: "Primary" });

describe("WorkspaceShell", () => {
  beforeEach(() => {
    clearAccessToken();
    navigation.push.mockReset();
  });

  describe("inside an organization", () => {
    it("offers the organization's pages and marks the current one", async () => {
      at("/orgs/acme-ops/members", "acme-ops");
      api();

      renderShell();

      const settings = await within(primaryNav()).findByRole("link", {
        name: "Settings",
      });
      const members = within(primaryNav()).getByRole("link", { name: "Members" });
      const overview = within(primaryNav()).getByRole("link", {
        name: "Overview",
      });

      expect(members.getAttribute("aria-current")).toBe("page");
      expect(overview.getAttribute("aria-current")).toBeNull();
      expect(settings.getAttribute("href")).toBe("/orgs/acme-ops/settings");
    });

    it("marks Overview only on the overview itself", async () => {
      at("/orgs/acme-ops", "acme-ops");
      api();

      renderShell();

      const overview = await within(primaryNav()).findByRole("link", {
        name: "Overview",
      });

      expect(overview.getAttribute("aria-current")).toBe("page");
    });

    it("offers Teams only when the API reports teams:read", async () => {
      at("/orgs/acme-ops/teams/platform", "acme-ops");
      api({ permissions: [...READ, "teams:read"] });

      renderShell();

      const teams = await within(primaryNav()).findByRole("link", {
        name: "Teams",
      });

      expect(teams.getAttribute("href")).toBe("/orgs/acme-ops/teams");
      expect(teams.getAttribute("aria-current")).toBe("page");
    });

    it("does not offer Teams without teams:read", async () => {
      at("/orgs/acme-ops", "acme-ops");
      api({ permissions: READ });

      renderShell();

      expect(
        await within(primaryNav()).findByRole("link", { name: "Members" }),
      ).toBeDefined();
      expect(within(primaryNav()).queryByRole("link", { name: "Teams" })).toBeNull();
    });

    it("offers Services, under Operations, only when the API reports services:read", async () => {
      at("/orgs/acme-ops/services/payment-api/settings", "acme-ops");
      api({ permissions: [...READ, "services:read"] });

      renderShell();

      const services = await within(primaryNav()).findByRole("link", {
        name: "Services",
      });

      expect(services.getAttribute("href")).toBe("/orgs/acme-ops/services");
      expect(services.getAttribute("aria-current")).toBe("page");
      expect(within(primaryNav()).getByText("Operations")).toBeDefined();
    });

    it("offers Incidents first under Operations, only when the API reports incidents:read", async () => {
      at("/orgs/acme-ops/incidents/42", "acme-ops");
      api({ permissions: [...READ, "incidents:read", "services:read"] });

      renderShell();

      const incidents = await within(primaryNav()).findByRole("link", {
        name: "Incidents",
      });
      const operations = within(primaryNav())
        .getByText("Operations")
        .closest("div,section,li") as HTMLElement;

      expect(incidents.getAttribute("href")).toBe("/orgs/acme-ops/incidents");
      expect(incidents.getAttribute("aria-current")).toBe("page");
      expect(
        within(operations)
          .getAllByRole("link")
          .map((link) => link.textContent),
      ).toEqual(["Incidents", "Services"]);
    });

    it("keeps Incidents current on Incident history, without a rail item of its own", async () => {
      at("/orgs/acme-ops/incidents/history", "acme-ops");
      api({ permissions: [...READ, "incidents:read", "services:read"] });

      renderShell();

      const incidents = await within(primaryNav()).findByRole("link", {
        name: "Incidents",
      });

      // History is part of the Incidents domain, so the rail says so.
      expect(incidents.getAttribute("aria-current")).toBe("page");
      expect(
        within(primaryNav()).queryByRole("link", { name: /history/i }),
      ).toBeNull();
    });

    it("does not offer Incidents without incidents:read", async () => {
      at("/orgs/acme-ops", "acme-ops");
      api({ permissions: [...READ, "services:read"] });

      renderShell();

      await within(primaryNav()).findByRole("link", { name: "Services" });

      expect(
        within(primaryNav()).queryByRole("link", { name: "Incidents" }),
      ).toBeNull();
    });

    it("does not offer Services without services:read", async () => {
      at("/orgs/acme-ops", "acme-ops");
      api({ permissions: READ });

      renderShell();

      expect(
        await within(primaryNav()).findByRole("link", { name: "Members" }),
      ).toBeDefined();
      expect(
        within(primaryNav()).queryByRole("link", { name: "Services" }),
      ).toBeNull();
      // A section with nothing to offer is not shown at all.
      expect(within(primaryNav()).queryByText("Operations")).toBeNull();
    });

    it("does not offer Settings without organization:update", async () => {
      at("/orgs/acme-ops", "acme-ops");
      const { requests } = api({ permissions: READ });

      renderShell();

      await vi.waitFor(() =>
        expect(
          requests.some((r) => r.path === `/organizations/${organization.id}`),
        ).toBe(true),
      );
      expect(
        await within(primaryNav()).findByRole("link", { name: "Members" }),
      ).toBeDefined();
      expect(
        within(primaryNav()).queryByRole("link", { name: "Settings" }),
      ).toBeNull();
    });

    it("names the organization in the situation strip", async () => {
      at("/orgs/acme-ops", "acme-ops");
      api();

      renderShell();

      const strip = screen.getByRole("banner");

      expect(await within(strip).findByText(organization.name)).toBeDefined();
      expect(within(strip).getByText(organization.slug)).toBeDefined();
    });

    it("switches organization when there is more than one", async () => {
      const user = userEvent.setup();

      at("/orgs/acme-ops", "acme-ops");
      api({
        memberships: [
          ...currentUser.memberships,
          { id: "m-2", role: "MEMBER", organization: other },
        ],
      });

      renderShell();

      const switcher = await within(primaryNav()).findByRole("combobox", {
        name: "Organization",
      });

      await user.selectOptions(switcher, "borealis");

      expect(navigation.push).toHaveBeenCalledWith("/orgs/borealis");
    });
  });

  describe("outside an organization", () => {
    it("offers the organization list and asks for no organization", async () => {
      at("/orgs");
      const { requests } = api();

      renderShell();

      const link = await within(primaryNav()).findByRole("link", {
        name: "Organizations",
      });

      expect(link.getAttribute("aria-current")).toBe("page");
      expect(
        within(primaryNav()).queryByRole("link", { name: "Overview" }),
      ).toBeNull();
      expect(requests.filter((r) => r.path.startsWith("/organizations"))).toEqual(
        [],
      );
    });
  });

  it("has landmarks, a skip link to the content, and a way to log out", async () => {
    at("/orgs/acme-ops", "acme-ops");
    api();

    renderShell();

    const skip = screen.getByRole("link", { name: "Skip to content" });

    expect(skip.getAttribute("href")).toBe("#main");
    expect(screen.getByRole("main").id).toBe("main");
    expect(screen.getByRole("main").textContent).toContain("Page content");
    expect(
      await screen.findByRole("button", { name: "Log out" }),
    ).toBeDefined();
  });

  it("opens the navigation as a drawer and closes it again", async () => {
    const user = userEvent.setup();

    at("/orgs/acme-ops", "acme-ops");
    api();

    renderShell();

    expect(screen.queryByRole("dialog")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Open navigation" }));

    const drawer = await screen.findByRole("dialog", { name: "Navigation" });

    expect(
      await within(drawer).findByRole("link", { name: "Members" }),
    ).toBeDefined();

    await user.click(
      within(drawer).getByRole("button", { name: "Close navigation" }),
    );

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  describe("the incidents attention count", () => {
    const WITH_INCIDENTS = [...READ, "incidents:read", "incidents:respond"];

    /** An attention entry: only the id matters to the count. */
    const item = (id: string) =>
      ({ id, number: 1 }) as unknown as IncidentDetailResponse;

    const attentionOf = ({
      ready,
      needs = [],
      yours = [],
    }: {
      ready?: string[];
      needs?: string[];
      yours?: string[];
    }): IncidentAttentionResponse => ({
      manage: ready ? { readyToResolve: ready.map(item) } : null,
      respond: {
        needsYourTeam: needs.map(item),
        yourResponses: yours.map(item),
      },
    });

    /**
     * Two organizations, each with its own detail and attention. Anything
     * else is 404.
     */
    const attentionApi = (
      attention: Record<string, IncidentAttentionResponse | (() => Response)>,
      permissions = WITH_INCIDENTS,
    ) =>
      mockApi((request) => {
        const orgId = Object.keys(attention).find((id) =>
          request.path.startsWith(`/organizations/${id}`),
        );

        switch (route(request)) {
          case "POST /auth/refresh":
            return refreshed("token");
          case "GET /auth/me":
            return jsonResponse(200, {
              ...currentUser,
              memberships: [
                ...currentUser.memberships,
                { id: "m-2", role: "MEMBER", organization: other },
              ],
            });
          case `GET /organizations/${orgId}`:
            return jsonResponse(200, {
              ...organizationDetail(permissions),
              ...(orgId === other.id ? other : organization),
            });
          case `GET /organizations/${orgId}/incidents/attention`: {
            const answer = attention[orgId!];

            return typeof answer === "function"
              ? answer()
              : jsonResponse(200, answer);
          }
          default:
            return apiError(404);
        }
      });

    const incidentsLink = (name: string | RegExp) =>
      within(primaryNav()).findByRole("link", { name });

    it("counts what is ready to resolve beside Incidents", async () => {
      at("/orgs/acme-ops/members", "acme-ops");
      attentionApi({
        [organization.id]: attentionOf({ ready: ["a", "b"] }),
      });

      const { container } = renderShell();

      const link = await incidentsLink("Incidents, 2 need your attention");

      expect(link.textContent).toBe("Incidents2, 2 need your attention");
      await expectNoAxeViolations(container);
    });

    it("is what polls attention, every 30 seconds", async () => {
      at("/orgs/acme-ops", "acme-ops");
      attentionApi({ [organization.id]: attentionOf({ needs: ["a"] }) });

      const { queryClient } = renderShell();

      await incidentsLink("Incidents, 1 needs your attention");

      const observers = queryClient
        .getQueryCache()
        .find({ queryKey: queryKeys.incidentAttention(organization.id) })!
        .observers;

      expect(observers.length).toBeGreaterThan(0);
      expect(
        observers.every(
          ({ options }) => options.refetchInterval === ATTENTION_POLL_MS,
        ),
      ).toBe(true);
      expect(ATTENTION_POLL_MS).toBe(30_000);
    });

    it("counts a team's incident needing a responder", async () => {
      at("/orgs/acme-ops", "acme-ops");
      attentionApi({ [organization.id]: attentionOf({ needs: ["a"] }) });

      renderShell();

      expect(
        await incidentsLink("Incidents, 1 needs your attention"),
      ).toBeDefined();
    });

    it("counts the caller's own response under way", async () => {
      at("/orgs/acme-ops", "acme-ops");
      attentionApi({ [organization.id]: attentionOf({ yours: ["a"] }) });

      renderShell();

      expect(
        await incidentsLink("Incidents, 1 needs your attention"),
      ).toBeDefined();
    });

    it("counts every list once per incident", async () => {
      at("/orgs/acme-ops", "acme-ops");
      attentionApi({
        // "a" is resolvable and reassigned to the caller's team: one incident.
        [organization.id]: attentionOf({
          ready: ["a"],
          needs: ["a", "b"],
          yours: ["c"],
        }),
      });

      renderShell();

      expect(
        await incidentsLink("Incidents, 3 need your attention"),
      ).toBeDefined();
    });

    it("shows nothing when nothing is waiting", async () => {
      at("/orgs/acme-ops", "acme-ops");
      const { requests } = attentionApi({
        [organization.id]: attentionOf({ ready: [] }),
      });

      renderShell();

      await vi.waitFor(() =>
        expect(
          requests.some((r) => r.path.endsWith("/incidents/attention")),
        ).toBe(true),
      );

      const link = await incidentsLink("Incidents");

      expect(link.textContent).toBe("Incidents");
    });

    it("asks nothing without incidents:read", async () => {
      at("/orgs/acme-ops", "acme-ops");
      const { requests } = attentionApi(
        { [organization.id]: attentionOf({ ready: ["a"] }) },
        READ,
      );

      renderShell();

      await within(primaryNav()).findByRole("link", { name: "Members" });

      expect(
        requests.filter((r) => r.path.endsWith("/incidents/attention")),
      ).toEqual([]);
    });

    it("keeps the navigation, with no count, when attention cannot be read", async () => {
      at("/orgs/acme-ops", "acme-ops");
      const { requests } = attentionApi({
        [organization.id]: () => apiError(500),
      });

      renderShell();

      // Refused twice: the first answer and its one retry.
      await vi.waitFor(
        () =>
          expect(
            requests.filter((r) => r.path.endsWith("/incidents/attention")),
          ).toHaveLength(2),
        { timeout: 4000 },
      );

      expect((await incidentsLink("Incidents")).textContent).toBe("Incidents");
      expect(within(primaryNav()).queryByRole("alert")).toBeNull();
      expect(
        within(primaryNav()).getByRole("link", { name: "Members" }),
      ).toBeDefined();
    });

    it("follows the organization, never showing one's count in another", async () => {
      at("/orgs/acme-ops", "acme-ops");
      const { requests } = attentionApi({
        [organization.id]: attentionOf({ ready: ["a", "b"] }),
        [other.id]: attentionOf({ needs: ["c"] }),
      });

      const { rerender, queryClient } = renderShell();

      await incidentsLink("Incidents, 2 need your attention");

      at("/orgs/borealis", "borealis");
      rerender(
        <StrictMode>
          <QueryClientProvider client={queryClient}>
            <SessionProvider>
              <WorkspaceShell>
                <p>Page content</p>
              </WorkspaceShell>
            </SessionProvider>
          </QueryClientProvider>
        </StrictMode>,
      );

      expect(
        await incidentsLink("Incidents, 1 needs your attention"),
      ).toBeDefined();
      expect(
        requests.some(
          (r) => r.path === `/organizations/${other.id}/incidents/attention`,
        ),
      ).toBe(true);
    });
  });
});
