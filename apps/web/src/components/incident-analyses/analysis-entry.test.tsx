import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IncidentDetail } from "@/components/incidents/incident-detail";
import { OrganizationScope } from "@/components/organizations/organization-scope";
import type {
  IncidentAnalysisResponse,
  IncidentDetailResponse,
} from "@/lib/api/contracts";
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

import { IncidentAnalysisPage } from "./incident-analysis-page";

const navigation = vi.hoisted(() => ({
  params: { orgSlug: "acme-ops", incidentNumber: "42" } as {
    orgSlug: string;
    incidentNumber: string;
  },
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useParams: () => navigation.params,
  usePathname: () => "/orgs/acme-ops/incidents/42",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: navigation.push }),
}));

const ADMIN = [
  "incident-analyses:write",
  "incidents:manage",
  "incidents:read",
  "incidents:respond",
  "memberships:read",
  "organization:read",
  "teams:read",
];
const MEMBER = [
  "incident-analyses:write",
  "incidents:read",
  "incidents:respond",
  "memberships:read",
  "organization:read",
  "teams:read",
];
const READ_ONLY = ["incidents:read", "memberships:read", "organization:read"];

const base = `/organizations/${organization.id}`;
const analysisPath = `${base}/incidents/42/analysis`;
const analysisHref = "/orgs/acme-ops/incidents/42/analysis";

/** The caller, Daniel who responded, and Sam who did not. */
const ada = {
  id: currentUser.memberships[0].id,
  role: "ADMIN",
  createdAt: "2026-09-01T12:00:00.000Z",
  teams: [],
  user: {
    id: currentUser.id,
    name: "Ada Lovelace",
    email: currentUser.email,
    passwordChangeRequired: false,
  },
};
const daniel = {
  ...ada,
  id: "0199a1b2-c3d4-7000-8000-0000000000ab",
  role: "MEMBER",
  user: {
    ...ada.user,
    id: "0199a1b2-c3d4-7000-8000-000000000002",
    name: "Daniel Okafor",
    email: "daniel@example.test",
  },
};
const sam = {
  ...daniel,
  id: "0199a1b2-c3d4-7000-8000-0000000000ac",
  user: {
    ...daniel.user,
    id: "0199a1b2-c3d4-7000-8000-000000000003",
    name: "Sam Okafor",
    email: "sam@example.test",
  },
};

const team = { id: "0199a1b2-c3d4-7000-8000-0000000000c1", name: "Payments", slug: "payments" };

const resolvedIncident = (
  overrides: Partial<IncidentDetailResponse> = {},
): IncidentDetailResponse => ({
  id: "0199a1b2-c3d4-7000-8000-0000000000f1",
  number: 42,
  title: "Card payments failing",
  summary: null,
  resolution: "Rolled back the 12:00 deploy.",
  severity: "SEV1",
  status: "RESOLVED",
  service: {
    id: "0199a1b2-c3d4-7000-8000-0000000000e1",
    name: "Payment API",
    slug: "payment-api",
    criticality: "CRITICAL",
    archivedAt: null,
  },
  team,
  createdBy: { id: currentUser.id, name: "Ada Lovelace" },
  createdAt: "2026-09-18T12:00:00.000Z",
  updatedAt: "2026-09-18T13:00:00.000Z",
  resolvedAt: "2026-09-18T13:00:00.000Z",
  responders: [
    {
      membershipId: daniel.id,
      name: "Daniel Okafor",
      status: "COMPLETED",
      startedAt: "2026-09-18T12:05:00.000Z",
      completedAt: "2026-09-18T12:40:00.000Z",
    },
  ],
  ...overrides,
});

