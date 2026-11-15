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

import { STEPS } from "./how-it-works-content";
import { HowItWorksView } from "./how-it-works-view";

vi.mock("next/navigation", () => ({
  useParams: () => ({ orgSlug: "acme-ops" }),
  usePathname: () => "/orgs/acme-ops/how-it-works",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const base = `/organizations/${organization.id}`;

/** What each role holds, as role-permissions.ts grants it. */
const RESPONDER = [
  "organization:read",
  "memberships:read",
  "teams:read",
  "services:read",
  "incidents:read",
  "incidents:respond",
  "responses:work",
  "incident-analyses:write",
  "notifications:read",
];
const ADMIN = [
  ...RESPONDER.filter((permission) => permission !== "responses:work"),
  "organization:update",
  "activity:read",
  "memberships:read-all",
  "members:manage",
  "teams:manage",
  "services:manage",
  "incidents:read-all",
  "incidents:declare",
  "incidents:manage",
];

const api = (permissions: string[], role: string) =>
  mockApi((request) => {
    switch (route(request)) {
      case "POST /auth/refresh":
        return refreshed("token");
      case "GET /auth/me":
        return jsonResponse(200, currentUser);
      case `GET ${base}`:
        return jsonResponse(200, organizationDetail(permissions, role));
      default:
        return apiError(404);
    }
  });

const render = () =>
  renderWithSession(
    <OrganizationScope>
      <HowItWorksView />
    </OrganizationScope>,
  );

describe("the How it works page", () => {
  beforeEach(() => clearAccessToken());

  it("walks an incident from set up to learning from it, a section per step", async () => {
    api(RESPONDER, "RESPONDER");
    render();

    expect(
      await screen.findByRole("heading", { level: 1, name: "How SentinelOps works" }),
    ).toBeDefined();
    for (const step of STEPS) {
      const section = document.getElementById(`step-${step.id}`);

      expect(section).not.toBeNull();
      expect(within(section!).getByRole("heading", { level: 2 }).textContent).toBe(step.name);
    }
    // The overview's steps lead to their sections.
    const journey = screen.getByRole("list", { name: "The steps" });

    expect(within(journey).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(
      STEPS.map((step) => `#step-${step.id}`),
    );
  });

  it("says who leads and who can help at each step, the reader's own role marked", async () => {
    api(RESPONDER, "RESPONDER");
    render();

    const respond = await screen.findByRole("list", { name: "Who does Respond" });
    const rows = within(respond).getAllByRole("listitem");

    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringMatching(/^ReporterCan help/),
      expect.stringMatching(/^Incident ManagerCan help/),
      expect.stringMatching(/^ResponderLeadsYou/),
      expect.stringMatching(/^AdminCan help/),
    ]);
    expect(screen.getByText(/Reading as/).textContent).toMatch(/Responder/);
  });

  it("links only to the pages the reader's role opens, and says whose the rest are", async () => {
    api(RESPONDER, "RESPONDER");
    render();

    const setUp = (await screen.findAllByText("Members", { selector: "span" }))[0];

    // A Responder cannot open Members: it is said whose it is, not linked.
    expect(screen.queryByRole("link", { name: /^Members/ })).toBeNull();
    expect(setUp.parentElement?.textContent).toMatch(/Incident Manager or Admin/);
    // Their own pages open.
    expect(
      screen.getByRole("link", { name: "My Operations" }).getAttribute("href"),
    ).toBe("/orgs/acme-ops");
    expect(screen.getByRole("link", { name: /^Teams/ }).getAttribute("href")).toBe(
      "/orgs/acme-ops/teams",
    );
  });

  it("opens every step's pages to the Admin, and marks their column of who can do what", async () => {
    api(ADMIN, "ADMIN");
    render();

    expect(
      (await screen.findByRole("link", { name: /^Members/ })).getAttribute("href"),
    ).toBe("/orgs/acme-ops/members");
    expect(screen.getByRole("link", { name: /^Known issues/ })).toBeDefined();
    expect(screen.queryByRole("link", { name: "My Operations" })).toBeNull();

    const table = screen.getByRole("table", { name: "Who can do what, by role" });

    expect(within(table).getByRole("columnheader", { name: /Admin.*\(you\)/ })).toBeDefined();
    const row = within(table).getByRole("row", { name: /Start and complete a response/ });

    expect(within(row).getAllByRole("cell").map((cell) => cell.textContent)).toEqual([
      "—No",
      "—No",
      "✓Yes",
      "—No",
    ]);
  });
});
