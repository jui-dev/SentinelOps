/**
 * Shared fixtures for the incident analysis tests: who is signed in, the
 * people they choose between, a resolved incident, its analysis as a draft
 * and published, and the API those tests talk to. Each test file still mocks
 * `next/navigation` itself: vi.mock is hoisted per file.
 */

import { OrganizationScope } from "@/components/organizations/organization-scope";
import type {
  IncidentAnalysisResponse,
  IncidentDetailResponse,
} from "@/lib/api/contracts";
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

export const ADMIN = [
  "incident-analyses:write",
  "incidents:manage",
  "incidents:read",
  "incidents:respond",
  "memberships:read",
  "organization:read",
  "teams:read",
];
export const MEMBER = [
  "incident-analyses:write",
  "incidents:read",
  "incidents:respond",
  "memberships:read",
  "organization:read",
  "teams:read",
];
export const READ_ONLY = ["incidents:read", "memberships:read", "organization:read"];

export const base = `/organizations/${organization.id}`;
export const analysisPath = `${base}/incidents/42/analysis`;
export const analysisHref = "/orgs/acme-ops/incidents/42/analysis";

/** The caller, Daniel who responded, and Sam who did not. */
export const ada = {
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
export const daniel = {
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
export const sam = {
  ...daniel,
  id: "0199a1b2-c3d4-7000-8000-0000000000ac",
  user: {
    ...daniel.user,
    id: "0199a1b2-c3d4-7000-8000-000000000003",
    name: "Sam Okafor",
    email: "sam@example.test",
  },
};

export const team = { id: "0199a1b2-c3d4-7000-8000-0000000000c1", name: "Payments", slug: "payments" };

export const resolvedIncident = (
  overrides: Partial<IncidentDetailResponse> = {},
): IncidentDetailResponse => ({
  id: "0199a1b2-c3d4-7000-8000-0000000000f1",
  number: 42,
  title: "Card payments failing",
  responseAccess: "OPEN",
  assignees: [],
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

export const draft = (
  overrides: Partial<IncidentAnalysisResponse> = {},
): IncidentAnalysisResponse => ({
  status: "DRAFT",
  version: 3,
  owner: { membershipId: daniel.id, name: "Daniel Okafor" },
  summary: "Card payments failed after a deploy.",
  impact: "Checkout unavailable for an hour.",
  cause: null,
  lessons: null,
  doneSections: [],
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

export const published = () =>
  draft({
    status: "PUBLISHED",
    version: 4,
    publishedBy: { id: currentUser.id, name: "Ada Lovelace" },
    publishedAt: "2026-09-22T14:10:00.000Z",
  });

export type Handler = (request: SentRequest) => Response | undefined;

export const api = (
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

export const inOrganization = (ui: React.ReactNode) =>
  renderWithSession(<OrganizationScope>{ui}</OrganizationScope>);

/** Signed in as someone other than the analysis's owner, Daniel. */
export const asMember = (membershipId: string) => {
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