const draft = (
  overrides: Partial<IncidentAnalysisResponse> = {},
): IncidentAnalysisResponse => ({
  status: "DRAFT",
  version: 3,
  owner: { membershipId: daniel.id, name: "Daniel Okafor" },
  summary: "Card payments failed after a deploy.",
  impact: "Checkout unavailable for an hour.",
  cause: null,
  lessons: null,
  createdBy: { id: currentUser.id, name: "Ada Lovelace" },
  createdAt: "2026-09-19T09:00:00.000Z",
  publishedBy: null,
  publishedAt: null,
  updatedAt: "2026-09-19T10:00:00.000Z",
  facts: {
    declaredAt: "2026-09-18T12:00:00.000Z",
    resolvedAt: "2026-09-18T13:00:00.000Z",
    firstResponseAt: "2026-09-18T12:05:00.000Z",
    responderCount: 1,
    updateCount: 0,
    severity: { declared: "SEV1", highest: "SEV1", final: "SEV1" },
    reassignmentCount: 0,
  },
  keyMoments: [],
  ...overrides,
});

const published = () =>
  draft({
    status: "PUBLISHED",
    version: 4,
    publishedBy: { id: currentUser.id, name: "Ada Lovelace" },
    publishedAt: "2026-09-22T14:10:00.000Z",
  });

type Handler = (request: SentRequest) => Response | undefined;

const api = (
  permissions: string[],
  {
    detail = resolvedIncident(),
    analysis = null as IncidentAnalysisResponse | null,
    handler = (() => undefined) as Handler,
  } = {},
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
        return jsonResponse(
          200,
          organizationDetail(permissions, permissions === ADMIN ? "ADMIN" : "MEMBER"),
        );
      case `GET ${base}/incidents/42`:
        return jsonResponse(200, detail);
      case `GET ${base}/incidents/42/timeline`:
        return jsonResponse(200, []);
      case `GET ${analysisPath}`:
        return analysis
          ? jsonResponse(200, analysis)
          : apiError(404, "ANALYSIS_NOT_STARTED");
      case `GET ${base}/teams/${team.id}/members`:
        return jsonResponse(200, []);
      case `GET ${base}/memberships`:
        return jsonResponse(200, [ada, daniel, sam]);
      default:
        return apiError(404, "NOT_FOUND");
    }
  });

const inOrganization = (ui: React.ReactNode) =>
  renderWithSession(<OrganizationScope>{ui}</OrganizationScope>);

/** The entry panel, once it has said something. */
const entry = async () =>
  (await screen.findByRole("heading", { name: "Incident analysis" })).closest(
    "section",
  ) as HTMLElement;

/** Signed in as someone other than the analysis's owner, Daniel. */
const asMember = (membershipId: string) => {
  const permissions = [...MEMBER];

  return {
    permissions,
    handler: ((request: SentRequest) =>
      route(request) === `GET ${base}`
        ? jsonResponse(200, {
            ...organizationDetail(permissions, "MEMBER"),
            membership: { id: membershipId, role: "MEMBER", permissions },
          })
        : undefined) as Handler,
  };
};

