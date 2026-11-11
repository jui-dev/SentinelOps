import { screen, within } from "@testing-library/react";
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
import { renderWithSession } from "@/test/render";

import { RolePage } from "./role-page";
import { RolesView } from "./roles-view";

const navigation = vi.hoisted(() => ({
  params: { orgSlug: "acme-ops" } as Record<string, string>,
}));

vi.mock("next/navigation", () => ({
  useParams: () => navigation.params,
  usePathname: () => "/orgs/acme-ops/roles",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const base = `/organizations/${organization.id}`;
const MY_ID = "0199a1b2-c3d4-7000-8000-0000000000aa";
const READ = ["organization:read", "memberships:read", "teams:read"];

const person = (
  id: string,
  name: string,
  role: string,
  teams: string[] = [],
) => ({
  id,
  role,
  createdAt: "2026-09-01T12:00:00.000Z",
  user: {
    id: `${id}-user`,
    name,
    email: `${name.split(" ")[0].toLowerCase()}@example.com`,
  },
  teams: teams.map((team, index) => ({
    id: `0199a1b2-c3d4-7000-8000-0000000000e${index}`,
    name: team,
    slug: team.toLowerCase(),
  })),
});

/** A Responder on Payments, who sees their teammate and whoever decides. */
const MEMBERS = [
  person("0199a1b2-c3d4-7000-8000-0000000000d1", "Dev Admin", "ADMIN"),
  person("0199a1b2-c3d4-7000-8000-0000000000d2", "Ava Kim", "INCIDENT_MANAGER"),
  person(MY_ID, "Priya Shah", "RESPONDER", ["Payments"]),
  person("0199a1b2-c3d4-7000-8000-0000000000d3", "Sam Okafor", "RESPONDER", [
    "Payments",
  ]),
];

const ROLES = [
  { role: "ADMIN", permissions: [], memberCount: 1 },
  { role: "INCIDENT_MANAGER", permissions: [], memberCount: 1 },
  { role: "REPORTER", permissions: [], memberCount: 1 },
  { role: "RESPONDER", permissions: [], memberCount: 4 },
];

const api = (role = "RESPONDER") =>
  mockApi((request) => {
    switch (route(request)) {
      case "POST /auth/refresh":
        return refreshed("token");
      case "GET /auth/me":
        return jsonResponse(200, currentUser);
      case `GET ${base}`:
        return jsonResponse(200, organizationDetail(READ, role));
      case `GET ${base}/roles`:
        return jsonResponse(200, ROLES);
      case `GET ${base}/memberships`:
        return jsonResponse(200, MEMBERS);
      default:
        return apiError(404);
    }
  });

const render = (ui: React.ReactNode) =>
  renderWithSession(<OrganizationScope>{ui}</OrganizationScope>);

describe("the Roles page", () => {
  beforeEach(() => {
    clearAccessToken();
    navigation.params = { orgSlug: "acme-ops" };
  });

  it("shows a card per role in the order an incident needs them, with how many hold each", async () => {
    api();
    render(<RolesView />);

    const cards = await screen.findAllByRole("article");

    expect(cards.map((card) => within(card).getByRole("heading").textContent)).toEqual(
      ["Reporter", "Incident Manager", "Responder", "Admin"],
    );
    expect(within(cards[2]).getByText("4 people")).toBeDefined();
    expect(within(cards[0]).getByText("1 person")).toBeDefined();
    // Reporters the reader cannot see are counted, not named.
    expect(within(cards[0]).queryByTitle(/./)).toBeNull();
    expect(within(cards[2]).getByTitle("Sam Okafor")).toBeDefined();
    expect(
      within(cards[1])
        .getByRole("link", { name: "View the Incident Manager role" })
        .getAttribute("href"),
    ).toBe("/orgs/acme-ops/roles/incident-manager");
  });

  it("marks the reader's own role and says what it and their teams mean", async () => {
    api();
    render(<RolesView />);

    const [, , responder] = await screen.findAllByRole("article");

    expect(within(responder).getByText("You")).toBeDefined();
    expect(
      screen.getByRole("link", { name: /See your role/ }).getAttribute("href"),
    ).toBe("/orgs/acme-ops/roles/responder");
    expect(await screen.findByText(/You're on/)).toBeDefined();
    expect(screen.getByText(/To change yours, ask Dev Admin \(Admin\)/)).toBeDefined();
  });

  it("maps what each role does at each step, with ticked jobs where it leads or helps", async () => {
    api();
    render(<RolesView />);

    const map = await screen.findByRole("table", {
      name: "What each role does at each step",
    });
    const rows = within(map).getAllByRole("row").slice(1);
    const reporter = within(rows[0]).getAllByRole("cell");

    expect(within(rows[0]).getByRole("rowheader").textContent).toContain(
      "Reporter",
    );
    // Report: leads, with its jobs. Decide: not theirs.
    expect(reporter[0].textContent).toContain("Leads");
    expect(reporter[0].textContent).toContain("Declares an incident");
    expect(within(reporter[1]).getByLabelText("Not their job")).toBeDefined();
    expect(reporter[2].textContent).toContain("Can help");
  });

  it("tells an Admin roles are changed from Members", async () => {
    api("ADMIN");
    render(<RolesView />);

    expect(
      await screen.findByText(/Change someone's role from Members/),
    ).toBeDefined();
  });
});

describe("a role's page", () => {
  beforeEach(() => {
    clearAccessToken();
  });

  it("shows the role, who holds it, when it acts, and whose job the rest is", async () => {
    navigation.params = { orgSlug: "acme-ops", role: "incident-manager" };
    api();
    render(<RolePage />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Incident Manager" }),
    ).toBeDefined();
    expect(await screen.findByText("Ava Kim")).toBeDefined();
    expect(screen.getByText("Confirms severity")).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Start a response: the Responder" }),
    ).toBeDefined();
    expect(
      within(screen.getByRole("navigation", { name: "Roles" }))
        .getByRole("link", { name: "Incident Manager" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });

  it("counts holders the reader may not see by name", async () => {
    navigation.params = { orgSlug: "acme-ops", role: "reporter" };
    api();
    render(<RolePage />);

    expect(await screen.findByText("1 person")).toBeDefined();
  });

  it("says there is no such role for an address that names none", async () => {
    navigation.params = { orgSlug: "acme-ops", role: "owner" };
    api();
    render(<RolePage />);

    expect(await screen.findByText("There is no such role")).toBeDefined();
    expect(screen.getByRole("link", { name: "See them all" })).toBeDefined();
  });
});
