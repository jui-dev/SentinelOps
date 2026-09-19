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

describe("adding a member", () => {
  beforeEach(() => {
    clearAccessToken();
  });

  it("offers the form only when the API reports members:manage", async () => {
    api(READ_ONLY);

    renderMembers();

    expect(await screen.findByText("Ada Lovelace")).toBeDefined();
    expect(screen.queryByRole("heading", { name: "Add a member" })).toBeNull();
  });

  it("asks for no role: everyone the Admin adds is a Member", async () => {
    api(MANAGE);

    renderMembers();

    await screen.findByRole("heading", { name: "Add a member" });
    expect(screen.queryByLabelText("Role")).toBeNull();
  });

  it("fills in a generated one-time password", async () => {
    api(MANAGE);

    renderMembers();

    const field = await screen.findByLabelText("One-time password");
    await userEvent.setup().click(screen.getByRole("button", { name: "Generate" }));

    expect((field as HTMLInputElement).value).toMatch(
      /^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/,
    );
  });

  it("sends the person, shows their sign-in details once, and refreshes the list", async () => {
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

    renderMembers();

    await user.type(await screen.findByLabelText("Name"), "Grace Hopper");
    await user.type(screen.getByLabelText("Email"), "grace@example.com");
    await user.type(
      screen.getByLabelText("One-time password"),
      "one-time-password-123",
    );
    await user.click(screen.getByRole("button", { name: "Add member" }));

    const panel = await screen.findByRole("status");
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

    // The list shows the new person, still to sign in for the first time.
    expect(await screen.findByText("Awaiting first sign-in")).toBeDefined();

    // Done forgets the password.
    await user.click(within(panel).getByRole("button", { name: "Done" }));
    await waitFor(() =>
      expect(screen.queryByLabelText("Sign-in password")).toBeNull(),
    );
    expect(
      (screen.getByLabelText("One-time password") as HTMLInputElement).value,
    ).toBe("");
  });

  it("explains an email that already has an account", async () => {
    api(MANAGE, [ada], (request) =>
      route(request) === `POST ${base}/memberships`
        ? apiError(409, "EMAIL_ALREADY_REGISTERED")
        : undefined,
    );
    const user = userEvent.setup();

    renderMembers();

    await user.type(await screen.findByLabelText("Name"), "Ada");
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(
      screen.getByLabelText("One-time password"),
      "one-time-password-123",
    );
    await user.click(screen.getByRole("button", { name: "Add member" }));

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

    renderMembers();

    const teams = await screen.findByRole("group", { name: /Teams/ });
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

    renderMembers();
    await fillIn(user);
    await user.click(await screen.findByRole("checkbox", { name: "Platform" }));
    await user.click(screen.getByRole("checkbox", { name: "Payments" }));
    await user.click(screen.getByRole("button", { name: "Add member" }));

    const panel = await screen.findByRole("status");

    expect(panel.textContent).toContain("On Payments, Platform.");
    expect(
      requests.find((r) => route(r) === `POST ${base}/memberships`)?.body,
    ).toMatchObject({ teamIds: [PAYMENTS.id, PLATFORM.id] });
    // The form is clear for the next person.
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

    renderMembers();
    await fillIn(user);
    await user.click(await screen.findByRole("checkbox", { name: "Payments" }));
    await user.click(screen.getByRole("button", { name: "Add member" }));

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

    renderMembers();

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
