import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { OrganizationScope } from "@/components/organizations/organization-scope";
import type { KnownIssueResponse } from "@/lib/api/contracts";
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
import { expectNoAxeViolations } from "@/test/axe";
import { renderWithSession } from "@/test/render";

import { KnownIssuesView } from "./known-issues-view";
import { likelyDuplicateOf, overlap } from "./similarity";

vi.mock("next/navigation", () => ({
  useParams: () => ({ orgSlug: "acme-ops" }),
  usePathname: () => "/orgs/acme-ops/known-issues",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const ADMIN = ["organization:read", "services:read", "services:manage", "incidents:read"];
const MEMBER = ["organization:read", "services:read", "incidents:read"];
const base = `/organizations/${organization.id}`;

const paymentApi = {
  id: "0199a1b2-c3d4-7000-8000-0000000000d1",
  name: "Payment API",
  slug: "payment-api",
  team: { id: "0199a1b2-c3d4-7000-8000-0000000000c1", name: "Payments", slug: "payments" },
};
const portal = {
  ...paymentApi,
  id: "0199a1b2-c3d4-7000-8000-0000000000d2",
  name: "Customer Portal",
  slug: "customer-portal",
};

const known = (
  id: string,
  name: string,
  overrides: Partial<KnownIssueResponse> = {},
): KnownIssueResponse => ({
  id: `0199a1b2-c3d4-7000-8000-0000000000${id}`,
  name,
  description: null,
  usualSeverity: "SEV2",
  service: paymentApi,
  pendingReview: false,
  archivedAt: null,
  occurrences: { total: 0, lastAt: null, active: null },
  createdAt: "2026-09-01T12:00:00.000Z",
  ...overrides,
});

const checkout = known("a1", "Card payments failing at checkout", {
  usualSeverity: "SEV1",
  occurrences: { total: 4, lastAt: "2026-10-30T09:00:00.000Z", active: 82 },
});
const euCards = known("a2", "Card payment failures for EU customers", {
  pendingReview: true,
  occurrences: { total: 1, lastAt: "2026-11-09T09:00:00.000Z", active: null },
});
const webhooks = known("a3", "Webhook retries backing up", {
  usualSeverity: "SEV3",
  occurrences: { total: 3, lastAt: "2026-09-19T09:00:00.000Z", active: null },
});
const slowPortal = known("a4", "Portal slow to load", { service: portal });
const retired = known("a5", "Old gateway timeouts", {
  archivedAt: "2026-08-01T00:00:00.000Z",
});

const services = [paymentApi, portal].map((service) => ({
  id: service.id,
  name: service.name,
  slug: service.slug,
  description: null,
  criticality: "CRITICAL",
  ownerTeam: service.team,
  archivedAt: null,
  createdAt: "2026-09-01T12:00:00.000Z",
  updatedAt: "2026-09-01T12:00:00.000Z",
}));

const api = (
  permissions: string[],
  issues: KnownIssueResponse[] = [checkout, euCards, webhooks, slowPortal, retired],
  handler: (request: SentRequest) => Response | undefined = () => undefined,
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
      case `GET ${base}/known-issues?archived=include`:
        return jsonResponse(200, issues);
      case `GET ${base}/services`:
        return jsonResponse(200, services);
      default:
        return apiError(404, "NOT_FOUND");
    }
  });

const render = () =>
  renderWithSession(
    <OrganizationScope>
      <KnownIssuesView />
    </OrganizationScope>,
  );

const groupOf = (service: string) =>
  screen.findByRole("region", { name: new RegExp(`^${service}`) });

const sent = (requests: SentRequest[], key: string) =>
  requests.filter((request) => route(request) === key).map(({ body }) => body);

describe("known issues", () => {
  beforeEach(() => {
    clearAccessToken();
  });

  it("groups them by service, most frequent first, and says how often and when", async () => {
    api(ADMIN);
    render();

    const payments = await groupOf("Payment API");
    const rows = within(payments).getAllByRole("listitem");

    expect(rows.map((row) => row.querySelector("p")?.textContent)).toEqual([
      "Card payments failing at checkout",
      "Card payment failures for EU customersNew",
      "Webhook retries backing up",
    ]);
    expect(rows[0].textContent).toMatch(/Usually.*SEV1.*Happened 4 times.*Happening now: INC-82/);
    expect(within(rows[0]).getByRole("link", { name: "Happening now: INC-82" }).getAttribute("href")).toBe(
      "/orgs/acme-ops/incidents/82",
    );
    expect(await groupOf("Customer Portal")).toBeDefined();
    // Archived ones only when asked.
    expect(screen.queryByText("Old gateway timeouts")).toBeNull();
    await expectNoAxeViolations(document.body);
  });

  it("flags what was saved while declaring, says what it looks like, and keeps it", async () => {
    const user = userEvent.setup();
    const { requests } = api(ADMIN, undefined, (request) =>
      route(request) === `PATCH ${base}/known-issues/${euCards.id}`
        ? jsonResponse(200, { ...euCards, pendingReview: false })
        : undefined,
    );

    render();

    expect(
      await screen.findByText(/1 known issue was saved while declaring something new/),
    ).toBeDefined();
    expect(
      screen.getByText("Saved while declaring · looks like “Card payments failing at checkout”"),
    ).toBeDefined();

    await user.click(screen.getByRole("button", { name: `Keep ${euCards.name}` }));

    await waitFor(() =>
      expect(sent(requests, `PATCH ${base}/known-issues/${euCards.id}`)).toEqual([
        { reviewed: true },
      ]),
    );
  });

  it("merges one into another of the same service, suggesting the likely one", async () => {
    const user = userEvent.setup();
    const { requests } = api(ADMIN, undefined, (request) =>
      route(request) === `POST ${base}/known-issues/${euCards.id}/merge`
        ? jsonResponse(201, checkout)
        : undefined,
    );

    render();

    await user.click(await screen.findByRole("button", { name: "Merge…" }));

    const dialog = await screen.findByRole("dialog", {
      name: "Merge “Card payment failures for EU customers”",
    });
    const into = within(dialog).getByLabelText(/Merge into/) as HTMLSelectElement;

    expect(into.value).toBe(checkout.id);
    // Only Payment API's, never the Portal's.
    expect(within(into).queryByRole("option", { name: /Portal slow/ })).toBeNull();
    await expectNoAxeViolations(dialog);

    await user.click(within(dialog).getByRole("button", { name: "Merge 1 incident" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(sent(requests, `POST ${base}/known-issues/${euCards.id}/merge`)).toEqual([
      { intoId: checkout.id },
    ]);
  });

  it("adds one, needing a service, a name and a usual severity", async () => {
    const user = userEvent.setup();
    const { requests } = api(ADMIN, undefined, (request) =>
      route(request) === `POST ${base}/known-issues`
        ? jsonResponse(201, known("b1", "Refunds stuck"))
        : undefined,
    );

    render();

    await user.click(await screen.findByRole("button", { name: "Add known issue" }));

    const dialog = await screen.findByRole("dialog", { name: "Add known issue" });
    const submit = within(dialog).getByRole("button", { name: "Add known issue" });

    expect(
      await within(dialog).findByText("Fill in Service, Name and Severity to continue."),
    ).toBeDefined();
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    await user.selectOptions(within(dialog).getByLabelText(/^Service/), paymentApi.id);
    await user.type(within(dialog).getByLabelText(/^Name/), "Refunds stuck");
    await user.selectOptions(within(dialog).getByLabelText(/^Severity/), "SEV3");
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(false));
    await user.click(submit);

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(sent(requests, `POST ${base}/known-issues`)).toEqual([
      {
        serviceId: paymentApi.id,
        name: "Refunds stuck",
        description: "",
        usualSeverity: "SEV3",
      },
    ]);
  });

  it("says when a name is taken on that service", async () => {
    const user = userEvent.setup();

    api(ADMIN, undefined, (request) =>
      route(request) === `PATCH ${base}/known-issues/${webhooks.id}`
        ? apiError(409, "KNOWN_ISSUE_NAME_TAKEN")
        : undefined,
    );
    render();

    await user.click(await screen.findByRole("button", { name: `Edit ${webhooks.name}` }));

    const dialog = await screen.findByRole("dialog", { name: "Edit known issue" });
    const name = within(dialog).getByLabelText(/^Name/);

    await user.clear(name);
    await user.type(name, "Card payments failing at checkout");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));

    expect(
      await within(dialog).findByText("This service already has a known issue with this name."),
    ).toBeDefined();
  });

  it("archives one, and shows archived ones only when asked, to restore", async () => {
    const user = userEvent.setup();
    const { requests } = api(ADMIN, undefined, (request) =>
      route(request).startsWith(`PATCH ${base}/known-issues/`)
        ? jsonResponse(200, webhooks)
        : undefined,
    );

    render();

    await user.click(await screen.findByRole("button", { name: `Archive ${webhooks.name}` }));
    await user.click(screen.getByRole("checkbox", { name: "Show archived" }));
    await user.click(await screen.findByRole("button", { name: `Restore ${retired.name}` }));

    await waitFor(() =>
      expect(
        requests
          .filter((request) => route(request).startsWith(`PATCH ${base}/known-issues/`))
          .map(({ path, body }) => [path.split("/").at(-1), body]),
      ).toEqual([
        [webhooks.id, { archived: true }],
        [retired.id, { archived: false }],
      ]),
    );
  });

  it("finds by name, and narrows to one service", async () => {
    const user = userEvent.setup();

    api(ADMIN);
    render();

    await groupOf("Payment API");
    await user.type(screen.getByLabelText("Find a known issue"), "webhook");

    expect(screen.getByText("Webhook retries backing up")).toBeDefined();
    expect(screen.queryByText("Card payments failing at checkout")).toBeNull();

    await user.clear(screen.getByLabelText("Find a known issue"));
    await user.selectOptions(screen.getByLabelText("Service"), portal.id);

    expect(screen.queryByRole("region", { name: /^Payment API/ })).toBeNull();
    expect(screen.getByText("Portal slow to load")).toBeDefined();
  });

  it("tells anyone but the Admin that the Admin keeps it, asking nothing", async () => {
    const { requests } = api(MEMBER);

    render();

    expect(await screen.findByText("The Admin keeps this list")).toBeDefined();
    expect(requests.some((request) => request.path.includes("/known-issues"))).toBe(false);
  });
});

describe("likely duplicates", () => {
  it("compares shared words, ignoring case, short words and plurals", () => {
    expect(overlap("Card payment failures for EU customers", "Card payments failing at checkout")).toBe(
      0.5,
    );
    expect(overlap("Webhook retries backing up", "Card payments failing")).toBe(0);
  });

  it("offers only a reviewed one of the same service, in use", () => {
    expect(likelyDuplicateOf(euCards, [checkout, euCards, webhooks, slowPortal])?.id).toBe(
      checkout.id,
    );
    expect(
      likelyDuplicateOf(euCards, [{ ...checkout, archivedAt: "2026-01-01T00:00:00.000Z" }]),
    ).toBeUndefined();
    expect(likelyDuplicateOf(euCards, [{ ...checkout, service: portal }])).toBeUndefined();
  });
});
