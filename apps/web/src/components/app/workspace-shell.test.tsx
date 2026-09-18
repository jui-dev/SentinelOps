import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
});
