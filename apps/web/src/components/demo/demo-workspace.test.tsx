import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OrganizationScope } from "@/components/organizations/organization-scope";
import type { DemoPart, DemoWorkspaceResponse } from "@/lib/api/contracts";
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

import { DemoWorkspace } from "./demo-workspace";

vi.mock("next/navigation", () => ({
  useParams: () => ({ orgSlug: "acme-ops" }),
  usePathname: () => "/orgs/acme-ops/settings",
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const base = `/organizations/${organization.id}`;
const ADMIN = ["organization:read", "organization:update"];

const RULES: Record<DemoPart, { required: boolean; needs: DemoPart[] }> = {
  accounts: { required: true, needs: [] },
  teams: { required: true, needs: ["accounts"] },
  services: { required: true, needs: ["teams"] },
  knownIssues: { required: false, needs: ["services"] },
  history: { required: false, needs: ["teams", "services"] },
  live: { required: false, needs: ["teams", "services"] },
  analyses: { required: false, needs: ["history"] },
  activity: { required: false, needs: ["services"] },
};

const workspace = (counts: Partial<Record<DemoPart, number>>): DemoWorkspaceResponse => {
  const parts = (Object.keys(RULES) as DemoPart[]).map((id) => ({
    id,
    ...RULES[id],
    count: counts[id] ?? 0,
    loaded: (counts[id] ?? 0) > 0,
    generatable: true,
  }));

  return {
    parts,
    complete: parts.every((part) => part.loaded),
    lastResetAt: null,
    lastResetBy: null,
    historyEndsAt: "2026-11-15T00:00:00.000Z",
  };
};

const FULL = workspace({
  accounts: 7,
  teams: 3,
  services: 3,
  knownIssues: 13,
  history: 71,
  live: 5,
  analyses: 8,
  activity: 65,
});
const REMOVED = workspace({ accounts: 7 });

const api = ({
  demo = true,
  state = FULL,
  after = FULL,
}: { demo?: boolean; state?: DemoWorkspaceResponse; after?: DemoWorkspaceResponse } = {}) =>
  mockApi((request) => {
    switch (route(request)) {
      case "POST /auth/refresh":
        return refreshed("token");
      case "GET /auth/me":
        return jsonResponse(200, currentUser);
      case `GET ${base}`:
        return jsonResponse(200, { ...organizationDetail(ADMIN), demo });
      case `GET ${base}/demo`:
        return jsonResponse(200, state);
      default:
        return request.path.startsWith(`${base}/demo`)
          ? jsonResponse(200, after)
          : apiError(404);
    }
  });

const render = () =>
  renderWithSession(
    <OrganizationScope>
      <DemoWorkspace />
    </OrganizationScope>,
  );

describe("the demo workspace", () => {
  beforeEach(() => clearAccessToken());

  it("is not there for an organization that is not a demo, and asks nothing", async () => {
    const { requests } = api({ demo: false });

    render();

    await waitFor(() =>
      expect(requests.some((request) => route(request) === `GET ${base}`)).toBe(true),
    );
    expect(screen.queryByRole("heading", { name: /Demo workspace/ })).toBeNull();
    expect(requests.some((request) => request.path.endsWith("/demo"))).toBe(false);
  });

  it("splits the parts into what SentinelOps needs and what is optional, each with its count", async () => {
    api();
    render();

    const required = await screen.findByRole("region", {
      name: "Needed for SentinelOps to work",
    });
    const optional = screen.getByRole("region", { name: "Makes it look lived-in" });

    expect(within(required).getByText("Organization and demo accounts")).toBeDefined();
    expect(within(required).getByText("Always kept")).toBeDefined();
    // A required part can be made again, never removed on its own.
    expect(within(required).queryByRole("button", { name: /^Remove/ })).toBeNull();
    expect(within(optional).getByText("71 resolved")).toBeDefined();
    expect(within(optional).getByRole("button", { name: "Remove Incident history" })).toBeDefined();
    expect(screen.getByText("Full demo loaded")).toBeDefined();
  });

  it("asks before removing a part, saying what goes with it", async () => {
    const user = userEvent.setup();
    const { requests } = api();

    render();
    await user.click(await screen.findByRole("button", { name: "Remove Incident history" }));

    const dialog = screen.getByRole("dialog", { name: "Remove incident history?" });

    expect(within(dialog).getByText(/Incident analyses needs it, so it goes too/)).toBeDefined();
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() =>
      expect(
        requests.some((request) => route(request) === `DELETE ${base}/demo/parts/history`),
      ).toBe(true),
    );
  });

  it("removes all the demo data only once REMOVE is typed", async () => {
    const user = userEvent.setup();
    const { requests } = api({ after: REMOVED });

    render();
    await user.click(await screen.findByRole("button", { name: "Remove demo data…" }));

    const dialog = screen.getByRole("dialog", { name: "Remove the demo data?" });
    const confirm = within(dialog).getByRole("button", { name: "Remove demo data" });

    expect(within(dialog).getByText("5 live incidents")).toBeDefined();
    expect(confirm.hasAttribute("disabled")).toBe(true);

    await user.type(within(dialog).getByRole("textbox"), "REMOVE");
    await user.click(confirm);

    await waitFor(() =>
      expect(requests.some((request) => route(request) === `DELETE ${base}/demo`)).toBe(true),
    );
    expect(await screen.findByText("The demo data is removed.")).toBeDefined();
  });

  it("offers the essentials or the full demo back once the data is removed", async () => {
    const user = userEvent.setup();
    const { requests } = api({ state: REMOVED, after: REMOVED });

    render();
    await user.click(await screen.findByRole("button", { name: "Generate essentials" }));

    await waitFor(() =>
      expect(
        requests.some((request) => route(request) === `POST ${base}/demo/parts/services`),
      ).toBe(true),
    );

    await user.click(screen.getByRole("button", { name: "Generate full demo" }));

    await waitFor(() =>
      expect(requests.some((request) => route(request) === `POST ${base}/demo/reset`)).toBe(
        true,
      ),
    );
  });
});
