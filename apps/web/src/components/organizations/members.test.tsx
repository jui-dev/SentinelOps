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

const MANAGE = ["members:manage", "memberships:read", "organization:read"];
const READ_ONLY = ["memberships:read", "organization:read"];

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
  role: "MEMBER",
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

  it("shows each person's role, teams, and whether they have signed in yet", async () => {
    api(READ_ONLY, [
      ada,
      { ...grace, teams: onTeams("Payments", "Platform") },
      {
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
      },
    ]);

    renderMembers();

    const table = await screen.findByRole("table", { name: "Members" });
    const rows = within(table).getAllByRole("row").slice(1);
    const [adaRow, graceRow, linusRow] = rows;

    expect(within(adaRow).getByText("Admin")).toBeDefined();
    expect(within(adaRow).getAllByText("No team").length).toBeGreaterThan(0);

    expect(within(graceRow).getByText("Member")).toBeDefined();
    expect(
      within(graceRow).getAllByText("Payments, Platform").length,
    ).toBeGreaterThan(0);
    expect(within(graceRow).getByText("Awaiting first sign-in")).toBeDefined();

    // Three teams: two shown, the rest summarised, the full list still there
    // for a screen reader and the tooltip.
    expect(within(linusRow).getAllByText("+1 more").length).toBeGreaterThan(0);
    expect(
      within(linusRow).getAllByText("Infrastructure, Payments, Platform")
        .length,
    ).toBeGreaterThan(0);
    expect(within(linusRow).queryByText("Awaiting first sign-in")).toBeNull();
  });
});

describe("adding a member", () => {
  beforeEach(() => {
    clearAccessToken();
  });

  it("asks for no role, and closes on Cancel without adding anyone", async () => {
    const { requests } = api(MANAGE);
    const user = userEvent.setup();

    const dialog = await renderAddMember();

    await within(dialog).findByLabelText("Name");
    expect(within(dialog).queryByLabelText("Role")).toBeNull();

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
    await user.click(submit(dialog));

    const panel = await within(dialog).findByRole("status");
    expect(panel.textContent).toContain("Grace Hopper was added as a Member.");
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

    expect(boxes.map((box) => box.closest("label")?.textContent)).toEqual([
      "Infrastructure",
      "Payments",
      "Platform",
    ]);
    expect(boxes.every((box) => !(box as HTMLInputElement).checked)).toBe(true);
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
