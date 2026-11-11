import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ADMIN,
  READ_ONLY,
  api,
  base,
  inOrganization,
  resolvedIncident,
} from "@/components/incident-analyses/analysis.fixtures";
import { IncidentDetail } from "@/components/incidents/incident-detail";
import type {
  IncidentDetailResponse,
  IncidentRepeatsResponse,
  KnownIssueResponse,
} from "@/lib/api/contracts";
import { clearAccessToken } from "@/lib/auth/token-store";
import { jsonResponse, route } from "@/test/api";
import type { SentRequest } from "@/test/api";
import { expectNoAxeViolations } from "@/test/axe";

vi.mock("next/navigation", () => ({
  useParams: () => ({ orgSlug: "acme-ops", incidentNumber: "42" }),
  usePathname: () => "/orgs/acme-ops/incidents/42",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

const checkout = {
  id: "0199a1b2-c3d4-7000-8000-0000000000b1",
  name: "Card payments failing at checkout",
};
const webhooks = {
  id: "0199a1b2-c3d4-7000-8000-0000000000b2",
  name: "Webhook retries backing up",
};

/** INC-42, declared Sep 18, is the known issue's latest but one. */
const repeats: IncidentRepeatsResponse = {
  knownIssue: { ...checkout, usualSeverity: "SEV1" },
  others: [
    {
      number: 50,
      title: "Card payments failing again",
      severity: "SEV2",
      status: "INVESTIGATING",
      createdAt: "2026-10-02T09:00:00.000Z",
      resolvedAt: null,
      analysisPublished: false,
    },
    {
      number: 30,
      title: "Card payments failing at checkout",
      severity: "SEV1",
      status: "RESOLVED",
      createdAt: "2026-08-01T10:00:00.000Z",
      resolvedAt: "2026-08-01T12:00:00.000Z",
      analysisPublished: true,
    },
    {
      number: 12,
      title: "Checkout cards declined",
      severity: "SEV1",
      status: "RESOLVED",
      createdAt: "2026-05-01T10:00:00.000Z",
      resolvedAt: "2026-05-01T11:00:00.000Z",
      analysisPublished: false,
    },
  ],
  hidden: 2,
};

const knownIssueOf = (issue: typeof checkout): KnownIssueResponse => ({
  ...issue,
  description: null,
  usualSeverity: "SEV1",
  service: {
    id: "0199a1b2-c3d4-7000-8000-0000000000e1",
    name: "Payment API",
    slug: "payment-api",
    team: { id: "0199a1b2-c3d4-7000-8000-0000000000c1", name: "Payments", slug: "payments" },
  },
  pendingReview: false,
  archivedAt: null,
  occurrences: { total: 1, lastAt: null, active: null },
  createdAt: "2026-01-01T00:00:00.000Z",
});

const linked = (overrides: Partial<IncidentDetailResponse> = {}) =>
  resolvedIncident({ knownIssue: checkout, ...overrides });

const withRepeats =
  (answer: IncidentRepeatsResponse, extra: (request: SentRequest) => Response | undefined = () => undefined) =>
  (request: SentRequest) =>
    route(request) === `GET ${base}/incidents/42/repeats`
      ? jsonResponse(200, answer)
      : route(request).startsWith(`GET ${base}/known-issues?`)
        ? jsonResponse(200, [knownIssueOf(checkout), knownIssueOf(webhooks)])
        : extra(request);

describe("an incident's known issue", () => {
  beforeEach(() => {
    clearAccessToken();
  });

  it("says how often it has happened, and lists the earlier times with what to learn from", async () => {
    api(READ_ONLY, { detail: linked(), handler: withRepeats(repeats) });
    inOrganization(<IncidentDetail />);

    const section = await screen.findByRole("region", { name: "Happened before" });

    expect(
      within(section).getByText(
        "Known issue: Card payments failing at checkout · 2 earlier times on Payment API",
      ),
    ).toBeDefined();

    // Six in all: this one, three others seen, two on other teams.
    expect(
      screen.getByRole("link", { name: "Known issue · happened 6 times" }).getAttribute("href"),
    ).toBe("#happened-before");

    const figures = within(section).getByLabelText("The earlier times at a glance");

    expect(within(figures).getByText("Usually lasts").nextElementSibling?.textContent).toBe(
      "1h 30m",
    );
    expect(within(figures).getByText("Severity before").nextElementSibling?.textContent).toBe(
      "SEV1 2 times",
    );
    expect(
      within(figures).getByText("Analyses published").nextElementSibling?.textContent,
    ).toBe("1 of 2");

    const rows = within(within(section).getByRole("table", { name: "Earlier times" })).getAllByRole(
      "row",
    );

    // Earlier ones only, newest first; the later one is said, not listed.
    expect(rows.slice(1).map((row) => row.textContent)).toEqual([
      expect.stringContaining("INC-30"),
      expect.stringContaining("INC-12"),
    ]);
    expect(within(rows[1]).getByRole("link", { name: "Read the analysis" }).getAttribute("href")).toBe(
      "/orgs/acme-ops/incidents/30/analysis",
    );
    expect(
      within(section).getByText(
        "It has happened once since. 2 more are on teams you are not on.",
      ),
    ).toBeDefined();
    await expectNoAxeViolations(section);
  });

  it("says when it is the first time on record", async () => {
    api(READ_ONLY, {
      detail: linked(),
      handler: withRepeats({ ...repeats, others: [], hidden: 0 }),
    });
    inOrganization(<IncidentDetail />);

    const section = await screen.findByRole("region", { name: "Happened before" });

    expect(section.textContent).toContain("this is the first time on record");
    expect(screen.getByRole("link", { name: "Known issue · first time" })).toBeDefined();
    expect(within(section).queryByRole("table")).toBeNull();
  });

  it("shows nothing of the sort for a one-off, and asks nothing", async () => {
    const { requests } = api(READ_ONLY, { detail: resolvedIncident() });

    inOrganization(<IncidentDetail />);

    await screen.findByRole("heading", { level: 1, name: /Card payments failing/ });

    expect(screen.queryByRole("region", { name: "Happened before" })).toBeNull();
    expect(requests.some((request) => request.path.endsWith("/repeats"))).toBe(false);
  });

  it("lets the Admin correct which known issue an active incident is, or make it a one-off", async () => {
    const user = userEvent.setup();
    const active = linked({ status: "INVESTIGATING", resolvedAt: null, resolution: null });
    const { requests } = api(ADMIN, {
      detail: active,
      handler: withRepeats(repeats, (request) =>
        route(request) === `PATCH ${base}/incidents/42`
          ? jsonResponse(200, { ...active, knownIssue: webhooks })
          : undefined,
      ),
    });

    inOrganization(<IncidentDetail />);

    await user.click(await screen.findByRole("button", { name: "Manage incident" }));

    const manage = await screen.findByRole("dialog", { name: "Manage incident" });
    const select = (await within(manage).findByRole("combobox", {
      name: "Known issue",
    })) as HTMLSelectElement;

    expect(select.value).toBe(checkout.id);
    expect(within(select).getByRole("option", { name: "None: a one-off" })).toBeDefined();

    await user.selectOptions(select, webhooks.id);
    await user.click(
      within(within(manage).getByRole("region", { name: "Known issue" })).getByRole("button", {
        name: "Save",
      }),
    );

    await waitFor(() =>
      expect(
        requests.filter((r) => route(r) === `PATCH ${base}/incidents/42`).map(({ body }) => body),
      ).toEqual([{ knownIssueId: webhooks.id }]),
    );
  });
});
