import { screen, waitFor, within } from "@testing-library/react";
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
import type { SentRequest } from "@/test/api";
import { renderWithSession } from "@/test/render";

import { MemberDetail } from "./member-detail";
import { MembersView } from "./members-view";
import { OrganizationScope } from "./organization-scope";

const GRACE = "0199a1b2-c3d4-7000-8000-0000000000bb";

const navigation = vi.hoisted(() => ({ membershipId: "" }));

vi.mock("next/navigation", () => ({
  useParams: () => ({
    orgSlug: "acme-ops",
    membershipId: navigation.membershipId,
  }),
  usePathname: () => "/orgs/acme-ops/members",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const ADMIN = [
  "members:manage",
  "memberships:read",
  "organization:read",
  "teams:manage",
  "teams:read",
];
const MEMBER = ["memberships:read", "organization:read", "teams:read"];

const base = `/organizations/${organization.id}`;

const team = (id: string, name: string) => ({
  id,
  name,
  slug: name.toLowerCase(),
  description: null,
  memberCount: 0,
  serviceCount: 0,
  createdAt: "2026-09-18T12:00:00.000Z",
  updatedAt: "2026-09-18T12:00:00.000Z",
});

const PAYMENTS = team("0199a1b2-c3d4-7000-8000-0000000000d1", "Payments");
const PLATFORM = team("0199a1b2-c3d4-7000-8000-0000000000d2", "Platform");
const RISK = team("0199a1b2-c3d4-7000-8000-0000000000d3", "Risk");
const ref = ({ id, name, slug }: typeof PAYMENTS) => ({ id, name, slug });

const grace = (teams: (typeof PAYMENTS)[], passwordChangeRequired = false) => ({
  id: GRACE,
  role: "MEMBER",
  createdAt: "2026-09-19T12:00:00.000Z",
  user: {
    id: "0199a1b2-c3d4-7000-8000-000000000002",
    name: "Grace Hopper",
    email: "grace@example.com",
    passwordChangeRequired,
  },
  teams: teams.map(ref),
});

type Handler = (request: SentRequest) => Response | undefined;

/**
 * The API, with Grace's teams held as state: placing and removing change
 * what the next read of her record returns, as the real API would.
 */
const api = (
  permissions: string[],
  initial: (typeof PAYMENTS)[],
  handler: Handler = () => undefined,
) => {
  let teams = [...initial];

  return mockApi((request) => {
    const handled = handler(request);

    if (handled) return handled;

    const path = route(request);

    if (path.startsWith(`POST ${base}/teams/`) && path.endsWith("/members")) {
      const teamId = path.split("/teams/")[1].split("/")[0];
      const placed = [PAYMENTS, PLATFORM, RISK].find(({ id }) => id === teamId);
      if (placed) teams = [...teams, placed].sort((a, b) => a.name.localeCompare(b.name));
      return jsonResponse(201, {
        membershipId: GRACE,
        addedAt: "2026-09-19T12:00:00.000Z",
        user: grace([]).user,
      });
    }

    if (path.startsWith(`DELETE ${base}/teams/`)) {
      const teamId = path.split("/teams/")[1].split("/")[0];
      teams = teams.filter(({ id }) => id !== teamId);
      return jsonResponse(204);
    }

    switch (path) {
      case "POST /auth/refresh":
        return refreshed("token");
      case "GET /auth/me":
        return jsonResponse(200, currentUser);
      case `GET ${base}`:
        return jsonResponse(200, organizationDetail(permissions));
      case `GET ${base}/memberships/${GRACE}`:
        return jsonResponse(200, grace(teams));
      case `GET ${base}/memberships`:
        return jsonResponse(200, [grace(teams)]);
      case `GET ${base}/teams`:
        return jsonResponse(200, [PAYMENTS, PLATFORM, RISK]);
      default:
        return apiError(404);
    }
  });
};

const renderMember = () =>
  renderWithSession(
    <OrganizationScope>
      <MemberDetail />
    </OrganizationScope>,
  );

describe("a member's page", () => {
  beforeEach(() => {
    clearAccessToken();
    navigation.membershipId = GRACE;
  });

  it("is reached from the member's name in the Members table", async () => {
    api(ADMIN, []);

    renderWithSession(
      <OrganizationScope>
        <MembersView />
      </OrganizationScope>,
    );

    expect(
      (await screen.findByRole("link", { name: "Grace Hopper" })).getAttribute(
        "href",
      ),
    ).toBe(`/orgs/acme-ops/members/${GRACE}`);
  });

  it("shows who they are, their role and status, with a way back", async () => {
    api(ADMIN, [], (request) =>
      route(request) === `GET ${base}/memberships/${GRACE}`
        ? jsonResponse(200, grace([], true))
        : undefined,
    );

    renderMember();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Grace Hopper" }),
    ).toBeDefined();
    expect(screen.getByText("grace@example.com")).toBeDefined();
    expect(screen.getByText("Member")).toBeDefined();
    expect(screen.getByText("Awaiting first sign-in")).toBeDefined();
    expect(
      screen.getByRole("link", { name: "← Members" }).getAttribute("href"),
    ).toBe("/orgs/acme-ops/members");
  });

  it("lists their teams, each linking to the team", async () => {
    api(ADMIN, [PAYMENTS, PLATFORM]);

    renderMember();

    const teams = await screen.findByRole("region", { name: /Teams/ });
    const links = await within(teams).findAllByRole("link");

    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Payments", "/orgs/acme-ops/teams/payments"],
      ["Platform", "/orgs/acme-ops/teams/platform"],
    ]);
  });

  it("says when they are on no team", async () => {
    api(ADMIN, []);

    renderMember();

    expect(await screen.findByText("Not on any team yet.")).toBeDefined();
  });

  it("lets the Admin place them on a team they are not on, and shows it at once", async () => {
    const { requests } = api(ADMIN, [PAYMENTS]);
    const user = userEvent.setup();

    renderMember();

    const select = (await screen.findByLabelText("Add to team")) as HTMLSelectElement;

    // Only teams they are not on are offered: no duplicate placement.
    expect([...select.options].map((option) => option.text)).toEqual([
      "Platform",
      "Risk",
    ]);

    await user.selectOptions(select, "Risk");
    await user.click(screen.getByRole("button", { name: "Add to team" }));

    const teams = screen.getByRole("region", { name: /Teams/ });
    expect(await within(teams).findByRole("link", { name: "Risk" })).toBeDefined();
    expect(
      requests.find((r) => route(r) === `POST ${base}/teams/${RISK.id}/members`)
        ?.body,
    ).toEqual({ membershipId: GRACE });
  });

  it("lets the Admin take them off a team, and shows it at once", async () => {
    const { requests } = api(ADMIN, [PAYMENTS, PLATFORM]);
    const user = userEvent.setup();

    renderMember();

    await user.click(
      await screen.findByRole("button", {
        name: "Remove Grace Hopper from Payments",
      }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("link", { name: "Payments" })).toBeNull(),
    );
    expect(screen.getByRole("link", { name: "Platform" })).toBeDefined();
    expect(
      requests.some(
        (r) => route(r) === `DELETE ${base}/teams/${PAYMENTS.id}/members/${GRACE}`,
      ),
    ).toBe(true);
  });

  it("says when they are already on every team", async () => {
    api(ADMIN, [PAYMENTS, PLATFORM, RISK]);

    renderMember();

    expect(await screen.findByText("They are on every team.")).toBeDefined();
    expect(screen.queryByLabelText("Add to team")).toBeNull();
  });

  it("explains a placement someone else made first", async () => {
    api(ADMIN, [], (request) =>
      route(request) === `POST ${base}/teams/${PAYMENTS.id}/members`
        ? apiError(409, "ALREADY_A_TEAM_MEMBER")
        : undefined,
    );
    const user = userEvent.setup();

    renderMember();

    await user.selectOptions(await screen.findByLabelText("Add to team"), "Payments");
    await user.click(screen.getByRole("button", { name: "Add to team" }));

    expect(
      await screen.findByText(
        "They are already on that team. The list has been refreshed.",
      ),
    ).toBeDefined();
  });

  it("offers a Member no team controls", async () => {
    api(MEMBER, [PAYMENTS]);

    renderMember();

    expect(await screen.findByRole("link", { name: "Payments" })).toBeDefined();
    expect(screen.queryByRole("button", { name: /Remove/ })).toBeNull();
    expect(screen.queryByLabelText("Add to team")).toBeNull();
  });

  it("answers a member that is not in this organization with a not-found page", async () => {
    navigation.membershipId = "0199a1b2-c3d4-7000-8000-0000000000ff";
    api(ADMIN, []);

    renderMember();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Member not found" }),
    ).toBeDefined();
    expect(
      screen.getByRole("link", { name: "All members" }).getAttribute("href"),
    ).toBe("/orgs/acme-ops/members");
  });
});
