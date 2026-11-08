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

import { TeamDetail } from "./team-detail";
import { TeamScope } from "./team-scope";
import { TeamsView } from "./teams-view";

const navigation = vi.hoisted(() => ({
  params: { orgSlug: "acme-ops" } as { orgSlug: string; teamId?: string },
  pathname: "/orgs/acme-ops/teams",
  push: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => navigation.params,
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: navigation.replace, push: navigation.push }),
}));

const MANAGE = [
  "memberships:read",
  "organization:read",
  "teams:manage",
  "teams:read",
];
const READ = ["memberships:read", "organization:read", "teams:read"];

const base = `/organizations/${organization.id}`;

const platform = {
  id: "0199a1b2-c3d4-7000-8000-0000000000d1",
  name: "Platform",
  slug: "platform",
  description: "Owns the runtime.",
  memberCount: 1,
  serviceCount: 0,
  createdAt: "2026-09-18T12:00:00.000Z",
  updatedAt: "2026-09-18T12:00:00.000Z",
};

const ada = {
  id: currentUser.memberships[0].id,
  role: "ADMIN",
  createdAt: "2026-09-01T12:00:00.000Z",
  user: { id: currentUser.id, name: "Ada Lovelace", email: "ada@example.com" },
};

const grace = {
  id: "0199a1b2-c3d4-7000-8000-0000000000ab",
  role: "MEMBER",
  createdAt: "2026-09-02T12:00:00.000Z",
  user: {
    id: "0199a1b2-c3d4-7000-8000-000000000002",
    name: "Grace Hopper",
    email: "grace@example.com",
  },
};

const adaOnTeam = {
  membershipId: ada.id,
  addedAt: "2026-09-18T12:00:00.000Z",
  user: ada.user,
};

const runtimeApi = {
  id: "0199a1b2-c3d4-7000-8000-0000000000e1",
  name: "Runtime API",
  slug: "runtime-api",
  description: null,
  criticality: "HIGH",
  ownerTeam: { id: platform.id, name: platform.name, slug: platform.slug },
  createdAt: "2026-09-18T12:00:00.000Z",
  updatedAt: "2026-09-18T12:00:00.000Z",
};

const otherTeamsService = {
  ...runtimeApi,
  id: "0199a1b2-c3d4-7000-8000-0000000000e2",
  name: "Checkout",
  slug: "checkout",
  ownerTeam: {
    id: "0199a1b2-c3d4-7000-8000-0000000000d9",
    name: "Commerce",
    slug: "commerce",
  },
};

/** READ, plus reading services — what every role holds today. */
const READ_WITH_SERVICES = [...READ, "services:read"];

type Handler = (request: SentRequest) => Response | undefined;

const api = (
  permissions: string[],
  {
    teams = [platform],
    handler = () => undefined,
  }: { teams?: (typeof platform)[]; handler?: Handler } = {},
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
      case `GET ${base}/teams`:
        return jsonResponse(200, teams);
      case `GET ${base}/memberships`:
        return jsonResponse(200, [ada, grace]);
      case `GET ${base}/teams/${platform.id}/members`:
        return jsonResponse(200, [adaOnTeam]);
      case `GET ${base}/services`:
        return jsonResponse(200, [runtimeApi, otherTeamsService]);
      default:
        return apiError(404);
    }
  });

const inOrganization = (page: React.ReactNode) =>
  renderWithSession(<OrganizationScope>{page}</OrganizationScope>);

const inTeam = (page: React.ReactNode) =>
  inOrganization(<TeamScope>{page}</TeamScope>);

