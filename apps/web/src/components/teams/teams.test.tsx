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
import { TeamSettings } from "./team-settings";
import { TeamsView } from "./teams-view";

const navigation = vi.hoisted(() => ({
  params: { orgSlug: "acme-ops" } as { orgSlug: string; teamSlug?: string },
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => navigation.params,
  usePathname: () => "/orgs/acme-ops/teams",
  useRouter: () => ({ replace: vi.fn(), push: navigation.push }),
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
  createdAt: "2026-09-18T12:00:00.000Z",
  updatedAt: "2026-09-18T12:00:00.000Z",
};

const ada = {
  id: currentUser.memberships[0].id,
  role: "OWNER",
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
    it("lists teams with their member counts and links, without slugs", async () => {
      api(READ);

      inOrganization(<TeamsView />);

      const link = await screen.findByRole("link", { name: "Platform" });

      expect(link.getAttribute("href")).toBe("/orgs/acme-ops/teams/platform");
      expect(screen.getByText("Owns the runtime.")).toBeDefined();
      expect(screen.queryByText("platform")).toBeNull();
    });

    it("offers no creation without teams:manage", async () => {
      api(READ, { teams: [] });

      inOrganization(<TeamsView />);

      expect(await screen.findByText("No teams yet")).toBeDefined();
      expect(screen.getByText(/An owner or admin can create one/)).toBeDefined();
      expect(screen.queryByRole("button", { name: "New team" })).toBeNull();
    });

    it("creates a team from a name and description only, then opens it", async () => {
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

      const form = screen.getByRole("region", { name: "New team" });

      expect(within(form).queryByLabelText(/slug/i)).toBeNull();

      await user.type(within(form).getByLabelText("Name"), "Payments");
      await user.type(
        within(form).getByLabelText(/Description/),
        "Card processing.",
      );
      await user.click(within(form).getByRole("button", { name: "Create team" }));

      await waitFor(() =>
        expect(navigation.push).toHaveBeenCalledWith(
          "/orgs/acme-ops/teams/payments",
        ),
      );
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
      await user.type(screen.getByLabelText("Name"), "platform!");
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
      navigation.params = { orgSlug: "acme-ops", teamSlug: "platform" };
    });

    it("shows its name, description, and members — no slug, no other sections", async () => {
      api(READ);

      inTeam(<TeamDetail />);

      expect(
        await screen.findByRole("heading", { level: 1, name: "Platform" }),
      ).toBeDefined();
      expect(screen.getByText("Owns the runtime.")).toBeDefined();
      expect(await screen.findByText("Ada Lovelace")).toBeDefined();
      expect(screen.queryByText("platform")).toBeNull();
      expect(
        screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent),
      ).toEqual(["Members"]);
      expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
      expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
    });

    it("offers only organization members not already on the team, and adds one", async () => {
      const user = userEvent.setup();
      const { requests } = api(MANAGE, {
        handler: (request) =>
          route(request) === `POST ${base}/teams/${platform.id}/members`
            ? jsonResponse(201, {
                membershipId: grace.id,
                addedAt: "2026-09-18T13:00:00.000Z",
                user: grace.user,
              })
            : undefined,
      });

      inTeam(<TeamDetail />);

      const select = await screen.findByLabelText("Organization member");
      const options = within(select).getAllByRole("option");

      expect(options.map((o) => o.textContent)).toEqual([
        "Grace Hopper (grace@example.com)",
      ]);

      await user.click(screen.getByRole("button", { name: "Add to team" }));

      await waitFor(() =>
        expect(
          requests.find(
            (r) => route(r) === `POST ${base}/teams/${platform.id}/members`,
          )?.body,
        ).toEqual({ membershipId: grace.id }),
      );
    });

    it("removes a member by their membership id", async () => {
      const user = userEvent.setup();
      const { requests } = api(MANAGE, {
        handler: (request) =>
          route(request) ===
          `DELETE ${base}/teams/${platform.id}/members/${ada.id}`
            ? jsonResponse(204)
            : undefined,
      });

      inTeam(<TeamDetail />);

      await user.click(
        await screen.findByRole("button", {
          name: "Remove Ada Lovelace from Platform",
        }),
      );

      await waitFor(() =>
        expect(
          requests.some(
            (r) =>
              route(r) ===
              `DELETE ${base}/teams/${platform.id}/members/${ada.id}`,
          ),
        ).toBe(true),
      );
    });

    it("explains a removal that was already out of date, and refreshes", async () => {
      const user = userEvent.setup();
      const { requests } = api(MANAGE, {
        handler: (request) =>
          request.method === "DELETE"
            ? apiError(404, "TEAM_MEMBER_NOT_FOUND")
            : undefined,
      });

      inTeam(<TeamDetail />);

      await user.click(
        await screen.findByRole("button", {
          name: "Remove Ada Lovelace from Platform",
        }),
      );

      expect(
        await screen.findByText(/was no longer on this team/),
      ).toBeDefined();
      await waitFor(() =>
        expect(
          requests.filter(
            (r) => route(r) === `GET ${base}/teams/${platform.id}/members`,
          ).length,
        ).toBeGreaterThan(1),
      );
    });

    it("answers an unknown slug with a not-found page", async () => {
      navigation.params = { orgSlug: "acme-ops", teamSlug: "nope" };
      api(READ);

      inTeam(<TeamDetail />);

      expect(
        await screen.findByRole("heading", { name: "Team not found" }),
      ).toBeDefined();
    });
  });

  describe("settings", () => {
    beforeEach(() => {
      navigation.params = { orgSlug: "acme-ops", teamSlug: "platform" };
    });

    it("saves the name and description", async () => {
      const user = userEvent.setup();
      const { requests } = api(MANAGE, {
        handler: (request) =>
          route(request) === `PATCH ${base}/teams/${platform.id}`
            ? jsonResponse(200, { ...platform, name: "Runtime" })
            : undefined,
      });

      inTeam(<TeamSettings />);

      const name = await screen.findByLabelText("Name");

      await user.clear(name);
      await user.type(name, "Runtime");
      await user.click(screen.getByRole("button", { name: "Save" }));

      expect(await screen.findByText("Team updated.")).toBeDefined();
      expect(
        requests.find((r) => route(r) === `PATCH ${base}/teams/${platform.id}`)
          ?.body,
      ).toEqual({ name: "Runtime", description: "Owns the runtime." });
    });

    it("deletes only after confirmation, then returns to the list", async () => {
      const user = userEvent.setup();
      const { requests } = api(MANAGE, {
        handler: (request) =>
          route(request) === `DELETE ${base}/teams/${platform.id}`
            ? jsonResponse(204)
            : undefined,
      });

      inTeam(<TeamSettings />);

      await user.click(
        await screen.findByRole("button", { name: "Delete team…" }),
      );

      expect(requests.some((r) => r.method === "DELETE")).toBe(false);
      expect(screen.getByText(/Its 1 member will be taken off it/)).toBeDefined();

      await user.click(screen.getByRole("button", { name: "Delete team" }));

      await waitFor(() =>
        expect(navigation.push).toHaveBeenCalledWith("/orgs/acme-ops/teams"),
      );
      expect(
        requests.some((r) => route(r) === `DELETE ${base}/teams/${platform.id}`),
      ).toBe(true);
    });

    it("stays put and says so when a delete fails", async () => {
      const user = userEvent.setup();
      api(MANAGE, {
        handler: (request) =>
          request.method === "DELETE" ? apiError(500) : undefined,
      });

      inTeam(<TeamSettings />);

      await user.click(
        await screen.findByRole("button", { name: "Delete team…" }),
      );
      await user.click(screen.getByRole("button", { name: "Delete team" }));

      expect(await screen.findByText("Failed with 500")).toBeDefined();
      expect(navigation.push).not.toHaveBeenCalled();
    });

    it("offers nothing to change without teams:manage", async () => {
      api(READ);

      inTeam(<TeamSettings />);

      expect(
        await screen.findByText(/do not have permission to change this team/),
      ).toBeDefined();
      expect(screen.queryByLabelText("Name")).toBeNull();
    });
  });
});
