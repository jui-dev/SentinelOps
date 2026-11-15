import { fireEvent, screen, waitFor, within } from "@testing-library/react";
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

import { generateOneTimePassword } from "./add-member-form";
import { MembersView } from "./members-view";
import { OrganizationScope } from "./organization-scope";

vi.mock("next/navigation", () => ({
  useParams: () => ({ orgSlug: "acme-ops" }),
  usePathname: () => "/orgs/acme-ops/members",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const MANAGE = [
  "members:manage",
  "memberships:read",
  "memberships:read-all",
  "organization:read",
];
/** Reads the whole directory without managing it. */
const READ_ONLY = ["memberships:read", "memberships:read-all", "organization:read"];
/** A member: reads members only as teammates, so not this page. */
const MEMBER = ["memberships:read", "organization:read"];

const base = `/organizations/${organization.id}`;

const ada = {
  id: "0199a1b2-c3d4-7000-8000-0000000000aa",
  role: "ADMIN",
  createdAt: "2026-09-01T12:00:00.000Z",
  user: {
    id: currentUser.id,
    name: "Ada Lovelace",
    email: "ada@example.com",
    passwordChangeRequired: false,
  },  teams: [],
};

const grace = {
  id: "0199a1b2-c3d4-7000-8000-0000000000bb",
  role: "RESPONDER",
  createdAt: "2026-09-19T12:00:00.000Z",
  user: {
    id: "0199a1b2-c3d4-7000-8000-000000000002",
    name: "Grace Hopper",
    email: "grace@example.com",
    passwordChangeRequired: true,
  },  teams: [],
};

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
const INFRASTRUCTURE = team(
  "0199a1b2-c3d4-7000-8000-0000000000d3",
  "Infrastructure",
);

type Handler = (request: SentRequest) => Response | undefined;

const api = (
  permissions: string[],
  members: unknown[] = [ada],
  handler: Handler = () => undefined,
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
      case `GET ${base}/memberships`:
        return jsonResponse(200, members);
      case `GET ${base}/teams`:
        return jsonResponse(200, [INFRASTRUCTURE, PAYMENTS, PLATFORM]);
      default:
        return apiError(404);
    }
  });

const renderMembers = () =>
  renderWithSession(
    <OrganizationScope>
      <MembersView />
    </OrganizationScope>,
  );

/** Opens a person's Manage dialog and finds one of its choices. */
const manageChoice = async (
  user: ReturnType<typeof userEvent.setup>,
  name: string,
  choice: RegExp,
) => {
  await user.click(
    await screen.findByRole("button", { name: `Manage ${name}` }),
  );

  return within(
    screen.getByRole("dialog", { name: `Manage ${name}` }),
  ).getByRole("button", { name: choice }) as HTMLButtonElement;
};

/** The Members page with the Add member dialog opened from its header. */
const renderAddMember = async () => {
  renderMembers();
  await userEvent
    .setup()
    .click(await screen.findByRole("button", { name: "Add member" }));

  return screen.getByRole("dialog", { name: "Add member" });
};

const submit = (dialog: HTMLElement) =>
  within(dialog).getByRole("button", { name: "Add member" });

/** Chooses the new person's role, as every addition must. */
const chooseRole = (
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
  role: string,
) =>
  user.click(
    within(dialog).getByRole("radio", { name: new RegExp(`^${role}`) }),
  );

describe("the members overview", () => {
  beforeEach(() => {
    clearAccessToken();
  });

  const onTeams = (...names: string[]) =>
    names.map((name, index) => ({
      id: `0199a1b2-c3d4-7000-8000-0000000000e${index}`,
      name,
      slug: name.toLowerCase(),
    }));

  it("offers the Admin an Add member action that opens a dialog, and no form until then", async () => {
    api(MANAGE);

    renderMembers();

    await screen.findByRole("button", { name: "Add member" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByLabelText("One-time password")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Invitations" })).toBeNull();
  });

  it("offers a Member no way to add anyone", async () => {
    api(READ_ONLY);

    renderMembers();

    expect(await screen.findByText("Ada Lovelace")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Add member" })).toBeNull();
  });

  const linus = {
    ...grace,
    id: "0199a1b2-c3d4-7000-8000-0000000000cc",
    user: {
      ...grace.user,
      id: "0199a1b2-c3d4-7000-8000-000000000003",
      name: "Linus Torvalds",
      email: "linus@example.com",
      passwordChangeRequired: false,
    },
    teams: onTeams("Infrastructure", "Payments", "Platform"),
  };

  const rowOf = async (name: string) =>
    (await screen.findByText(name)).closest("tr") as HTMLElement;

  it("shows each person's role, teams, and status, with the one warning that matters", async () => {
    api(MANAGE, [ada, grace, linus]);

    renderMembers();

    const adaRow = await rowOf("Ada Lovelace");
    const graceRow = await rowOf("Grace Hopper");
    const linusRow = await rowOf("Linus Torvalds");

    // Each person sits under their role's heading.
    const table = screen.getByRole("table", { name: "Members" });
    const headings = within(table)
      .getAllByRole("columnheader")
      .map((cell) => cell.textContent);
    expect(headings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Admins"),
        expect.stringContaining("Responders"),
      ]),
    );
    expect(within(adaRow).getByText("You")).toBeDefined();
    expect(within(adaRow).getAllByText("Active").length).toBeGreaterThan(0);
    // An Admin is not bound by teams: no team is no warning for them.
    expect(within(adaRow).queryByText(/sees no incidents/)).toBeNull();

    expect(
      within(graceRow).getAllByText("Awaiting first sign-in").length,
    ).toBeGreaterThan(0);
    expect(
      within(graceRow).getAllByText("No team · sees no incidents").length,
    ).toBeGreaterThan(0);

    // Three teams: two chips, the rest summarised, the full list still there
    // for a screen reader and the tooltip.
    expect(within(linusRow).getByText("+1")).toBeDefined();
    expect(
      within(linusRow).getByText("Infrastructure, Payments, Platform"),
    ).toBeDefined();
    expect(within(linusRow).queryByText(/sees no incidents/)).toBeNull();

    // The name is the way to their page; there is no separate View.
    expect(
      within(linusRow)
        .getByRole("link", { name: "Linus Torvalds" })
        .getAttribute("href"),
    ).toBe(`/orgs/acme-ops/members/${linus.id}`);
    expect(within(linusRow).queryByRole("link", { name: /^View/ })).toBeNull();
  });

  it("points a member to their teams, and asks for no one", async () => {
    const { requests } = api(MEMBER, [ada, grace, linus]);

    renderMembers();

    expect(
      await screen.findByText("Your teammates are on your teams' pages"),
    ).toBeDefined();
    expect(screen.getByRole("link", { name: "Go to Teams" }).getAttribute("href")).toBe(
      "/orgs/acme-ops/teams",
    );
    expect(screen.queryByRole("table", { name: "Members" })).toBeNull();
    expect(requests.some((request) => request.path.endsWith("/memberships"))).toBe(false);
  });

  it("finds people by name or email, and narrows by role or by what wants attention", async () => {
    const user = userEvent.setup();
    api(MANAGE, [ada, grace, linus]);

    renderMembers();

    const table = await screen.findByRole("table", { name: "Members" });
    const names = () =>
      within(table)
        .queryAllByRole("row")
        .slice(1)
        .map((row) => row.querySelector(".font-medium")?.textContent)
        // The rows that head each role's group name no one.
        .filter(Boolean);

    expect(names()).toEqual(["Ada Lovelace", "Grace Hopper", "Linus Torvalds"]);

    // Each filter says how many it holds.
    expect(screen.getByRole("button", { name: "All 3" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Awaiting sign-in 1" })).toBeDefined();
    expect(screen.getByRole("button", { name: "No team 1" })).toBeDefined();

    await user.click(screen.getByRole("button", { name: "No team 1" }));
    expect(names()).toEqual(["Grace Hopper"]);
    expect(
      screen.getByRole("button", { name: "No team 1" }).getAttribute("aria-pressed"),
    ).toBe("true");

    await user.click(screen.getByRole("button", { name: "Admins 1" }));
    expect(names()).toEqual(["Ada Lovelace"]);

    await user.click(screen.getByRole("button", { name: "All 3" }));
    // The search is a button until it is wanted.
    await user.click(screen.getByRole("button", { name: "Open search" }));
    await user.type(screen.getByLabelText("Search members"), "LINUS@");
    expect(names()).toEqual(["Linus Torvalds"]);

    await user.clear(screen.getByLabelText("Search members"));
    await user.type(screen.getByLabelText("Search members"), "nobody");
    expect(screen.getByText(/No members match/)).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Show everyone" }));
    expect(names()).toHaveLength(3);
  });

  it("offers nothing to change, and no Action column, to someone who only reads", async () => {
    api(READ_ONLY, [ada, linus]);

    renderMembers();

    await screen.findByRole("link", { name: "Linus Torvalds" });
    expect(screen.queryByRole("button", { name: /^Manage/ })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Actions" })).toBeNull();
  });
});

describe("placing members on teams, from the list", () => {
  const PLACE = [...MANAGE, "teams:manage", "teams:read", "services:read"];
  const PAYMENTS_REF = { id: PAYMENTS.id, name: "Payments", slug: "payments" };
  const PLATFORM_REF = { id: PLATFORM.id, name: "Platform", slug: "platform" };
  const sam = {
    ...grace,
    user: { ...grace.user, name: "Sam Okafor", passwordChangeRequired: false },
    teams: [PAYMENTS_REF, PLATFORM_REF],
  };
  const services = [
    {
      id: "0199a1b2-c3d4-7000-8000-0000000000f1",
      name: "Payment API",
      slug: "payment-api",
      description: null,
      criticality: "CRITICAL",
      ownerTeam: PAYMENTS_REF,
      archivedAt: null,
      createdAt: "2026-09-18T12:00:00.000Z",
      updatedAt: "2026-09-18T12:00:00.000Z",
    },
  ];
  const withServices = (handler: Handler = () => undefined): Handler => (request) =>
    handler(request) ??
    (route(request) === `GET ${base}/services`
      ? jsonResponse(200, services)
      : undefined);

  beforeEach(() => {
    clearAccessToken();
  });

  it("opens Manage as a dialog of tinted sections, and hands a choice to its own dialog", async () => {
    const user = userEvent.setup();
    api(PLACE, [ada, sam], withServices());

    renderMembers();

    await user.click(
      await screen.findByRole("button", { name: "Manage Sam Okafor" }),
    );

    const dialog = screen.getByRole("dialog", { name: "Manage Sam Okafor" });
    const section = (name: string) =>
      within(dialog).getByRole("region", { name });

    // Each kind of change in its own tint.
    expect(section("Teams").className).toContain("bg-info-subtle");
    expect(section("Role").className).toContain("bg-warning-subtle");
    expect(section("Account").className).toContain("bg-sunken");
    expect(section("Leaving").className).toContain("bg-danger-subtle");

    await user.click(
      within(section("Teams")).getByRole("button", { name: /^Add to a team/ }),
    );

    // One dialog at a time: Manage gives way to the change chosen.
    expect(screen.queryByRole("dialog", { name: "Manage Sam Okafor" })).toBeNull();
    expect(
      screen.getByRole("dialog", { name: "Add Sam Okafor to a team" }),
    ).toBeDefined();
  });

  it("offers the teams under Manage, saying which are left and which they are on", async () => {
    const user = userEvent.setup();
    api(PLACE, [ada, sam], withServices());

    renderMembers();

    const add = await manageChoice(user, "Sam Okafor", /^Add to a team/);
    const off = within(
      screen.getByRole("dialog", { name: "Manage Sam Okafor" }),
    ).getByRole("button", { name: /^Take off a team/ });

    expect(add.disabled).toBe(false);
    await waitFor(() =>
      expect(add.textContent).toContain("1 team left: Infrastructure"),
    );
    expect(off.textContent).toContain("On Payments and Platform");

    await user.keyboard("{Escape}");

    const adaOff = await manageChoice(user, "Ada Lovelace", /^Take off a team/);

    expect(adaOff.disabled).toBe(true);
    expect(adaOff.textContent).toContain("Not on any team");
  });

  it("adds to a team they are not on yet, saying what each team owns", async () => {
    const user = userEvent.setup();
    const { requests } = api(
      PLACE,
      [ada, sam],
      withServices((request) =>
        route(request) === `POST ${base}/teams/${INFRASTRUCTURE.id}/members`
          ? jsonResponse(201, {
              membershipId: sam.id,
              addedAt: "2026-09-19T12:00:00.000Z",
              user: sam.user,
            })
          : undefined,
      ),
    );

    renderMembers();

    await user.click(await manageChoice(user, "Sam Okafor", /^Add to a team/));

    const dialog = screen.getByRole("dialog", { name: "Add Sam Okafor to a team" });
    const choices = within(dialog).getAllByRole("radio");

    // Only Infrastructure: Sam is on Payments and Platform already.
    expect(choices).toHaveLength(1);
    expect(within(dialog).getByText(/Already on Payments, Platform/)).toBeDefined();
    expect(within(dialog).getByText(/Owns no services yet/)).toBeDefined();

    await user.click(
      within(dialog).getByRole("button", { name: "Add to Infrastructure" }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).toBeNull(),
    );
    expect(
      requests.find(
        (r) => route(r) === `POST ${base}/teams/${INFRASTRUCTURE.id}/members`,
      )?.body,
    ).toEqual({ membershipId: sam.id });
    // The list, and the teams it shows, are read again.
    expect(
      requests.filter((r) => route(r) === `GET ${base}/memberships`).length,
    ).toBeGreaterThan(1);
  });

  it("removes from the team chosen, saying what that changes", async () => {
    const user = userEvent.setup();
    const { requests } = api(
      PLACE,
      [ada, sam],
      withServices((request) =>
        route(request) === `DELETE ${base}/teams/${PAYMENTS.id}/members/${sam.id}`
          ? jsonResponse(204)
          : undefined,
      ),
    );

    renderMembers();

    await user.click(await manageChoice(user, "Sam Okafor", /^Take off a team/));

    const dialog = screen.getByRole("dialog", {
      name: "Remove Sam Okafor from a team",
    });

    expect(within(dialog).getAllByRole("radio")).toHaveLength(2);
    expect(
      await within(dialog).findByText(
        /Sam will stop responding to Payment API incidents\. Still on Platform\./,
      ),
    ).toBeDefined();

    await user.click(
      within(dialog).getByRole("button", { name: "Remove from Payments" }),
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(
      requests.some(
        (r) =>
          route(r) === `DELETE ${base}/teams/${PAYMENTS.id}/members/${sam.id}`,
      ),
    ).toBe(true);
  });

  it("warns when the last team goes, and explains a removal already made", async () => {
    const user = userEvent.setup();
    api(
      PLACE,
      [ada, { ...sam, teams: [PAYMENTS_REF] }],
      withServices((request) =>
        request.method === "DELETE"
          ? apiError(404, "TEAM_MEMBER_NOT_FOUND")
          : undefined,
      ),
    );

    renderMembers();

    await user.click(await manageChoice(user, "Sam Okafor", /^Take off a team/));

    const dialog = screen.getByRole("dialog", {
      name: "Remove Sam Okafor from a team",
    });

    expect(
      await within(dialog).findByText(/will be on no team, and see no incidents/),
    ).toBeDefined();

    await user.click(
      within(dialog).getByRole("button", { name: "Remove from Payments" }),
    );

    expect(
      await within(dialog).findByText(/no longer on that team/),
    ).toBeDefined();
  });
});

describe("a member's row, opened", () => {
  const PAYMENTS_REF = { id: PAYMENTS.id, name: "Payments", slug: "payments" };
  const PLATFORM_REF = { id: PLATFORM.id, name: "Platform", slug: "platform" };
  const service = (n: number, name: string, owner: typeof PAYMENTS_REF) => ({
    id: `0199a1b2-c3d4-7000-8000-0000000000f${n}`,
    name,
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    description: null,
    criticality: "CRITICAL",
    ownerTeam: owner,
    archivedAt: null,
    createdAt: "2026-09-18T12:00:00.000Z",
    updatedAt: "2026-09-18T12:00:00.000Z",
  });
  const sam = {
    ...grace,
    user: { ...grace.user, name: "Sam Okafor", passwordChangeRequired: false },
    teams: [PAYMENTS_REF, PLATFORM_REF],
  };
  const withServices: Handler = (request) =>
    route(request) === `GET ${base}/services`
      ? jsonResponse(200, [
          service(1, "Payment API", PAYMENTS_REF),
          service(2, "Ledger", PAYMENTS_REF),
          service(3, "Search", { id: INFRASTRUCTURE.id, name: "Infrastructure", slug: "infrastructure" }),
        ])
      : undefined;
  const READ_SERVICES = [...READ_ONLY, "services:read"];

  beforeEach(() => {
    clearAccessToken();
  });

  it("shows their teams and what those own, and the services they respond to", async () => {
    const user = userEvent.setup();
    api(READ_SERVICES, [ada, sam], withServices);

    renderMembers();

    const toggle = await screen.findByRole("button", {
      name: "Show teams of Sam Okafor",
    });

    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    await user.click(toggle);

    const teams = screen.getByRole("region", { name: "Teams of Sam Okafor" });
    const covers = screen.getByRole("region", {
      name: "Services Sam Okafor responds to",
    });

    expect(
      within(teams).getByRole("link", { name: /Payments/ }).getAttribute("href"),
    ).toBe("/orgs/acme-ops/teams/payments");
    expect(
      await within(teams).findByText("Owns Payment API, Ledger"),
    ).toBeDefined();
    expect(within(teams).getByText("Owns no services yet")).toBeDefined();

    // What their teams own — and nothing another team owns.
    expect(within(covers).getAllByRole("link")).toHaveLength(2);
    expect(within(covers).getAllByText("via Payments")).toHaveLength(2);
    expect(within(covers).queryByText("Search")).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Hide teams of Sam Okafor" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("opens from a click on the row, but not from its actions", async () => {
    const user = userEvent.setup();
    api([...READ_SERVICES, "teams:manage", "teams:read"], [ada, sam], withServices);

    renderMembers();

    // Anywhere on the row but its links and buttons: here, the email.
    await user.click(await screen.findByText(sam.user.email));
    expect(
      screen.getByRole("region", { name: "Teams of Sam Okafor" }),
    ).toBeDefined();

    await user.click(screen.getByText(sam.user.email));
    expect(
      screen.queryByRole("region", { name: "Teams of Sam Okafor" }),
    ).toBeNull();

    await user.click(await manageChoice(user, "Sam Okafor", /^Add to a team/));
    await screen.findByRole("dialog", { name: "Add Sam Okafor to a team" });
    expect(
      screen.queryByRole("region", { name: "Teams of Sam Okafor" }),
    ).toBeNull();
  });

  it("says why a Member on no team responds to nothing", async () => {
    const user = userEvent.setup();
    api(READ_SERVICES, [ada, grace], withServices);

    renderMembers();

    await user.click(
      await screen.findByRole("button", { name: "Show teams of Grace Hopper" }),
    );

    expect(
      screen.getByText("Grace is on no team, so sees no incidents."),
    ).toBeDefined();
    expect(
      await screen.findByText("Nothing yet: people respond through their teams."),
    ).toBeDefined();
  });

  it("leaves services out without services:read", async () => {
    const user = userEvent.setup();
    const { requests } = api(READ_ONLY, [ada, sam]);

    renderMembers();

    await user.click(
      await screen.findByRole("button", { name: "Show teams of Sam Okafor" }),
    );

    expect(
      screen.getByRole("region", { name: "Teams of Sam Okafor" }),
    ).toBeDefined();
    expect(
      screen.queryByRole("region", { name: /responds to/ }),
    ).toBeNull();
    expect(requests.some((r) => route(r) === `GET ${base}/services`)).toBe(false);
  });
});

describe("changing a role", () => {
  beforeEach(() => {
    clearAccessToken();
  });

  const linus = {
    ...grace,
    id: "0199a1b2-c3d4-7000-8000-0000000000cc",
    user: {
      ...grace.user,
      id: "0199a1b2-c3d4-7000-8000-000000000003",
      name: "Linus Torvalds",
      email: "linus@example.com",
      passwordChangeRequired: false,
    },
  };

  it("offers Change role to whoever manages members, never to the only Admin", async () => {
    const user = userEvent.setup();
    api(MANAGE, [ada, linus]);

    renderMembers();

    const linusRole = await manageChoice(user, "Linus Torvalds", /^Change role/);

    expect(linusRole.disabled).toBe(false);

    await user.keyboard("{Escape}");

    const adaRole = await manageChoice(user, "Ada Lovelace", /^Change role/);

    expect(adaRole.disabled).toBe(true);
    expect(adaRole.textContent).toContain("The only Admin keeps their role");
  });

  it("offers no Change role to someone who only reads the directory", async () => {
    api(READ_ONLY, [ada, linus]);

    renderMembers();

    await screen.findByRole("link", { name: "Linus Torvalds" });
    expect(screen.queryByRole("button", { name: /^Manage/ })).toBeNull();
  });

  it("says what the new role gives and takes away, then sends it", async () => {
    const user = userEvent.setup();
    const { requests } = api(MANAGE, [ada, linus], (request) =>
      route(request) === `PUT ${base}/memberships/${linus.id}/role`
        ? jsonResponse(200, { ...linus, role: "INCIDENT_MANAGER" })
        : undefined,
    );

    renderMembers();
    await user.click(await manageChoice(user, "Linus Torvalds", /^Change role/));

    const dialog = screen.getByRole("dialog", {
      name: "Change Linus Torvalds's role",
    });
    const current = within(dialog).getByRole("radio", { name: /^Responder/ });

    expect((current as HTMLInputElement).checked).toBe(true);
    expect(within(dialog).getByText("Current")).toBeDefined();
    // Nothing to change until another role is chosen.
    expect(
      (within(dialog).getByRole("button", { name: "Change role" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(within(dialog).getByText("Choose a new role to continue.")).toBeDefined();

    await user.click(
      within(dialog).getByRole("radio", { name: /^Incident Manager/ }),
    );

    const changes = within(dialog).getByRole("region", {
      name: "What changes for Linus",
    });
    expect(changes.textContent).toContain(
      "Decide on incidents: severity, who responds, and resolving",
    );
    expect(changes.textContent).toContain("No longer:");

    await user.click(
      within(dialog).getByRole("button", { name: "Make Incident Manager" }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Change Linus Torvalds's role" }),
      ).toBeNull(),
    );
    expect(
      requests.find(
        (r) => route(r) === `PUT ${base}/memberships/${linus.id}/role`,
      )?.body,
    ).toEqual({ role: "INCIDENT_MANAGER" });
  });

  it("explains that the only Admin keeps their role", async () => {
    const user = userEvent.setup();
    const other = { ...ada, id: "0199a1b2-c3d4-7000-8000-0000000000ad", user: { ...ada.user, id: "0199a1b2-c3d4-7000-8000-000000000009", name: "Alan Turing", email: "alan@example.com" } };
    api(MANAGE, [ada, other], (request) =>
      route(request) === `PUT ${base}/memberships/${other.id}/role`
        ? apiError(409, "LAST_ADMIN")
        : undefined,
    );

    renderMembers();
    await user.click(await manageChoice(user, "Alan Turing", /^Change role/));
    const dialog = screen.getByRole("dialog", {
      name: "Change Alan Turing's role",
    });
    await user.click(within(dialog).getByRole("radio", { name: /^Reporter/ }));
    await user.click(within(dialog).getByRole("button", { name: "Make Reporter" }));

    expect(
      await within(dialog).findByText(/The only Admin keeps their role/),
    ).toBeDefined();
  });
});

/** Opens a person's Manage menu and finds its Reset password choice. */
const resetItemOf = (user: ReturnType<typeof userEvent.setup>, name: string) =>
  manageChoice(user, name, /^Reset password/);

describe("resetting a password", () => {
  beforeEach(() => {
    clearAccessToken();
  });

  const linus = {
    ...grace,
    id: "0199a1b2-c3d4-7000-8000-0000000000cc",
    user: {
      ...grace.user,
      id: "0199a1b2-c3d4-7000-8000-000000000003",
      name: "Linus Torvalds",
      email: "linus@example.com",
      passwordChangeRequired: false,
    },
  };

  it("offers Reset password in a row's More menu, never on their own row", async () => {
    const user = userEvent.setup();
    api(MANAGE, [ada, linus]);

    renderMembers();

    const theirs = await resetItemOf(user, "Linus Torvalds");

    expect(theirs.disabled).toBe(false);

    await user.keyboard("{Escape}");

    const own = await resetItemOf(user, "Ada Lovelace");

    expect(own.disabled).toBe(true);
    expect(own.textContent).toContain("Change your own from your account");
  });

  it("offers no Reset password to someone who only reads the directory", async () => {
    api(READ_ONLY, [ada, linus]);

    renderMembers();

    await screen.findByRole("link", { name: "Linus Torvalds" });
    expect(screen.queryByRole("button", { name: /^Manage/ })).toBeNull();
  });

  it("says what happens, sends the new password, and shows the sign-in details once", async () => {
    const user = userEvent.setup();
    const { requests } = api(MANAGE, [ada, linus], (request) =>
      route(request) === `PUT ${base}/memberships/${linus.id}/password`
        ? jsonResponse(200, {
            ...linus,
            user: { ...linus.user, passwordChangeRequired: true },
          })
        : undefined,
    );

    renderMembers();
    await user.click(await resetItemOf(user, "Linus Torvalds"));

    const dialog = screen.getByRole("dialog", {
      name: "Reset Linus Torvalds's password",
    });

    expect(within(dialog).getByText(/signed out everywhere/)).toBeDefined();
    expect(
      (within(dialog).getByRole("button", { name: "Reset password" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    await user.type(
      within(dialog).getByLabelText(/New one-time password/),
      "a-fresh-one-time-password",
    );
    await user.click(within(dialog).getByRole("button", { name: "Reset password" }));

    const panel = await within(dialog).findByRole("status");

    expect(panel.textContent).toContain("Linus Torvalds's password was reset.");
    expect(
      (within(panel).getByLabelText("Sign-in password") as HTMLInputElement).value,
    ).toBe("a-fresh-one-time-password");
    expect(
      requests.find(
        (r) => route(r) === `PUT ${base}/memberships/${linus.id}/password`,
      )?.body,
    ).toEqual({ temporaryPassword: "a-fresh-one-time-password" });
  });

  it("explains a member who also belongs to another organization", async () => {
    const user = userEvent.setup();
    api(MANAGE, [ada, linus], (request) =>
      route(request) === `PUT ${base}/memberships/${linus.id}/password`
        ? apiError(409, "MEMBER_OF_OTHER_ORGANIZATIONS")
        : undefined,
    );

    renderMembers();
    await user.click(await resetItemOf(user, "Linus Torvalds"));
    const dialog = screen.getByRole("dialog", {
      name: "Reset Linus Torvalds's password",
    });
    await user.click(within(dialog).getByRole("button", { name: "Generate" }));
    await user.click(within(dialog).getByRole("button", { name: "Reset password" }));

    expect(
      await within(dialog).findByText(/also belongs to another organization/),
    ).toBeDefined();
  });
});

describe("adding a member", () => {
  beforeEach(() => {
    clearAccessToken();
  });

  it("asks for a role, none chosen, and closes on Cancel without adding anyone", async () => {
    const { requests } = api(MANAGE);
    const user = userEvent.setup();

    const dialog = await renderAddMember();

    await within(dialog).findByLabelText("Name");
    const roles = within(dialog).getAllByRole("radio");
    expect(roles).toHaveLength(4);
    expect(roles.every((radio) => !(radio as HTMLInputElement).checked)).toBe(
      true,
    );

    await user.type(within(dialog).getByLabelText("Name"), "Grace Hopper");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("dialog", { name: "Add member" })).toBeNull();
    expect(
      requests.some((r) => route(r) === `POST ${base}/memberships`),
    ).toBe(false);
  });

  it("fills in a generated one-time password", async () => {
    api(MANAGE);

    const dialog = await renderAddMember();

    const field = await within(dialog).findByLabelText("One-time password");
    await userEvent
      .setup()
      .click(within(dialog).getByRole("button", { name: "Generate" }));

    expect((field as HTMLInputElement).value).toMatch(
      /^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/,
    );
  });

  it("sends the person, and shows their sign-in details once", async () => {
    let added = false;
    const { requests } = api(MANAGE, [ada], (request) => {
      if (route(request) === `POST ${base}/memberships`) {
        added = true;
        return jsonResponse(201, grace);
      }
      if (route(request) === `GET ${base}/memberships` && added) {
        return jsonResponse(200, [ada, grace]);
      }
      return undefined;
    });
    const user = userEvent.setup();

    const dialog = await renderAddMember();

    await user.type(await within(dialog).findByLabelText("Name"), "Grace Hopper");
    await user.type(within(dialog).getByLabelText("Email"), "grace@example.com");
    await user.type(
      within(dialog).getByLabelText("One-time password"),
      "one-time-password-123",
    );
    await chooseRole(user, dialog, "Responder");
    await user.click(submit(dialog));

    const panel = await within(dialog).findByRole("status");
    expect(panel.textContent).toContain("Grace Hopper was added as a Responder.");
    expect(
      (within(panel).getByLabelText("Sign-in email") as HTMLInputElement).value,
    ).toBe("grace@example.com");
    expect(
      (within(panel).getByLabelText("Sign-in password") as HTMLInputElement)
        .value,
    ).toBe("one-time-password-123");

    expect(
      requests.find((r) => route(r) === `POST ${base}/memberships`)?.body,
    ).toEqual({
      name: "Grace Hopper",
      email: "grace@example.com",
      temporaryPassword: "one-time-password-123",
      role: "RESPONDER",
      teamIds: [],
    });
    expect(panel.textContent).toContain("Not on any team yet.");
    // The details replace the form.
    expect(within(dialog).queryByLabelText("One-time password")).toBeNull();

    // Add another forgets the password, and starts from an empty form.
    await user.click(within(panel).getByRole("button", { name: "Add another" }));
    await waitFor(() =>
      expect(screen.queryByLabelText("Sign-in password")).toBeNull(),
    );
    expect(
      (within(dialog).getByLabelText("One-time password") as HTMLInputElement)
        .value,
    ).toBe("");
    expect(
      (within(dialog).getByLabelText("Name") as HTMLInputElement).value,
    ).toBe("");
  });

  it("keeps the sign-in details through a stray backdrop click, and closes on Done", async () => {
    api(MANAGE, [ada], (request) =>
      route(request) === `POST ${base}/memberships`
        ? jsonResponse(201, grace)
        : undefined,
    );
    const user = userEvent.setup();

    const dialog = await renderAddMember();

    await user.type(await within(dialog).findByLabelText("Name"), "Grace Hopper");
    await user.type(within(dialog).getByLabelText("Email"), "grace@example.com");
    await user.type(
      within(dialog).getByLabelText("One-time password"),
      "one-time-password-123",
    );
    await chooseRole(user, dialog, "Responder");
    await user.click(submit(dialog));

    const panel = await within(dialog).findByRole("status");

    // A click on the backdrop lands on the dialog element itself.
    fireEvent.click(dialog);
    expect(screen.getByRole("dialog", { name: "Add member" })).toBeDefined();

    await user.click(within(panel).getByRole("button", { name: "Done" }));

    expect(screen.queryByRole("dialog", { name: "Add member" })).toBeNull();
  });

  it("explains an email that already has an account", async () => {
    api(MANAGE, [ada], (request) =>
      route(request) === `POST ${base}/memberships`
        ? apiError(409, "EMAIL_ALREADY_REGISTERED")
        : undefined,
    );
    const user = userEvent.setup();

    const dialog = await renderAddMember();

    await user.type(await within(dialog).findByLabelText("Name"), "Ada");
    await user.type(within(dialog).getByLabelText("Email"), "ada@example.com");
    await user.type(
      within(dialog).getByLabelText("One-time password"),
      "one-time-password-123",
    );
    await chooseRole(user, dialog, "Responder");
    await user.click(submit(dialog));

    expect(
      await screen.findByText("An account with this email already exists."),
    ).toBeDefined();
  });
});

describe("choosing teams when adding a member", () => {
  beforeEach(() => {
    clearAccessToken();
  });

  const fillIn = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(await screen.findByLabelText("Name"), "Grace Hopper");
    await user.type(screen.getByLabelText("Email"), "grace@example.com");
    await user.type(
      screen.getByLabelText("One-time password"),
      "one-time-password-123",
    );
  };

  it("offers every team as an optional choice, none chosen", async () => {
    api(MANAGE);

    const dialog = await renderAddMember();

    const teams = await within(dialog).findByRole("group", { name: /Teams/ });
    const boxes = await within(teams).findAllByRole("checkbox");

    // Each named by its team alone; what it owns and its size describe it.
    expect(
      boxes.map((box) =>
        document.getElementById(box.getAttribute("aria-labelledby")!)?.textContent,
      ),
    ).toEqual(["Infrastructure", "Payments", "Platform"]);
    expect(within(teams).getAllByText(/0 members/)).toHaveLength(3);
    expect(boxes.every((box) => !(box as HTMLInputElement).checked)).toBe(true);
  });

  it("warns a Responder with no team, and no other role", async () => {
    const user = userEvent.setup();
    api(MANAGE);

    const dialog = await renderAddMember();

    // Only a Responder's work comes through their teams.
    await within(dialog).findByRole("region", { name: "Teams to choose from" });
    await chooseRole(user, dialog, "Reporter");
    expect(within(dialog).queryByText(/see no incidents/)).toBeNull();
    await chooseRole(user, dialog, "Responder");

    expect(
      await within(dialog).findByText(/With no team, they.ll see no incidents/),
    ).toBeDefined();

    await user.type(within(dialog).getByLabelText("Name"), "Ada Nwosu");
    await user.click(within(dialog).getByRole("checkbox", { name: "Payments" }));

    expect(within(dialog).queryByText(/see no incidents/)).toBeNull();
    expect(
      within(dialog).getByText(/Ada will respond to Payments incidents/),
    ).toBeDefined();
  });

  it("keeps many teams in a scrolling area, searchable, without losing a choice", async () => {
    const user = userEvent.setup();
    const many = [
      "Billing", "Data", "Identity", "Mobile", "Payments", "Platform", "Risk", "Search", "Web",
    ].map((name, n) => team(`0199a1b2-c3d4-7000-8000-0000000001${n}0`, name));
    api(MANAGE, [ada], (request) =>
      route(request) === `GET ${base}/teams` ? jsonResponse(200, many) : undefined,
    );

    const dialog = await renderAddMember();
    const area = await within(dialog).findByRole("region", {
      name: "Teams to choose from",
    });

    // Scrolls in place, and can be reached by keyboard to do so.
    expect(area.className).toContain("overflow-y-auto");
    expect(area.getAttribute("tabindex")).toBe("0");
    expect(within(area).getAllByRole("checkbox")).toHaveLength(9);

    await user.click(within(area).getByRole("checkbox", { name: "Risk" }));
    expect(within(dialog).getByText(/1 selected/)).toBeDefined();

    // Past six teams, a search narrows the cards.
    await user.type(within(dialog).getByLabelText("Find a team"), "pay");
    expect(
      within(area).getAllByRole("checkbox").map((box) => box.getAttribute("aria-labelledby")),
    ).toHaveLength(1);

    // Risk is out of view, and still chosen.
    expect(within(dialog).getByText(/1 selected/)).toBeDefined();

    await user.clear(within(dialog).getByLabelText("Find a team"));
    await user.type(within(dialog).getByLabelText("Find a team"), "zzz");
    expect(within(area).getByText(/No team matches/)).toBeDefined();
  });

  it("offers no search for a handful of teams", async () => {
    api(MANAGE);

    const dialog = await renderAddMember();

    await within(dialog).findByRole("region", { name: "Teams to choose from" });
    expect(within(dialog).queryByLabelText("Find a team")).toBeNull();
  });

  it("shows, hides, and generates the one-time password", async () => {
    const user = userEvent.setup();
    api(MANAGE);

    const dialog = await renderAddMember();
    const password = within(dialog).getByLabelText(
      "One-time password",
    ) as HTMLInputElement;

    await user.click(within(dialog).getByRole("button", { name: "Generate" }));
    expect(password.value).toMatch(/^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
    expect(password.type).toBe("text");

    await user.click(within(dialog).getByRole("button", { name: "Hide" }));
    expect(password.type).toBe("password");
    expect(
      within(dialog).getByRole("button", { name: "Show" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("sends the chosen teams and says which the member is on", async () => {
    const { requests } = api(MANAGE, [ada], (request) =>
      route(request) === `POST ${base}/memberships`
        ? jsonResponse(201, {
            ...grace,
            teams: [
              { id: PAYMENTS.id, name: "Payments", slug: "payments" },
              { id: PLATFORM.id, name: "Platform", slug: "platform" },
            ],
          })
        : undefined,
    );
    const user = userEvent.setup();

    const dialog = await renderAddMember();
    await fillIn(user);
    await chooseRole(user, dialog, "Responder");
    await user.click(await screen.findByRole("checkbox", { name: "Platform" }));
    await user.click(screen.getByRole("checkbox", { name: "Payments" }));
    await user.click(submit(dialog));

    const panel = await within(dialog).findByRole("status");

    expect(panel.textContent).toContain("On Payments, Platform.");
    expect(
      requests.find((r) => route(r) === `POST ${base}/memberships`)?.body,
    ).toMatchObject({ teamIds: [PAYMENTS.id, PLATFORM.id] });
    // The form is clear for the next person.
    await user.click(within(panel).getByRole("button", { name: "Add another" }));
    expect(
      (screen.getByRole("checkbox", { name: "Payments" }) as HTMLInputElement)
        .checked,
    ).toBe(false);
  });

  it("explains a team that vanished, and says no one was added", async () => {
    api(MANAGE, [ada], (request) =>
      route(request) === `POST ${base}/memberships`
        ? apiError(404, "TEAM_NOT_FOUND")
        : undefined,
    );
    const user = userEvent.setup();

    const dialog = await renderAddMember();
    await fillIn(user);
    await chooseRole(user, dialog, "Responder");
    await user.click(await screen.findByRole("checkbox", { name: "Payments" }));
    await user.click(submit(dialog));

    expect(
      await screen.findByText(/One of the chosen teams no longer exists/),
    ).toBeDefined();
    expect(screen.getByText(/No one was added/)).toBeDefined();
  });

  it("points to creating a team when there are none", async () => {
    mockApi((request) => {
      switch (route(request)) {
        case "POST /auth/refresh":
          return refreshed("token");
        case "GET /auth/me":
          return jsonResponse(200, currentUser);
        case `GET ${base}`:
          return jsonResponse(200, organizationDetail(MANAGE));
        case `GET ${base}/memberships`:
          return jsonResponse(200, [ada]);
        case `GET ${base}/teams`:
          return jsonResponse(200, []);
        default:
          return apiError(404);
      }
    });

    await renderAddMember();

    expect(await screen.findByText(/There are no teams yet/)).toBeDefined();
    expect(screen.getByRole("link", { name: "Create one" })).toBeDefined();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});

describe("generateOneTimePassword", () => {
  it("is long enough for the API and different every time", () => {
    const passwords = new Set(
      Array.from({ length: 50 }, () => generateOneTimePassword()),
    );

    expect(passwords.size).toBe(50);
    for (const password of passwords) {
      expect(password.length).toBeGreaterThanOrEqual(12);
      expect(password).not.toMatch(/[lo01]/);
    }
  });
});

describe("removing someone from the organization", () => {
  beforeEach(() => {
    clearAccessToken();
  });

  const linus = {
    ...grace,
    id: "0199a1b2-c3d4-7000-8000-0000000000cc",
    user: {
      ...grace.user,
      id: "0199a1b2-c3d4-7000-8000-000000000003",
      name: "Linus Torvalds",
      email: "linus@example.com",
      passwordChangeRequired: false,
    },
    teams: [{ id: PAYMENTS.id, name: "Payments", slug: "payments" }],
    removal: null,
    openWork: [],
  };

  const removedMaya = {
    ...grace,
    id: "0199a1b2-c3d4-7000-8000-0000000000dd",
    user: {
      ...grace.user,
      id: "0199a1b2-c3d4-7000-8000-000000000004",
      name: "Maya Torres",
      email: "maya@example.com",
      passwordChangeRequired: false,
    },
    removal: {
      removedAt: "2026-11-03T09:00:00.000Z",
      removedBy: { id: currentUser.id, name: "Ada Lovelace" },
    },
    openWork: [],
  };

  const removeItemOf = (
    user: ReturnType<typeof userEvent.setup>,
    name: string,
    choice: RegExp = /Remove from organization/,
  ) => manageChoice(user, name, choice);

  it("says what ends and what stays, then removes them", async () => {
    const user = userEvent.setup();
    const { requests } = api(MANAGE, [ada, linus], (request) =>
      route(request) === `DELETE ${base}/memberships/${linus.id}`
        ? jsonResponse(200, { ...linus, teams: [], removal: removedMaya.removal })
        : undefined,
    );

    renderMembers();
    await user.click(await removeItemOf(user, "Linus Torvalds"));

    const dialog = screen.getByRole("dialog", {
      name: `Remove Linus Torvalds from ${organization.name}?`,
    });

    expect(dialog.textContent).toContain("Payments");
    expect(dialog.textContent).toContain("They are not notified.");

    await user.click(
      within(dialog).getByRole("button", { name: "Remove from organization" }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: /Remove Linus Torvalds/ }),
      ).toBeNull(),
    );
    expect(
      requests.some(
        (r) => route(r) === `DELETE ${base}/memberships/${linus.id}`,
      ),
    ).toBe(true);
  });

  it("keeps Remove greyed with every reason, and links open work to where it is handed over", async () => {
    const user = userEvent.setup();
    const busy = {
      ...linus,
      openWork: [
        {
          kind: "INVESTIGATING",
          incident: { number: 151, title: "Webhooks delayed" },
        },
        {
          kind: "DRAFT_ANALYSIS",
          incident: { number: 139, title: "Stale rates" },
        },
      ],
    };
    api(MANAGE, [ada, busy]);

    renderMembers();

    const item = await removeItemOf(user, "Linus Torvalds", /Can't remove Linus yet/);
    const menu = screen.getByRole("dialog", { name: "Manage Linus Torvalds" });

    expect(item.disabled).toBe(true);
    expect(
      within(menu).queryByRole("button", { name: /^Remove from organization/ }),
    ).toBeNull();
    expect(menu.textContent).toContain("Still investigating INC-151");
    expect(menu.textContent).toContain("unpublished analysis of INC-139");
    // Each piece of open work links to where it is handed over.
    expect(
      within(menu).getByRole("link", { name: "Open INC-151" }).getAttribute("href"),
    ).toBe("/orgs/acme-ops/incidents/151");
    expect(
      within(menu).getByRole("link", { name: "Open INC-139" }).getAttribute("href"),
    ).toBe("/orgs/acme-ops/incidents/139/analysis");

    await user.keyboard("{Escape}");

    const own = await removeItemOf(user, "Ada Lovelace", /You can't remove yourself/);

    expect(own.disabled).toBe(true);
    expect(
      screen.getByRole("dialog", { name: "Manage Ada Lovelace" }).textContent,
    ).toContain("The organization's only Admin can't be removed.");
  });

  it("shows removed people only under Removed, and restores them in the role chosen", async () => {
    const user = userEvent.setup();
    const { requests } = api(MANAGE, [ada, linus, removedMaya], (request) =>
      route(request) === `POST ${base}/memberships/${removedMaya.id}/restore`
        ? jsonResponse(200, { ...removedMaya, role: "REPORTER", removal: null })
        : undefined,
    );

    renderMembers();

    await screen.findByText("Linus Torvalds");
    expect(screen.queryByText("Maya Torres")).toBeNull();

    await user.click(screen.getByRole("button", { name: /^Removed/ }));

    expect(await screen.findByText("Maya Torres")).toBeDefined();
    expect(screen.queryByText("Linus Torvalds")).toBeNull();
    expect(screen.getByText("Former member")).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Restore Maya Torres" }));

    const dialog = screen.getByRole("dialog", { name: "Restore Maya Torres?" });
    const before = within(dialog).getByRole("radio", { name: /^Responder/ });

    expect((before as HTMLInputElement).checked).toBe(true);
    expect(dialog.textContent).toContain("Their role before");

    await user.click(within(dialog).getByRole("radio", { name: /^Reporter/ }));
    await user.click(within(dialog).getByRole("button", { name: "Restore" }));

    await waitFor(() =>
      expect(
        requests.find(
          (r) =>
            route(r) === `POST ${base}/memberships/${removedMaya.id}/restore`,
        )?.body,
      ).toEqual({ role: "REPORTER" }),
    );
  });

  it("offers Restore when Add member is given a removed person's email", async () => {
    const user = userEvent.setup();
    api(MANAGE, [ada, removedMaya], (request) =>
      route(request) === `POST ${base}/memberships`
        ? apiError(409, "MEMBER_REMOVED")
        : undefined,
    );

    const dialog = await renderAddMember();

    await user.type(await within(dialog).findByLabelText("Name"), "Maya");
    await user.type(within(dialog).getByLabelText("Email"), "Maya@example.com");
    await user.type(
      within(dialog).getByLabelText("One-time password"),
      "one-time-password-123",
    );
    await chooseRole(user, dialog, "Responder");
    await user.click(submit(dialog));

    await user.click(
      await within(dialog).findByRole("button", { name: "Restore Maya Torres" }),
    );

    expect(screen.queryByRole("dialog", { name: "Add member" })).toBeNull();
    expect(
      screen.getByRole("dialog", { name: "Restore Maya Torres?" }),
    ).toBeDefined();
  });
});
