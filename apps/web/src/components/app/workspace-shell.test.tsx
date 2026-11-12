import { QueryClientProvider } from "@tanstack/react-query";
import { screen, waitFor, within } from "@testing-library/react";
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

const FULL = [
  "memberships:read",
  "memberships:read-all",
  "organization:read",
  "organization:update",
  // Works responses, so home is My Operations without oversight.
  "responses:work",
];
const READ = ["memberships:read", "memberships:read-all", "organization:read"];

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

/** A rail section's list, found by the heading that labels it. */
const sectionOf = (heading: string) =>
  within(primaryNav()).getByRole("list", { name: heading });

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
      // Not an overseer, so the home item is their own.
      const overview = within(primaryNav()).getByRole("link", {
        name: "My Operations",
      });

      expect(members.getAttribute("aria-current")).toBe("page");
      expect(overview.getAttribute("aria-current")).toBeNull();
      expect(settings.getAttribute("href")).toBe("/orgs/acme-ops/settings");
    });

    it("marks Overview only on the overview itself", async () => {
      at("/orgs/acme-ops", "acme-ops");
      api({ permissions: [...READ, "incidents:read-all"] });

      renderShell();

      const overview = await within(primaryNav()).findByRole("link", {
        name: "Overview",
      });

      expect(overview.getAttribute("aria-current")).toBe("page");
      expect(overview.getAttribute("href")).toBe("/orgs/acme-ops");
    });

    // The same address answers a member with My Operations, so the rail
    // names it for them.
    it("names the home item My Operations for a caller who does not oversee", async () => {
      at("/orgs/acme-ops", "acme-ops");
      api();

      renderShell();

      const home = await within(primaryNav()).findByRole("link", {
        name: "My Operations",
      });

      expect(home.getAttribute("aria-current")).toBe("page");
      expect(home.getAttribute("href")).toBe("/orgs/acme-ops");
      expect(within(primaryNav()).queryByRole("link", { name: "Overview" })).toBeNull();
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

    it("offers Services, under Organization, only when the API reports services:read", async () => {
      at("/orgs/acme-ops/services/payment-api/settings", "acme-ops");
      api({ permissions: [...READ, "services:read"] });

      renderShell();

      const services = await within(primaryNav()).findByRole("link", {
        name: "Services",
      });

      expect(services.getAttribute("href")).toBe("/orgs/acme-ops/services");
      expect(services.getAttribute("aria-current")).toBe("page");
      expect(
        within(sectionOf("Organization"))
          .getAllByRole("link")
          .map((link) => link.textContent),
      ).toContain("Services");
      // Known issues are the Admin's, and services:read alone is not that.
      expect(within(primaryNav()).queryByRole("link", { name: "Known issues" })).toBeNull();
    });

    it("offers Known issues to the Admin, beneath Services, and marks it on its page", async () => {
      at("/orgs/acme-ops/known-issues", "acme-ops");
      api({ permissions: [...READ, "services:read", "services:manage"] });

      renderShell();

      const known = await within(primaryNav()).findByRole("link", {
        name: "Known issues",
      });
      const links = within(sectionOf("Organization"))
        .getAllByRole("link")
        .map((link) => link.textContent);

      expect(known.getAttribute("href")).toBe("/orgs/acme-ops/known-issues");
      expect(known.getAttribute("aria-current")).toBe("page");
      expect(links.indexOf("Known issues")).toBe(links.indexOf("Services") + 1);
      expect(
        within(primaryNav())
          .getByRole("link", { name: "Services" })
          .getAttribute("aria-current"),
      ).toBeNull();
    });

    it("orders the rail as home, then Organization in setup order, then Response", async () => {
      at("/orgs/acme-ops", "acme-ops");
      api({
        permissions: [
          ...FULL,
          "teams:read",
          "services:read",
          "incidents:read",
          "incidents:read-all",
        ],
      });

      renderShell();

      await within(primaryNav()).findByRole("link", { name: "Incidents" });

      // Teams before the members placed on them, what their roles mean,
      // and the services they own.
      expect(
        within(sectionOf("Organization"))
          .getAllByRole("link")
          .map((link) => link.textContent),
      ).toEqual(["Teams", "Members", "Roles", "Services"]);
      expect(
        within(sectionOf("Response"))
          .getAllByRole("link")
          .map((link) => link.textContent),
      ).toEqual(["Incidents", "Incident history"]);
      // Overview, set up, then respond — top to bottom.
      expect(
        within(primaryNav())
          .getAllByRole("link")
          .map((link) => link.textContent),
      ).toEqual([
        "Overview",
        "Teams",
        "Members",
        "Roles",
        "Services",
        "Incidents",
        "Incident history",
        "Settings",
      ]);
    });

    it("gives the Admin an Audit section holding the Activity log, after Response, and nobody else", async () => {
      at("/orgs/acme-ops/activity", "acme-ops");
      api({
        permissions: [...FULL, "incidents:read", "incidents:read-all", "activity:read"],
      });

      const { unmount } = renderShell();

      await within(primaryNav()).findByRole("link", { name: "Activity log" });

      const log = within(sectionOf("Audit")).getByRole("link", {
        name: "Activity log",
      });

      expect(log.getAttribute("href")).toBe("/orgs/acme-ops/activity");
      expect(log.getAttribute("aria-current")).toBe("page");
      expect(
        within(primaryNav())
          .getAllByRole("link")
          .map((link) => link.textContent)
          .slice(-3),
      ).toEqual(["Incident history", "Activity log", "Settings"]);

      unmount();
      api({ permissions: [...FULL, "incidents:read", "incidents:read-all"] });
      renderShell();

      await within(primaryNav()).findByRole("link", { name: "Incidents" });
      expect(within(primaryNav()).queryByText("Audit")).toBeNull();
      expect(
        within(primaryNav()).queryByRole("link", { name: "Activity log" }),
      ).toBeNull();
    });

    it("offers Incidents under Response, only when the API reports incidents:read", async () => {
      at("/orgs/acme-ops/incidents/42", "acme-ops");
      api({ permissions: [...READ, "incidents:read", "services:read"] });

      renderShell();

      const incidents = await within(primaryNav()).findByRole("link", {
        name: "Incidents",
      });

      expect(incidents.getAttribute("href")).toBe("/orgs/acme-ops/incidents");
      expect(incidents.getAttribute("aria-current")).toBe("page");
      expect(
        within(sectionOf("Response"))
          .getAllByRole("link")
          .map((link) => link.textContent),
      ).toEqual(["Incidents"]);
    });

    it("offers Incident history with incidents:read-all, and marks it alone current there", async () => {
      at("/orgs/acme-ops/incidents/history", "acme-ops");
      api({ permissions: [...READ, "incidents:read", "incidents:read-all"] });

      renderShell();

      const history = await within(primaryNav()).findByRole("link", {
        name: "Incident history",
      });
      const incidents = within(primaryNav()).getByRole("link", {
        name: "Incidents",
      });

      expect(history.getAttribute("href")).toBe(
        "/orgs/acme-ops/incidents/history",
      );
      // The most specific item wins: history lives beneath Incidents.
      expect(history.getAttribute("aria-current")).toBe("page");
      expect(incidents.getAttribute("aria-current")).toBeNull();
    });

    it("keeps Incidents current on an incident, not Incident history", async () => {
      at("/orgs/acme-ops/incidents/42", "acme-ops");
      api({ permissions: [...READ, "incidents:read", "incidents:read-all"] });

      renderShell();

      const history = await within(primaryNav()).findByRole("link", {
        name: "Incident history",
      });

      expect(
        within(primaryNav())
          .getByRole("link", { name: "Incidents" })
          .getAttribute("aria-current"),
      ).toBe("page");
      expect(history.getAttribute("aria-current")).toBeNull();
    });

    it("does not offer Incident history without incidents:read-all, and keeps Incidents current there", async () => {
      at("/orgs/acme-ops/incidents/history", "acme-ops");
      api({ permissions: [...READ, "incidents:read"] });

      renderShell();

      const incidents = await within(primaryNav()).findByRole("link", {
        name: "Incidents",
      });

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
      expect(within(primaryNav()).queryByText("Response")).toBeNull();
    });

    it("does not offer Members without memberships:read-all", async () => {
      at("/orgs/acme-ops", "acme-ops");
      api({ permissions: ["memberships:read", "organization:read", "teams:read"] });

      renderShell();

      // Their teammates are on their teams' pages.
      expect(await within(primaryNav()).findByRole("link", { name: "Teams" })).toBeDefined();
      expect(within(primaryNav()).queryByRole("link", { name: "Members" })).toBeNull();
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
          { id: "m-2", role: "RESPONDER", organization: other },
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

  it("has landmarks and a skip link to the content", async () => {
    at("/orgs/acme-ops", "acme-ops");
    api();

    renderShell();

    const skip = screen.getByRole("link", { name: "Skip to content" });

    expect(skip.getAttribute("href")).toBe("#main");
    expect(screen.getByRole("main").id).toBe("main");
    expect(screen.getByRole("main").textContent).toContain("Page content");
  });

  describe("the strip's utilities", () => {
    it("names who is signed in, in what capacity here, and logs out from the account menu", async () => {
      const user = userEvent.setup();

      at("/orgs/acme-ops", "acme-ops");
      const { requests } = api();

      const { container } = renderShell();

      const account = await screen.findByRole("button", {
        name: "Account: Ada Lovelace",
      });

      expect(account.getAttribute("aria-haspopup")).toBe("menu");
      // The rail no longer carries the account.
      expect(within(primaryNav()).queryByText("Ada Lovelace")).toBeNull();

      await user.click(account);

      const menu = screen.getByRole("menu", { name: "Account" });

      expect(menu.textContent).toContain("Ada Lovelace");
      expect(menu.textContent).toContain("ada@example.com");
      expect(menu.textContent).toContain("Admin · Acme Operations");
      await expectNoAxeViolations(container);

      await user.click(within(menu).getByRole("menuitem", { name: "Log out" }));

      expect(screen.queryByRole("menu")).toBeNull();
      await vi.waitFor(() =>
        expect(
          requests.some(
            (r) => r.method === "POST" && r.path === "/auth/logout",
          ),
        ).toBe(true),
      );
    });

    it("claims no organization role outside an organization", async () => {
      const user = userEvent.setup();

      at("/orgs");
      api();

      renderShell();

      await user.click(
        await screen.findByRole("button", { name: "Account: Ada Lovelace" }),
      );

      const menu = screen.getByRole("menu", { name: "Account" });

      expect(menu.textContent).toContain("ada@example.com");
      expect(menu.textContent).not.toContain("Admin");
      // No organization, so no membership of theirs to open.
      expect(within(menu).queryByRole("menuitem", { name: "Your profile" })).toBeNull();
    });

    it("opens their own member page from the account menu", async () => {
      const user = userEvent.setup();

      at("/orgs/acme-ops", "acme-ops");
      api();

      renderShell();

      await user.click(
        await screen.findByRole("button", { name: "Account: Ada Lovelace" }),
      );
      await user.click(
        within(screen.getByRole("menu", { name: "Account" })).getByRole("menuitem", {
          name: "Your profile",
        }),
      );

      expect(screen.queryByRole("menu")).toBeNull();
      expect(navigation.push).toHaveBeenCalledWith(
        "/orgs/acme-ops/members/0199a1b2-c3d4-7000-8000-0000000000aa",
      );
    });

    it("offers the organization's notifications from the bell, and none outside it", async () => {
      at("/orgs/acme-ops", "acme-ops");
      api({ permissions: [...FULL, "notifications:read"] });

      const { unmount } = renderShell();

      await waitFor(() =>
        expect(
          screen
            .getByRole("button", { name: /^Notifications/ })
            .getAttribute("aria-haspopup"),
        ).toBe("dialog"),
      );

      unmount();
      at("/orgs");
      api();
      renderShell();

      expect(
        screen
          .getByRole("button", {
            name: "Open an organization to see its notifications",
          })
          .getAttribute("aria-disabled"),
      ).toBe("true");
    });

    it("shows the UTC date and time to the minute, with local time on hover", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-09-21T16:19:42.000Z"));

      try {
        at("/orgs/acme-ops", "acme-ops");
        api();

        const { container } = renderShell();
        const clock = container.querySelector("header time")!;

        expect(clock.getAttribute("dateTime")).toBe("2026-09-21T16:19:42.000Z");
        expect(clock.textContent).toBe("Sep 21, 202616:19 · UTC");
        expect(clock.getAttribute("title")).toMatch(
          /^Local time: .+ \(UTC([+-]\d{1,2}(:\d{2})?)?\)$/,
        );
      } finally {
        vi.useRealTimers();
      }
    });
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
      manage: ready ? { needsDecision: [], readyToResolve: ready.map(item) } : null,
      respond: {
        assignedToYou: [],
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
                { id: "m-2", role: "RESPONDER", organization: other },
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