describe("incident analysis", () => {
  beforeEach(() => {
    clearAccessToken();
    navigation.params = { orgSlug: "acme-ops", incidentNumber: "42" };
    navigation.push.mockReset();
  });

  describe("on the incident", () => {
    it("is not asked about while the incident is active", async () => {
      const { requests } = api(ADMIN, {
        detail: resolvedIncident({
          status: "INVESTIGATING",
          resolvedAt: null,
          resolution: null,
        }),
      });

      inOrganization(<IncidentDetail />);

      await screen.findByRole("heading", { name: /Timeline/ });
      expect(screen.queryByRole("heading", { name: "Incident analysis" })).toBeNull();
      expect(requests.some((r) => r.path === analysisPath)).toBe(false);
    });

    it("sits beneath the resolution", async () => {
      api(READ_ONLY);

      inOrganization(<IncidentDetail />);

      const panel = await entry();
      const resolution = (
        await screen.findByRole("heading", { name: "Resolution" })
      ).closest("section") as HTMLElement;

      expect(resolution.nextElementSibling).toBe(panel);
    });

    it("offers the admin a start when none has been started", async () => {
      api(ADMIN);

      inOrganization(<IncidentDetail />);

      const panel = await entry();

      expect(await within(panel).findByText(/^Not started\./)).toBeDefined();
      expect(within(panel).getByRole("button", { name: "Start analysis" })).toBeDefined();
    });

    it.each([
      ["a member", MEMBER],
      ["a reader", READ_ONLY],
    ])("tells %s none has been started, with nothing to do", async (_, permissions) => {
      api(permissions);

      inOrganization(<IncidentDetail />);

      const panel = await entry();

      expect(
        await within(panel).findByText("No analysis has been started for this incident."),
      ).toBeDefined();
      expect(within(panel).queryByRole("button")).toBeNull();
      expect(within(panel).queryByRole("link")).toBeNull();
    });

    it("shows a draft's owner and progress, and lets its owner open it", async () => {
      const { permissions, handler } = asMember(daniel.id);

      api(permissions, { analysis: draft(), handler });

      inOrganization(<IncidentDetail />);

      const panel = await entry();
      const link = await within(panel).findByRole("link", { name: "Open draft" });

      expect(link.getAttribute("href")).toBe(analysisHref);
      expect(within(panel).getByText("Draft")).toBeDefined();
      expect(panel.textContent).toContain("Owned by Daniel Okafor (you)");
      expect(panel.textContent).toContain("2 of 4 sections written");
    });

    it("lets the admin open a draft someone else owns", async () => {
      api(ADMIN, { analysis: draft() });

      inOrganization(<IncidentDetail />);

      const panel = await entry();

      expect(await within(panel).findByRole("link", { name: "Open draft" })).toBeDefined();
      expect(panel.textContent).not.toContain("(you)");
    });

    it("lets a member who does not own a draft read it", async () => {
      const { permissions, handler } = asMember(sam.id);

      api(permissions, { analysis: draft(), handler });

      inOrganization(<IncidentDetail />);

      const panel = await entry();
      const link = await within(panel).findByRole("link", { name: "Read draft" });

      expect(link.getAttribute("href")).toBe(analysisHref);
      expect(within(panel).queryByRole("button")).toBeNull();
    });

    it("leads a published analysis with its publication, then its summary and owner", async () => {
      api(READ_ONLY, { analysis: published() });

      inOrganization(<IncidentDetail />);

      const panel = await entry();
      const link = await within(panel).findByRole("link", { name: "Read analysis" });

      expect(link.getAttribute("href")).toBe(analysisHref);
      expect(within(panel).getByText("Published")).toBeDefined();

      const lines = [...panel.querySelectorAll("p")].map((p) => p.textContent);

      // "{date} · by {name}": the status mark above already says "Published".
      const [publication] = panel.querySelectorAll("p");

      expect(
        publication.querySelector("time")?.getAttribute("dateTime"),
      ).toBe("2026-09-22T14:10:00.000Z");
      expect(lines[0]).not.toMatch(/Published/);
      expect(lines[0]).toMatch(/ · , by Ada Lovelace$/);
      expect(lines).toEqual([
        lines[0],
        "Card payments failed after a deploy.",
        "Owner Daniel Okafor",
      ]);
    });

    it("keeps an analysis that cannot be loaded to itself", async () => {
      api(ADMIN, {
        handler: (request) =>
          request.path === analysisPath
            ? apiError(403, "PERMISSION_DENIED")
            : undefined,
      });

      inOrganization(<IncidentDetail />);

      const panel = await entry();

      expect(await within(panel).findByRole("alert")).toBeDefined();
      expect(within(panel).queryByRole("button", { name: "Start analysis" })).toBeNull();
      expect(screen.getByRole("heading", { name: /Timeline/ })).toBeDefined();
    });
  });

  describe("starting one", () => {
    const openStart = async (user: ReturnType<typeof userEvent.setup>) => {
      await user.click(await screen.findByRole("button", { name: "Start analysis" }));

      const dialog = await screen.findByRole("dialog", { name: "Start analysis" });

      return {
        dialog,
        owner: (await within(dialog).findByLabelText("Owner")) as HTMLSelectElement,
      };
    };

    it("offers the caller first, with those who responded grouped ahead of everyone else", async () => {
      const user = userEvent.setup();

      api(ADMIN);
      inOrganization(<IncidentDetail />);

      const { owner } = await openStart(user);

      expect(owner.value).toBe(ada.id);

      const [responded, everyone] = within(owner).getAllByRole("group");

      expect(responded.getAttribute("label")).toBe("Responded to INC-42");
      expect(
        within(responded).getAllByRole("option").map((o) => o.textContent),
      ).toEqual(["Daniel Okafor (daniel@example.test)"]);
      expect(everyone.getAttribute("label")).toBe("Everyone else");
      expect(
        within(everyone).getAllByRole("option").map((o) => o.textContent),
      ).toEqual(["Ada Lovelace (you)", "Sam Okafor (sam@example.test)"]);
    });

    it("sends nothing when the caller keeps it, and opens the analysis once started", async () => {
      const user = userEvent.setup();
      const { requests } = api(ADMIN, {
        handler: (request) =>
          route(request) === `POST ${analysisPath}`
            ? jsonResponse(201, draft({ owner: { membershipId: ada.id, name: "Ada Lovelace" } }))
            : undefined,
      });

      inOrganization(<IncidentDetail />);

      const { dialog } = await openStart(user);

      await user.click(within(dialog).getByRole("button", { name: "Start analysis" }));

      await waitFor(() => expect(navigation.push).toHaveBeenCalledWith(analysisHref));

      const post = requests.find((r) => route(r) === `POST ${analysisPath}`)!;

      expect(post.body).toBeUndefined();
    });

    it("names the owner chosen", async () => {
      const user = userEvent.setup();
      const { requests } = api(ADMIN, {
        handler: (request) =>
          route(request) === `POST ${analysisPath}`
            ? jsonResponse(201, draft())
            : undefined,
      });

      inOrganization(<IncidentDetail />);

      const { dialog, owner } = await openStart(user);

      await user.selectOptions(owner, daniel.id);
      await user.click(within(dialog).getByRole("button", { name: "Start analysis" }));

      await waitFor(() => expect(navigation.push).toHaveBeenCalled());
      expect(
        requests.find((r) => route(r) === `POST ${analysisPath}`)!.body,
      ).toEqual({ ownerMembershipId: daniel.id });
    });

    it("explains that someone else started it first, and shows theirs", async () => {
      const user = userEvent.setup();
      let started = false;

      api(ADMIN, {
        handler: (request) => {
          if (route(request) === `POST ${analysisPath}`) {
            started = true;
            return apiError(409, "ANALYSIS_ALREADY_STARTED");
          }
          if (route(request) === `GET ${analysisPath}` && started) {
            return jsonResponse(200, draft());
          }
          return undefined;
        },
      });

      inOrganization(<IncidentDetail />);

      const { dialog } = await openStart(user);

      await user.click(within(dialog).getByRole("button", { name: "Start analysis" }));

      expect(
        await within(dialog).findByText(/Someone else started this analysis a moment ago/),
      ).toBeDefined();
      await user.click(within(dialog).getByRole("button", { name: "Done" }));

      const panel = await entry();

      expect(await within(panel).findByRole("link", { name: "Open draft" })).toBeDefined();
      expect(navigation.push).not.toHaveBeenCalled();
    });

    it("says when the owner chosen is no longer a member", async () => {
      const user = userEvent.setup();

      api(ADMIN, {
        handler: (request) =>
          route(request) === `POST ${analysisPath}`
            ? apiError(404, "MEMBERSHIP_NOT_FOUND")
            : undefined,
      });

      inOrganization(<IncidentDetail />);

      const { dialog, owner } = await openStart(user);

      await user.selectOptions(owner, sam.id);
      await user.click(within(dialog).getByRole("button", { name: "Start analysis" }));

      expect(
        await within(dialog).findByText(/no longer a member of this organization/),
      ).toBeDefined();
      expect(owner.getAttribute("aria-invalid")).toBe("true");
    });
  });

  describe("its page", () => {
    it("leads back to its incident", async () => {
      api(READ_ONLY, { analysis: draft() });

      inOrganization(<IncidentAnalysisPage />);

      expect(
        await screen.findByRole("heading", { level: 1, name: "Incident analysis" }),
      ).toBeDefined();
      expect(
        screen.getByRole("link", { name: /INC-42.*Card payments failing/ }).getAttribute("href"),
      ).toBe("/orgs/acme-ops/incidents/42");
    });

    it("shows a draft's status and record", async () => {
      api(READ_ONLY, { analysis: draft() });

      inOrganization(<IncidentAnalysisPage />);

      expect(await screen.findByText("Draft")).toBeDefined();

      const labels = screen.getAllByRole("term").map((term) => term.textContent);

      expect(labels).toEqual(["Owner", "Started", "Sections"]);
      expect(screen.getByText("Daniel Okafor")).toBeDefined();
      expect(screen.getByText("by Ada Lovelace")).toBeDefined();
      expect(screen.getByText("2 of 4 sections written")).toBeDefined();
    });

    it("leads a published analysis's record with its publication", async () => {
      api(READ_ONLY, { analysis: published() });

      inOrganization(<IncidentAnalysisPage />);

      expect(await screen.findByText("Published", { selector: "span" })).toBeDefined();
      expect(screen.getAllByRole("term").map((term) => term.textContent)).toEqual([
        "Published",
        "Owner",
        "Started",
        "Sections",
      ]);
    });

    it("offers the admin a start when there is none", async () => {
      api(ADMIN);

      inOrganization(<IncidentAnalysisPage />);

      expect(await screen.findByText("No analysis yet")).toBeDefined();
      expect(screen.getByRole("button", { name: "Start analysis" })).toBeDefined();
    });

    it("offers a member nothing to start", async () => {
      api(MEMBER);

      inOrganization(<IncidentAnalysisPage />);

      expect(await screen.findByText("No analysis yet")).toBeDefined();
      expect(screen.queryByRole("button", { name: "Start analysis" })).toBeNull();
    });

    it("explains that an active incident has no analysis yet, without asking for one", async () => {
      const { requests } = api(ADMIN, {
        detail: resolvedIncident({
          status: "INVESTIGATING",
          resolvedAt: null,
          resolution: null,
        }),
      });

      inOrganization(<IncidentAnalysisPage />);

      expect(
        await screen.findByText(/An analysis begins once INC-42 is resolved/),
      ).toBeDefined();
      expect(screen.getByRole("link", { name: "Go to INC-42" }).getAttribute("href")).toBe(
        "/orgs/acme-ops/incidents/42",
      );
      expect(requests.some((r) => r.path === analysisPath)).toBe(false);
    });

    it("answers an incident that is not there with a not-found page", async () => {
      api(ADMIN, {
        handler: (request) =>
          route(request) === `GET ${base}/incidents/42`
            ? apiError(404, "INCIDENT_NOT_FOUND")
            : undefined,
      });

      inOrganization(<IncidentAnalysisPage />);

      expect(
        await screen.findByRole("heading", { level: 1, name: "Incident not found" }),
      ).toBeDefined();
    });

    it("answers a number that cannot be one without asking the API", async () => {
      navigation.params = { orgSlug: "acme-ops", incidentNumber: "abc" };
      const { requests } = api(ADMIN);

      inOrganization(<IncidentAnalysisPage />);

      expect(
        await screen.findByRole("heading", { level: 1, name: "Incident not found" }),
      ).toBeDefined();
      expect(requests.some((r) => r.path.includes("/incidents/"))).toBe(false);
    });
  });
});
