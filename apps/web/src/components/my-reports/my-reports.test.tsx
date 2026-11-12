import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  api,
  base,
  inOrganization,
  resolvedIncident,
} from "@/components/incident-analyses/analysis.fixtures";
import { IncidentDetail } from "@/components/incidents/incident-detail";
import { OrganizationLanding } from "@/components/organizations/organization-landing";
import { navItemLabel, ORGANIZATION_NAVIGATION } from "@/components/app/navigation";
import type { IncidentListItemResponse } from "@/lib/api/contracts";
import { clearAccessToken } from "@/lib/auth/token-store";
import { jsonResponse, route } from "@/test/api";

vi.mock("next/navigation", () => ({
  useParams: () => ({ orgSlug: "acme-ops", incidentNumber: "42" }),
  usePathname: () => "/orgs/acme-ops",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));

/** A Reporter: declares, and reads what they declared. */
const REPORTER = [
  "incidents:declare",
  "incidents:read",
  "incidents:respond",
  "memberships:read",
  "organization:read",
  "services:read",
  "teams:read",
];

const item = (
  overrides: Partial<IncidentListItemResponse> = {},
): IncidentListItemResponse => ({
  ...resolvedIncident(),
  status: "DECLARED",
  resolvedAt: null,
  response: { investigating: 0, completed: 0 },
  lastUpdateAt: null,
  yourResponse: null,
  ...overrides,
});

const page = (items: IncidentListItemResponse[]) => ({
  items,
  page: { cursor: null },
});

const asReporter = (active: IncidentListItemResponse[], resolved: IncidentListItemResponse[] = []) =>
  api(REPORTER, {
    handler: (request) => {
      const path = route(request);

      if (path.startsWith(`GET ${base}/incidents?state=active`)) {
        return jsonResponse(200, page(active));
      }
      if (path.startsWith(`GET ${base}/incidents?state=resolved`)) {
        return jsonResponse(200, page(resolved));
      }

      return undefined;
    },
  });

describe("a Reporter's home", () => {
  beforeEach(() => {
    clearAccessToken();
  });

  it("lands a Reporter on what they declared, and where each stands", async () => {
    asReporter([
      item({
        id: "0199a1b2-c3d4-7000-8000-0000000000f2",
        number: 51,
        title: "Checkout slow",
        severity: "SEV3",
        severityConfirmed: false,
        responseAccess: "PENDING",
      }),
      item({
        id: "0199a1b2-c3d4-7000-8000-0000000000f3",
        number: 52,
        title: "Refunds stuck",
        responseAccess: "OPEN",
        response: { investigating: 2, completed: 0 },
      }),
      // On a team they are on, but someone else's: not a report of theirs.
      item({
        id: "0199a1b2-c3d4-7000-8000-0000000000f4",
        number: 53,
        title: "Someone else's",
        createdBy: { id: "someone-else", name: "Sam Okafor" },
      }),
    ]);

    inOrganization(<OrganizationLanding />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "My reports" }),
    ).toBeDefined();

    const waiting = (await screen.findByText("Checkout slow")).closest("a")!;
    expect(within(waiting).getByText("Waiting for a decision")).toBeDefined();
    expect(
      within(waiting).getByText("Your suggested SEV3 is waiting to be confirmed"),
    ).toBeDefined();
    expect(within(waiting).getByText("Suggested")).toBeDefined();
    expect(waiting.getAttribute("href")).toBe("/orgs/acme-ops/incidents/51");

    const worked = screen.getByText("Refunds stuck").closest("a")!;
    expect(within(worked).getByText("Being worked on")).toBeDefined();
    expect(within(worked).getByText("Open to Payments · 2 investigating")).toBeDefined();

    expect(screen.queryByText("Someone else's")).toBeNull();
    // Declaring stays on the Incidents page; this page only points there.
    expect(screen.queryByRole("button", { name: "Declare incident" })).toBeNull();
    expect(
      screen.getByRole("link", { name: "Incidents" }).getAttribute("href"),
    ).toBe("/orgs/acme-ops/incidents");
  });

  it("says so when nothing they declared is active", async () => {
    asReporter([]);

    inOrganization(<OrganizationLanding />);

    expect(
      await screen.findByText("Nothing you declared is active"),
    ).toBeDefined();
  });
});

describe("the home item's name", () => {
  const home = ORGANIZATION_NAVIGATION[0].items[0];

  it.each([
    [["incidents:read-all", "responses:work"], "Overview"],
    [["responses:work"], "My Operations"],
    [["incidents:declare"], "My reports"],
  ])("names it for %j as %s", (permissions, name) => {
    expect(navItemLabel(home, permissions)).toBe(name);
  });
});

describe("roles on the timeline", () => {
  beforeEach(() => {
    clearAccessToken();
  });

  it("says each actor's role beside their name", async () => {
    api(REPORTER, {
      detail: resolvedIncident({ status: "DECLARED", resolvedAt: null }),
      handler: (request) =>
        route(request) === `GET ${base}/incidents/42/timeline`
          ? jsonResponse(200, [
              {
                id: "0199a1b2-c3d4-7000-8000-000000000201",
                type: "DECLARED",
                message: null,
                fromValue: null,
                toValue: "SEV2",
                actor: { id: "rita", name: "Rita Moreno", role: "REPORTER" },
                createdAt: "2026-09-18T12:00:00.000Z",
              },
              {
                id: "0199a1b2-c3d4-7000-8000-000000000202",
                type: "SEVERITY_CONFIRMED",
                message: null,
                fromValue: "SEV2",
                toValue: "SEV2",
                actor: { id: "ava", name: "Ava Kim", role: "INCIDENT_MANAGER" },
                createdAt: "2026-09-18T12:02:00.000Z",
              },
            ])
          : undefined,
    });

    inOrganization(<IncidentDetail />);

    expect(await screen.findByText("Reporter")).toBeDefined();
    expect(screen.getByText("Incident Manager")).toBeDefined();
    expect(screen.getByText(/confirmed the suggested severity/)).toBeDefined();
  });
});
