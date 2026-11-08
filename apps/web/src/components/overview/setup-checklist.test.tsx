import { screen, waitFor, within } from "@testing-library/react";
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
import { expectNoAxeViolations } from "@/test/axe";
import { renderWithSession } from "@/test/render";

import { SetupChecklist, setupSteps } from "./setup-checklist";

vi.mock("next/navigation", () => ({
  useParams: () => ({ orgSlug: "acme-ops" }),
  usePathname: () => "/orgs/acme-ops",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const base = `/organizations/${organization.id}`;

const ADMIN = [
  "memberships:read",
  "organization:read",
  "teams:read",
  "teams:manage",
  "services:read",
  "incidents:read",
];
const MEMBER = ["memberships:read", "organization:read", "teams:read", "incidents:read"];

const team = (memberCount: number, serviceCount: number, n = 1) => ({
  id: `0199a1b2-c3d4-7000-8000-0000000000d${n}`,
  name: `Team ${n}`,
  slug: `team-${n}`,
  description: null,
  memberCount,
  serviceCount,
  createdAt: "2026-09-18T12:00:00.000Z",
  updatedAt: "2026-09-18T12:00:00.000Z",
});

const member = (n: number) => ({
  id: `0199a1b2-c3d4-7000-8000-0000000000a${n}`,
  role: n === 0 ? "ADMIN" : "MEMBER",
  createdAt: "2026-09-01T12:00:00.000Z",
  user: {
    id: `0199a1b2-c3d4-7000-8000-00000000010${n}`,
    name: `Person ${n}`,
    email: `p${n}@example.com`,
    passwordChangeRequired: false,
  },
});

const page = (items: unknown[]) => ({
  items,
  page: { cursor: null, hasMore: false },
});

const api = ({
  permissions = ADMIN,
  teams = [] as ReturnType<typeof team>[] | (() => Response),
  members = 1,
  active = [] as unknown[],
  resolved = [] as unknown[],
} = {}) =>
  mockApi((request) => {
    switch (route(request)) {
      case "POST /auth/refresh":
        return refreshed("token");
      case "GET /auth/me":
        return jsonResponse(200, currentUser);
      case `GET ${base}`:
        return jsonResponse(200, organizationDetail(permissions));
      case `GET ${base}/teams`:
        return typeof teams === "function" ? teams() : jsonResponse(200, teams);
      case `GET ${base}/memberships`:
        return jsonResponse(
          200,
          Array.from({ length: members }, (_, n) => member(n)),
        );
      case `GET ${base}/incidents?state=active`:
        return jsonResponse(200, page(active));
      case `GET ${base}/incidents?state=resolved`:
        return jsonResponse(200, page(resolved));
      default:
        return apiError(404);
    }
  });

const renderChecklist = () =>
  renderWithSession(
    <OrganizationScope>
      <p>Overview content</p>
      <SetupChecklist />
    </OrganizationScope>,
  );

const steps = async () =>
  within(await screen.findByRole("list", { name: "Setup steps" })).getAllByRole(
    "listitem",
  );

describe("the setup checklist", () => {
  beforeEach(() => {
    clearAccessToken();
  });

  it("starts an empty organization on creating a team, and says why the rest wait", async () => {
    api();
    const { container } = renderChecklist();

    const region = await screen.findByRole("region", {
      name: `Set up ${organization.name}`,
    });
    const [first, members, service, incident] = await steps();

    expect(within(region).getByText("0 of 4 done")).toBeDefined();
    expect(first.getAttribute("aria-current")).toBe("step");
    expect(
      within(first)
        .getByRole("link", { name: "Create a team" })
        .getAttribute("href"),
    ).toBe("/orgs/acme-ops/teams");

    // Each later step names what it is waiting on, and offers no way in yet.
    expect(within(members).getByText("Needs a team first")).toBeDefined();
    expect(within(service).getByText("Needs a team first")).toBeDefined();
    expect(within(incident).getByText("Needs a service first")).toBeDefined();
    for (const step of [members, service, incident]) {
      expect(within(step).queryByRole("link")).toBeNull();
    }

    await expectNoAxeViolations(container);
  });

  it("ticks what is done and moves on to the next step", async () => {
    api({ teams: [team(0, 0)], members: 3 });
    renderChecklist();

    const [first, members, service] = await steps();

    expect(screen.getByText("1 of 4 done")).toBeDefined();
    expect(within(first).getByText("(done)")).toBeDefined();
    expect(within(first).queryByRole("link")).toBeNull();

    // Members were added, but nobody is on a team: not done, and it says so.
    expect(members.getAttribute("aria-current")).toBe("step");
    expect(
      within(members).getByText("2 members added, none on a team yet."),
    ).toBeDefined();
    expect(
      within(members)
        .getByRole("link", { name: "Add members" })
        .getAttribute("href"),
    ).toBe("/orgs/acme-ops/members");

    // A step that can be taken but is not next is still offered.
    expect(
      within(service)
        .getByRole("link", { name: "Register a service" })
        .getAttribute("href"),
    ).toBe("/orgs/acme-ops/services");
  });

  it("counts an incident, active or resolved, toward the last step", async () => {
    api({
      teams: [team(1, 0, 1), team(2, 1, 2)],
      members: 2,
      active: [],
      resolved: [{ id: "x" }],
    });
    renderChecklist();

    // Everything done: the guide is gone.
    await screen.findByText("Overview content");
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: /Set up/ }),
      ).toBeNull(),
    );
  });

  it("leaves the last step to do while no incident exists", async () => {
    api({ teams: [team(1, 2)], members: 2 });
    renderChecklist();

    const incident = (await steps())[3];

    expect(screen.getByText("3 of 4 done")).toBeDefined();
    expect(incident.getAttribute("aria-current")).toBe("step");
    expect(
      within(incident)
        .getByRole("link", { name: "Declare an incident" })
        .getAttribute("href"),
    ).toBe("/orgs/acme-ops/incidents");
  });

  it("is not offered, and asks for nothing, without teams:manage", async () => {
    const { requests } = api({ permissions: MEMBER });
    renderChecklist();

    await screen.findByText("Overview content");

    expect(screen.queryByRole("region", { name: /Set up/ })).toBeNull();
    expect(requests.some((r) => r.path.startsWith(`${base}/teams`))).toBe(false);
  });

  it("shows nothing when what it reads cannot be read", async () => {
    const { requests } = api({ teams: () => apiError(500) });
    renderChecklist();

    await waitFor(() =>
      expect(requests.some((r) => r.path === `${base}/teams`)).toBe(true),
    );
    await screen.findByText("Overview content");

    expect(screen.queryByRole("region", { name: /Set up/ })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("setupSteps", () => {
  it("does not count the reader's own placement as members added", () => {
    const [, members] = setupSteps(
      { teams: 1, others: 0, staffedTeams: 1, services: 0, hasIncident: false },
      "acme-ops",
    );

    expect(members.done).toBe(false);
    expect(members.detail).toBe(
      "Add the people who respond, then place them on teams.",
    );
  });
});