describe("teams", () => {
  beforeEach(() => {
    clearAccessToken();
    navigation.params = { orgSlug: "acme-ops" };
    navigation.push.mockReset();
  });

  describe("the list", () => {
    it("lists teams as plain names, each opened from its View action at the slug address", async () => {
      api(READ);

      inOrganization(<TeamsView />);

      const view = await screen.findByRole("link", { name: "View Platform" });

      expect(view.getAttribute("href")).toBe("/orgs/acme-ops/teams/platform");
      expect(view.textContent).toBe("View");
      expect(
        screen.getByRole("columnheader", { name: "Action" }),
      ).toBeDefined();
      // The name is text, not a second way in.
      expect(screen.getByText("Platform").closest("a")).toBeNull();
      expect(screen.getByText("Owns the runtime.")).toBeDefined();
      // The slug is the address, never shown as text.
      expect(screen.queryByText("platform")).toBeNull();
    });

    it("offers no creation without teams:manage, and says the list is theirs", async () => {
      // The API answers with the teams this caller may see, so an empty list
      // is about them, not about the organization.
      api(READ, { teams: [] });

      inOrganization(<TeamsView />);

      expect(await screen.findByText("You are not on a team")).toBeDefined();
      expect(
        screen.getByText(/The teams you are placed on appear here/),
      ).toBeDefined();
      expect(screen.getByText("The teams you are on.")).toBeDefined();
      expect(screen.queryByText("No teams yet")).toBeNull();
      expect(screen.queryByRole("button", { name: "New team" })).toBeNull();
    });

    it("tells whoever manages teams that the organization has none", async () => {
      api(MANAGE, { teams: [] });

      inOrganization(<TeamsView />);

      expect(await screen.findByText("No teams yet")).toBeDefined();
      expect(
        screen.getByText(/Teams group the members of this organization/),
      ).toBeDefined();
      expect(screen.queryByText("You are not on a team")).toBeNull();
    });

    it("offers New team from the header and the empty list, and closes on Cancel without creating", async () => {
      const user = userEvent.setup();
      const { requests } = api(MANAGE, { teams: [] });

      inOrganization(<TeamsView />);

      expect(await screen.findByText("No teams yet")).toBeDefined();
      expect(screen.queryByText("You are not on a team")).toBeNull();
      const buttons = screen.getAllByRole("button", { name: "New team" });

      expect(buttons).toHaveLength(2);
      expect(screen.queryByRole("dialog")).toBeNull();

      await user.click(buttons[0]);

      const dialog = screen.getByRole("dialog", { name: "New team" });

      await user.type(within(dialog).getByLabelText("Name"), "Payments");
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

      expect(screen.queryByRole("dialog", { name: "New team" })).toBeNull();
      expect(requests.some((r) => route(r) === `POST ${base}/teams`)).toBe(false);
    });

    it("creates a team from a name and description only, in a dialog that closes on the list", async () => {
      const user = userEvent.setup();
      const created = { ...platform, id: "new-id", name: "Payments", slug: "payments" };
      const { requests } = api(MANAGE, {
        handler: (request) =>
          route(request) === `POST ${base}/teams`
            ? jsonResponse(201, created)
            : undefined,
      });

      inOrganization(<TeamsView />);

      await user.click(
        (await screen.findAllByRole("button", { name: "New team" }))[0],
      );

      const dialog = screen.getByRole("dialog", { name: "New team" });

      expect(within(dialog).queryByLabelText(/slug/i)).toBeNull();

      await user.type(within(dialog).getByLabelText("Name"), "Payments");
      await user.type(within(dialog).getByLabelText(/Description/), "Card processing.");
      await user.click(within(dialog).getByRole("button", { name: "Create team" }));

      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: "New team" })).toBeNull(),
      );
      expect(navigation.push).not.toHaveBeenCalled();
      expect(
        requests.find((r) => route(r) === `POST ${base}/teams`)?.body,
      ).toEqual({ name: "Payments", description: "Card processing." });
    });

    it("shows a taken name on the name field", async () => {
      const user = userEvent.setup();
      api(MANAGE, {
        handler: (request) =>
          route(request) === `POST ${base}/teams`
            ? apiError(409, "TEAM_NAME_TAKEN")
            : undefined,
      });

      inOrganization(<TeamsView />);

      await user.click(
        (await screen.findAllByRole("button", { name: "New team" }))[0],
      );
      await user.type(await screen.findByLabelText("Name"), "platform!");
      await user.click(screen.getByRole("button", { name: "Create team" }));

      expect(
        await screen.findByText(
          "A team with this name, or a very similar one, already exists.",
        ),
      ).toBeDefined();
      expect(screen.getByLabelText("Name").getAttribute("aria-invalid")).toBe(
        "true",
      );
    });
  });

  describe("a team", () => {
    beforeEach(() => {
      navigation.params = { orgSlug: "acme-ops", teamId: platform.slug };
    });

    it("shows its name, description, a way back to Teams, and a glance at it", async () => {
      api(READ);

      inTeam(<TeamDetail />);

      expect(
        await screen.findByRole("heading", { level: 1, name: "Platform" }),
      ).toBeDefined();
      expect(screen.getByText("Owns the runtime.")).toBeDefined();
      expect(screen.queryByText("platform")).toBeNull();

      const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
      expect(
        within(breadcrumb).getByRole("link", { name: "Teams" }).getAttribute("href"),
      ).toBe("/orgs/acme-ops/teams");

      // Size and ownership from the team itself; no incident figures
      // without incidents:read.
      const glance = screen.getByLabelText("Platform at a glance");
      expect(within(glance).getByText("Members").nextSibling?.textContent).toBe("1");
      expect(
        within(glance).getByText("Services owned").nextSibling?.textContent,
      ).toBe("0");
      expect(within(glance).queryByText("Active incidents")).toBeNull();

      expect(await screen.findByText("Ada Lovelace")).toBeDefined();
      expect(
        screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
      ).toEqual(["Members1"]);
      expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
    });

    it("lists its members read only, each with their profile, and says where placement changes", async () => {
      const { requests } = api(MANAGE);

      inTeam(<TeamDetail />);

      const list = await screen.findByRole("list", { name: "Members of Platform" });

      expect(within(list).getByText("ada@example.com")).toBeDefined();
      expect(
        within(list)
          .getByRole("link", { name: "Ada Lovelace’s profile" })
          .getAttribute("href"),
      ).toBe(`/orgs/acme-ops/members/${ada.id}`);

      // One place to change placement: the member's own page.
      expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
      expect(screen.queryByRole("button", { name: /Add to team/ })).toBeNull();
      expect(screen.queryByLabelText("Organization member")).toBeNull();
      expect(screen.getByText(/To add or remove someone/)).toBeDefined();
      expect(
        screen.getByRole("link", { name: "Members" }).getAttribute("href"),
      ).toBe("/orgs/acme-ops/members");
      // Nor does it read the organization's member list to offer anyone.
      expect(
        requests.some((r) => route(r) === `GET ${base}/memberships`),
      ).toBe(false);
    });

    it("shows six members until asked, then all of them in the card", async () => {
      const user = userEvent.setup();
      const many = Array.from({ length: 8 }, (_, n) => ({
        membershipId: `0199a1b2-c3d4-7000-8000-0000000003${n}0`,
        addedAt: "2026-09-18T12:00:00.000Z",
        user: {
          id: `0199a1b2-c3d4-7000-8000-0000000004${n}0`,
          name: `Person ${n}`,
          email: `p${n}@example.com`,
        },
      }));
      api(READ, {
        handler: (request) =>
          route(request) === `GET ${base}/teams/${platform.id}/members`
            ? jsonResponse(200, many)
            : undefined,
      });

      inTeam(<TeamDetail />);

      const list = await screen.findByRole("list", { name: "Members of Platform" });
      const toggle = screen.getByRole("button", { name: "Show all 8" });

      expect(within(list).getAllByRole("listitem")).toHaveLength(6);
      expect(toggle.getAttribute("aria-expanded")).toBe("false");

      await user.click(toggle);

      expect(within(list).getAllByRole("listitem")).toHaveLength(8);
      // The card keeps its height: the list scrolls, and can be focused to.
      expect(list.getAttribute("tabindex")).toBe("0");
      expect(list.className).toContain("overflow-y-auto");
      expect(
        screen.getByRole("button", { name: "Show fewer" }).getAttribute("aria-expanded"),
      ).toBe("true");
    });

    it("shows the services it owns, and only those, with services:read", async () => {
      api(READ_WITH_SERVICES);

      inTeam(<TeamDetail />);

      const list = await screen.findByRole("list", {
        name: "Services owned by Platform",
      });
      const runtime = within(list).getByRole("link", { name: /Runtime API/ });

      expect(runtime.getAttribute("href")).toBe("/orgs/acme-ops/services/runtime-api");
      expect(within(runtime).getByText("High")).toBeDefined();
      expect(screen.queryByText("Checkout")).toBeNull();
      expect(
        screen.getByText("Incidents on these services come to Platform."),
      ).toBeDefined();
    });

    it("says plainly when it owns no services", async () => {
      api(READ_WITH_SERVICES, {
        handler: (request) =>
          route(request) === `GET ${base}/services`
            ? jsonResponse(200, [otherTeamsService])
            : undefined,
      });

      inTeam(<TeamDetail />);

      expect(
        await screen.findByText("This team owns no services"),
      ).toBeDefined();
    });

    it("lists the incidents it is responsible for, counts them at a glance, and links to Incidents filtered by it", async () => {
      const listed = (state: string) =>
        `GET ${base}/incidents?state=${state}&teamId=${platform.id}`;
      const incident = (number: number, status: string) => ({
        id: `0199a1b2-c3d4-7000-8000-0000000001${number}0`,
        number,
        title: `Login failures ${number}`,
        summary: null,
        severity: "SEV2",
        status,
        service: {
          id: "0199a1b2-c3d4-7000-8000-0000000000e1",
          name: "Authentication",
          slug: "authentication",
          criticality: "HIGH",
          archivedAt: null,
        },
        team: { id: platform.id, name: platform.name, slug: platform.slug },
        createdBy: { id: currentUser.id, name: "Ada Lovelace" },
        createdAt: "2026-09-18T12:00:00.000Z",
        updatedAt: "2026-09-18T12:00:00.000Z",
        resolvedAt: status === "RESOLVED" ? "2026-09-18T13:00:00.000Z" : null,
      });
      const page = (items: unknown[]) => ({
        items,
        page: { cursor: null, hasMore: false },
      });

      const { requests } = api([...READ, "incidents:read"], {
        handler: (request) =>
          route(request) === listed("active")
            ? jsonResponse(200, page([incident(4, "DECLARED")]))
            : route(request).startsWith(`GET ${base}/incidents?state=resolved`)
              ? jsonResponse(200, page([incident(3, "RESOLVED")]))
              : undefined,
      });

      inTeam(<TeamDetail />);

      expect(
        within(
          await screen.findByRole("table", { name: "Active incidents" }),
        ).getByText("Login failures 4"),
      ).toBeDefined();
      expect(
        within(
          await screen.findByRole("table", { name: "Recently resolved incidents" }),
        ).getByText("Login failures 3"),
      ).toBeDefined();
      expect(screen.getByText("Platform is responsible for these now")).toBeDefined();

      // The glance counts them: the active list, and a 30-day resolved one.
      const glance = screen.getByLabelText("Platform at a glance");
      await waitFor(() =>
        expect(
          within(glance).getByText("Active incidents").nextSibling?.textContent,
        ).toBe("11 × SEV2"),
      );
      expect(within(glance).getByText("last 30 days")).toBeDefined();
      expect(
        requests.some((r) =>
          /state=resolved&from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}&teamId=/.test(
            r.path,
          ),
        ),
      ).toBe(true);

      for (const link of screen.getAllByRole("link", { name: "View all in Incidents" })) {
        expect(link.getAttribute("href")).toBe(
          `/orgs/acme-ops/incidents?team=${platform.id}`,
        );
      }
      // Every row is this team's: no column repeating its name, and none
      // folded under the titles either.
      expect(
        screen.queryByRole("columnheader", { name: "Responsible team" }),
      ).toBeNull();
      expect(screen.queryByText(/· Platform/)).toBeNull();
      expect(
        screen.getAllByRole("columnheader", { name: "Service" }),
      ).toHaveLength(2);

      // Incidents and members on one row, resolved and services on the next.
      expect(
        screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
      ).toEqual(["Active incidents1", "Members1", "Recently resolved"]);
    });

    it("answers an unknown slug with a not-found page", async () => {
      navigation.params = { orgSlug: "acme-ops", teamId: "nope" };
      api(READ);

      inTeam(<TeamDetail />);

      expect(
        await screen.findByRole("heading", { name: "Team not found" }),
      ).toBeDefined();
      expect(navigation.replace).not.toHaveBeenCalled();
    });

    it("redirects an id address to the slug address, keeping what follows", async () => {
      // A notification carries only the team's id; old addresses used it too.
      navigation.params = { orgSlug: "acme-ops", teamId: platform.id };
      navigation.pathname = `/orgs/acme-ops/teams/${platform.id}/settings`;
      navigation.replace.mockReset();
      api(READ);

      inTeam(<TeamDetail />);

      await waitFor(() =>
        expect(navigation.replace).toHaveBeenCalledWith(
          "/orgs/acme-ops/teams/platform/settings",
        ),
      );
      // Not rendered at the id address meanwhile, and not "not found".
      expect(screen.queryByRole("heading", { name: "Team not found" })).toBeNull();
      expect(screen.queryByRole("heading", { name: "Platform" })).toBeNull();
      navigation.pathname = "/orgs/acme-ops/teams";
    });
  });

  describe("editing, from the list", () => {
    /** Opens Platform's Edit dialog from the Teams list. */
    const openEdit = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(
        await screen.findByRole("button", { name: "Edit Platform" }),
      );

      return screen.findByRole("dialog", { name: "Edit team" });
    };

    it("offers Edit beside View, in its own quiet tone, to whoever manages teams", async () => {
      api(MANAGE);

      inOrganization(<TeamsView />);

      const edit = await screen.findByRole("button", { name: "Edit Platform" });
      const view = screen.getByRole("link", { name: "View Platform" });

      expect(edit.textContent).toBe("Edit");
      expect(edit.closest("td")).toBe(view.closest("td"));
      expect(edit.className).toContain("bg-info-subtle");
      expect(view.className).toContain("bg-accent-subtle");
    });

    it("offers View alone without teams:manage", async () => {
      api(READ);

      inOrganization(<TeamsView />);

      await screen.findByRole("link", { name: "View Platform" });
      expect(screen.queryByRole("button", { name: /Edit/ })).toBeNull();
    });

    it("is not offered on the team's own page", async () => {
      navigation.params = { orgSlug: "acme-ops", teamId: platform.slug };
      api(MANAGE);

      inTeam(<TeamDetail />);

      await screen.findByRole("heading", { level: 1, name: "Platform" });
      expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
      expect(screen.queryByRole("button", { name: /Edit/ })).toBeNull();
    });

    it("saves the name and description, then closes on the renamed list", async () => {
      const user = userEvent.setup();
      const { requests } = api(MANAGE, {
        handler: (request) =>
          route(request) === `PATCH ${base}/teams/${platform.id}`
            ? jsonResponse(200, { ...platform, name: "Runtime" })
            : undefined,
      });

      inOrganization(<TeamsView />);

      const dialog = await openEdit(user);
      const name = within(dialog).getByLabelText("Name");

      await user.clear(name);
      await user.type(name, "Runtime");
      await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: "Edit team" })).toBeNull(),
      );
      expect(
        requests.find((r) => route(r) === `PATCH ${base}/teams/${platform.id}`)
          ?.body,
      ).toEqual({ name: "Runtime", description: "Owns the runtime." });
      expect(screen.getByRole("link", { name: "View Runtime" })).toBeDefined();
    });

    it("closes on Cancel without saving", async () => {
      const user = userEvent.setup();
      const { requests } = api(MANAGE);

      inOrganization(<TeamsView />);

      const dialog = await openEdit(user);

      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

      expect(screen.queryByRole("dialog", { name: "Edit team" })).toBeNull();
      expect(requests.some((r) => r.method === "PATCH")).toBe(false);
    });

    it("refreshes services after a rename, since each names its owner", async () => {
      const user = userEvent.setup();
      const { requests } = api([...MANAGE, "services:read"], {
        handler: (request) =>
          route(request) === `PATCH ${base}/teams/${platform.id}`
            ? jsonResponse(200, { ...platform, name: "Runtime" })
            : undefined,
      });
      navigation.params = { orgSlug: "acme-ops", teamId: platform.slug };

      // The team's own page, rendered alongside, keeps the services query
      // live — so an invalidation shows up as a refetch.
      inTeam(
        <>
          <TeamDetail />
          <TeamsView />
        </>,
      );

      await screen.findByRole("list", { name: "Services owned by Platform" });

      const dialog = await openEdit(user);
      const name = within(dialog).getByLabelText("Name");

      await user.clear(name);
      await user.type(name, "Runtime");
      await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

      await waitFor(() =>
        expect(
          requests.filter((r) => route(r) === `GET ${base}/services`).length,
        ).toBeGreaterThan(1),
      );
    });

    it("deletes only after confirmation, then closes on the refreshed list", async () => {
      const user = userEvent.setup();
      const { requests } = api(MANAGE, {
        handler: (request) =>
          route(request) === `DELETE ${base}/teams/${platform.id}`
            ? jsonResponse(204)
            : undefined,
      });

      inOrganization(<TeamsView />);

      const dialog = await openEdit(user);

      await user.click(
        within(dialog).getByRole("button", { name: "Delete team…" }),
      );

      expect(requests.some((r) => r.method === "DELETE")).toBe(false);
      expect(
        within(dialog).getByText(/Its 1 member will be taken off it/),
      ).toBeDefined();

      await user.click(within(dialog).getByRole("button", { name: "Delete team" }));

      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: "Edit team" })).toBeNull(),
      );
      expect(
        requests.some((r) => route(r) === `DELETE ${base}/teams/${platform.id}`),
      ).toBe(true);
      await waitFor(() =>
        expect(
          requests.filter((r) => route(r) === `GET ${base}/teams`).length,
        ).toBeGreaterThan(1),
      );
    });

    it("refuses to offer deletion while the team owns services, and says what to do", async () => {
      const user = userEvent.setup();
      api(MANAGE, { teams: [{ ...platform, serviceCount: 2 }] });

      inOrganization(<TeamsView />);

      const dialog = await openEdit(user);

      expect(within(dialog).getByText("This team owns services")).toBeDefined();
      expect(within(dialog).getByText(/It owns 2 services/)).toBeDefined();
      expect(
        within(dialog)
          .getByRole("link", { name: "See its services" })
          .getAttribute("href"),
      ).toBe("/orgs/acme-ops/teams/platform");
      expect(
        within(dialog).queryByRole("button", { name: /Delete team/ }),
      ).toBeNull();
    });

    it("explains a delete refused because services were assigned meanwhile", async () => {
      const user = userEvent.setup();
      const { requests } = api(MANAGE, {
        handler: (request) =>
          request.method === "DELETE"
            ? apiError(409, "TEAM_OWNS_SERVICES")
            : undefined,
      });

      inOrganization(<TeamsView />);

      const dialog = await openEdit(user);

      await user.click(
        within(dialog).getByRole("button", { name: "Delete team…" }),
      );
      await user.click(within(dialog).getByRole("button", { name: "Delete team" }));

      expect(
        await within(dialog).findByText(/This team now owns services/),
      ).toBeDefined();
      await waitFor(() =>
        expect(
          requests.filter((r) => route(r) === `GET ${base}/teams`).length,
        ).toBeGreaterThan(1),
      );
      expect(screen.getByRole("dialog", { name: "Edit team" })).toBeDefined();
    });

    it("explains that a team with incident history cannot be deleted", async () => {
      const user = userEvent.setup();
      api(MANAGE, {
        handler: (request) =>
          request.method === "DELETE"
            ? apiError(409, "TEAM_HAS_INCIDENTS")
            : undefined,
      });

      inOrganization(<TeamsView />);

      const dialog = await openEdit(user);

      await user.click(
        within(dialog).getByRole("button", { name: "Delete team…" }),
      );
      await user.click(within(dialog).getByRole("button", { name: "Delete team" }));

      expect(
        await within(dialog).findByText("This team has incident history"),
      ).toBeDefined();
      expect(
        within(dialog).queryByRole("button", { name: /Delete team/ }),
      ).toBeNull();
    });

    it("stays open and says so when a delete fails", async () => {
      const user = userEvent.setup();
      api(MANAGE, {
        handler: (request) =>
          request.method === "DELETE" ? apiError(500) : undefined,
      });

      inOrganization(<TeamsView />);

      const dialog = await openEdit(user);

      await user.click(
        within(dialog).getByRole("button", { name: "Delete team…" }),
      );
      await user.click(within(dialog).getByRole("button", { name: "Delete team" }));

      expect(await within(dialog).findByText("Failed with 500")).toBeDefined();
      expect(screen.getByRole("dialog", { name: "Edit team" })).toBeDefined();
    });
  });
});
