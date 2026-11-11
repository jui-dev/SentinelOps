import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Permission } from "@/lib/api/contracts";
import type { IncidentAnalysisResponse } from "@/lib/api/contracts";
import { NetworkError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";
import { clearAccessToken, setAccessToken } from "@/lib/auth/token-store";
import { createQueryClient } from "@/lib/query/query-client";
import {
  apiError,
  jsonResponse,
  mockApi,
  organization,
  route,
} from "@/test/api";

import {
  analysisAccess,
  analysisRefusalOf,
  laterAnalysis,
  useEditIncidentAnalysis,
  useIncidentAnalysis,
  usePublishIncidentAnalysis,
  useReassignIncidentAnalysisOwner,
  useStartIncidentAnalysis,
} from "./analysis-queries";

const ORG = organization.id;
const NUMBER = 42;
const path = `/organizations/${ORG}/incidents/${NUMBER}/analysis`;

const idOf = (n: number) =>
  `0199a1b2-c3d4-7000-8000-${String(n).padStart(12, "0")}`;

const OWNER = idOf(100);
const OTHER = idOf(200);

const analysis = (
  overrides: Partial<IncidentAnalysisResponse> = {},
): IncidentAnalysisResponse => ({
  status: "DRAFT",
  version: 1,
  owner: { membershipId: OWNER, name: "Priya Shah" },
  summary: null,
  impact: null,
  cause: null,
  lessons: null,
  doneSections: [],
  createdBy: { id: idOf(1), name: "Alex Kim" },
  createdAt: "2026-09-21T10:00:00.000Z",
  publishedBy: null,
  publishedAt: null,
  updatedAt: "2026-09-21T10:00:00.000Z",
  facts: {
    declaredAt: "2026-09-21T06:00:00.000Z",
    resolvedAt: "2026-09-21T09:12:00.000Z",
    firstResponseAt: "2026-09-21T06:06:00.000Z",
    responderCount: 3,
    updateCount: 11,
    severity: { declared: "SEV3", highest: "SEV1", final: "SEV2" },
    reassignmentCount: 1,
  },
  keyMoments: [],
  ...overrides,
});

const wrapperFor = (queryClient: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };

const cached = (queryClient: QueryClient) =>
  queryClient.getQueryData<IncidentAnalysisResponse | null>(
    queryKeys.incidentAnalysis(ORG, NUMBER),
  );

/** Whether the entry under `key` has been marked stale by an invalidation. */
const invalidated = (queryClient: QueryClient, key: readonly unknown[]) =>
  queryClient.getQueryState(key)?.isInvalidated ?? false;

describe("incident analysis queries", () => {
  beforeEach(() => setAccessToken("token"));
  afterEach(() => clearAccessToken());

  describe("reading", () => {
    it("should read the incident's analysis under its own key", async () => {
      const { requests } = mockApi(() => jsonResponse(200, analysis()));
      const queryClient = createQueryClient();

      const { result } = renderHook(() => useIncidentAnalysis(ORG, NUMBER), {
        wrapper: wrapperFor(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toEqual(analysis());
      expect(requests.map(route)).toEqual([`GET ${path}`]);
    });

    it("should answer null, not an error, when no analysis has been started", async () => {
      mockApi(() => apiError(404, "ANALYSIS_NOT_STARTED"));
      const queryClient = createQueryClient();

      const { result } = renderHook(() => useIncidentAnalysis(ORG, NUMBER), {
        wrapper: wrapperFor(queryClient),
      });

      await waitFor(() => expect(result.current.isSuccess).toBe(true));

      expect(result.current.data).toBeNull();
    });

    it("should still fail when the incident itself is not found", async () => {
      mockApi(() => apiError(404, "INCIDENT_NOT_FOUND"));
      const queryClient = createQueryClient();

      const { result } = renderHook(() => useIncidentAnalysis(ORG, NUMBER), {
        wrapper: wrapperFor(queryClient),
      });

      await waitFor(() => expect(result.current.isError).toBe(true));

      expect(result.current.error).toMatchObject({
        statusCode: 404,
        code: "INCIDENT_NOT_FOUND",
      });
    });

    it("should ask nothing while disabled", () => {
      const { requests } = mockApi(() => jsonResponse(200, analysis()));
      const queryClient = createQueryClient();

      renderHook(() => useIncidentAnalysis(ORG, NUMBER, { enabled: false }), {
        wrapper: wrapperFor(queryClient),
      });

      expect(requests).toEqual([]);
    });

    it("should never move back to an older version than it holds", async () => {
      // A fetch that began before a save answers with the version before it.
      mockApi(() => jsonResponse(200, analysis({ version: 4 })));
      const queryClient = createQueryClient();

      queryClient.setQueryData(
        queryKeys.incidentAnalysis(ORG, NUMBER),
        analysis({ version: 5, summary: "Saved" }),
      );

      const { result } = renderHook(() => useIncidentAnalysis(ORG, NUMBER), {
        wrapper: wrapperFor(queryClient),
      });

      await act(() => result.current.refetch());

      expect(cached(queryClient)).toMatchObject({ version: 5, summary: "Saved" });
    });
  });

  describe("laterAnalysis", () => {
    it("should keep whichever state has the later version", () => {
      const v2 = analysis({ version: 2 });
      const v3 = analysis({ version: 3 });

      expect(laterAnalysis(v3, v2)).toBe(v3);
      expect(laterAnalysis(v2, v3)).toBe(v3);
      expect(laterAnalysis(undefined, v2)).toBe(v2);
      expect(laterAnalysis(null, v2)).toBe(v2);
      expect(laterAnalysis(v2, null)).toBeNull();
    });
  });

  describe("starting", () => {
    it("should start one owned by the caller without a body, and store it", async () => {
      const { requests } = mockApi(() => jsonResponse(201, analysis()));
      const queryClient = createQueryClient();

      queryClient.setQueryData(queryKeys.incidentAnalysis(ORG, NUMBER), null);

      const { result } = renderHook(
        () => useStartIncidentAnalysis(ORG, NUMBER),
        { wrapper: wrapperFor(queryClient) },
      );

      await act(() => result.current.mutateAsync(undefined));

      expect(requests.map(route)).toEqual([`POST ${path}`]);
      expect(requests[0].body).toBeUndefined();
      expect(cached(queryClient)).toEqual(analysis());
    });

    it("should name another owner when asked to", async () => {
      const { requests } = mockApi(() =>
        jsonResponse(201, analysis({ owner: { membershipId: OTHER, name: "Sam" } })),
      );
      const queryClient = createQueryClient();

      const { result } = renderHook(
        () => useStartIncidentAnalysis(ORG, NUMBER),
        { wrapper: wrapperFor(queryClient) },
      );

      await act(() => result.current.mutateAsync({ ownerMembershipId: OTHER }));

      expect(requests[0].body).toEqual({ ownerMembershipId: OTHER });
    });

    it("should fetch the analysis someone else started first", async () => {
      const { requests } = mockApi((request) =>
        request.method === "POST"
          ? apiError(409, "ANALYSIS_ALREADY_STARTED")
          : jsonResponse(200, analysis({ owner: { membershipId: OTHER, name: "Sam" } })),
      );
      const queryClient = createQueryClient();

      const { result } = renderHook(
        () => ({
          analysis: useIncidentAnalysis(ORG, NUMBER),
          start: useStartIncidentAnalysis(ORG, NUMBER),
        }),
        { wrapper: wrapperFor(queryClient) },
      );

      await waitFor(() => expect(result.current.analysis.isSuccess).toBe(true));
      await act(() => result.current.start.mutateAsync(undefined).catch(() => {}));

      await waitFor(() =>

        expect(analysisRefusalOf(result.current.start.error)).toBe("already-started"),

      );
      await waitFor(() =>
        expect(requests.map(route)).toEqual([
          `GET ${path}`,
          `POST ${path}`,
          `GET ${path}`,
        ]),
      );
    });

    it("should stale the incident when it turns out not to be resolved", async () => {
      mockApi(() => apiError(409, "INCIDENT_NOT_RESOLVED"));
      const queryClient = createQueryClient();

      queryClient.setQueryData(queryKeys.incident(ORG, NUMBER), { number: NUMBER });

      const { result } = renderHook(
        () => useStartIncidentAnalysis(ORG, NUMBER),
        { wrapper: wrapperFor(queryClient) },
      );

      await act(() => result.current.mutateAsync(undefined).catch(() => {}));

      await waitFor(() =>

        expect(analysisRefusalOf(result.current.error)).toBe("not-resolved"),

      );
      expect(invalidated(queryClient, queryKeys.incident(ORG, NUMBER))).toBe(true);
    });
  });

  describe("editing", () => {
    it("should send only what it is given, with the version, and store the answer", async () => {
      const saved = analysis({ version: 3, summary: "Checkout failed." });
      const { requests } = mockApi(() => jsonResponse(200, saved));
      const queryClient = createQueryClient();

      queryClient.setQueryData(
        queryKeys.incidentAnalysis(ORG, NUMBER),
        analysis({ version: 2 }),
      );

      const { result } = renderHook(() => useEditIncidentAnalysis(ORG, NUMBER), {
        wrapper: wrapperFor(queryClient),
      });

      await act(() =>
        result.current.mutateAsync({ version: 2, summary: "Checkout failed." }),
      );

      expect(requests.map(route)).toEqual([`PATCH ${path}`]);
      expect(requests[0].body).toEqual({ version: 2, summary: "Checkout failed." });
      expect(cached(queryClient)).toEqual(saved);
    });

    it("should overwrite nothing and fetch the analysis again when it changed meanwhile", async () => {
      const theirs = analysis({ version: 3, summary: "Theirs" });
      const { requests } = mockApi((request) =>
        request.method === "PATCH"
          ? apiError(409, "ANALYSIS_CHANGED")
          : jsonResponse(200, theirs),
      );
      const queryClient = createQueryClient();

      const { result } = renderHook(
        () => ({
          analysis: useIncidentAnalysis(ORG, NUMBER),
          edit: useEditIncidentAnalysis(ORG, NUMBER),
        }),
        { wrapper: wrapperFor(queryClient) },
      );

      await waitFor(() => expect(result.current.analysis.isSuccess).toBe(true));
      await act(() =>
        result.current.edit
          .mutateAsync({ version: 2, summary: "Mine" })
          .catch(() => {}),
      );

      await waitFor(() =>

        expect(analysisRefusalOf(result.current.edit.error)).toBe("changed"),

      );
      await waitFor(() => expect(requests.map(route)).toHaveLength(3));
      expect(requests.map(route).at(-1)).toBe(`GET ${path}`);
      expect(cached(queryClient)).toEqual(theirs);
    });

    it("should fetch the analysis again when the caller no longer owns it", async () => {
      const reassigned = analysis({
        version: 4,
        owner: { membershipId: OTHER, name: "Sam Okafor" },
      });
      mockApi((request) =>
        request.method === "PATCH"
          ? apiError(403, "NOT_ANALYSIS_OWNER")
          : jsonResponse(200, reassigned),
      );
      const queryClient = createQueryClient();

      const { result } = renderHook(
        () => ({
          analysis: useIncidentAnalysis(ORG, NUMBER),
          edit: useEditIncidentAnalysis(ORG, NUMBER),
        }),
        { wrapper: wrapperFor(queryClient) },
      );

      await waitFor(() => expect(result.current.analysis.isSuccess).toBe(true));
      await act(() =>
        result.current.edit.mutateAsync({ version: 3, lessons: "x" }).catch(() => {}),
      );

      await waitFor(() =>

        expect(analysisRefusalOf(result.current.edit.error)).toBe("not-owner"),

      );
      await waitFor(() =>
        expect(cached(queryClient)?.owner.membershipId).toBe(OTHER),
      );
    });

    it("should not fetch again after a server or network failure", async () => {
      const queryClient = createQueryClient();

      queryClient.setQueryData(
        queryKeys.incidentAnalysis(ORG, NUMBER),
        analysis({ version: 2 }),
      );
      mockApi(() => apiError(500));

      const { result } = renderHook(() => useEditIncidentAnalysis(ORG, NUMBER), {
        wrapper: wrapperFor(queryClient),
      });

      await act(() =>
        result.current.mutateAsync({ version: 2, summary: "x" }).catch(() => {}),
      );

      await waitFor(() => expect(result.current.isError).toBe(true));
      expect(analysisRefusalOf(result.current.error)).toBeUndefined();
      expect(
        invalidated(queryClient, queryKeys.incidentAnalysis(ORG, NUMBER)),
      ).toBe(false);
      expect(cached(queryClient)?.version).toBe(2);
    });
  });

  describe("reassigning", () => {
    it("should put the new owner with the version, and store the answer", async () => {
      const handed = analysis({
        version: 3,
        owner: { membershipId: OTHER, name: "Sam Okafor" },
      });
      const { requests } = mockApi(() => jsonResponse(200, handed));
      const queryClient = createQueryClient();

      const { result } = renderHook(
        () => useReassignIncidentAnalysisOwner(ORG, NUMBER),
        { wrapper: wrapperFor(queryClient) },
      );

      await act(() =>
        result.current.mutateAsync({ ownerMembershipId: OTHER, version: 2 }),
      );

      expect(requests.map(route)).toEqual([`PUT ${path}/owner`]);
      expect(requests[0].body).toEqual({ ownerMembershipId: OTHER, version: 2 });
      expect(cached(queryClient)).toEqual(handed);
    });

    it("should stale the member list when the new owner is no longer a member", async () => {
      mockApi(() => apiError(404, "MEMBERSHIP_NOT_FOUND"));
      const queryClient = createQueryClient();

      queryClient.setQueryData(queryKeys.memberships(ORG), []);
      queryClient.setQueryData(
        queryKeys.incidentAnalysis(ORG, NUMBER),
        analysis({ version: 2 }),
      );

      const { result } = renderHook(
        () => useReassignIncidentAnalysisOwner(ORG, NUMBER),
        { wrapper: wrapperFor(queryClient) },
      );

      await act(() =>
        result.current
          .mutateAsync({ ownerMembershipId: OTHER, version: 2 })
          .catch(() => {}),
      );

      expect(invalidated(queryClient, queryKeys.memberships(ORG))).toBe(true);
    });
  });

  describe("publishing", () => {
    it("should publish the version read, and store the published analysis", async () => {
      const published = analysis({
        status: "PUBLISHED",
        version: 6,
        summary: "Checkout failed.",
        publishedBy: { id: idOf(1), name: "Alex Kim" },
        publishedAt: "2026-09-22T14:10:00.000Z",
      });
      const { requests } = mockApi(() => jsonResponse(200, published));
      const queryClient = createQueryClient();

      const { result } = renderHook(
        () => usePublishIncidentAnalysis(ORG, NUMBER),
        { wrapper: wrapperFor(queryClient) },
      );

      await act(() => result.current.mutateAsync({ version: 5 }));

      expect(requests.map(route)).toEqual([`POST ${path}/publish`]);
      expect(requests[0].body).toEqual({ version: 5 });
      expect(cached(queryClient)).toEqual(published);
    });

    it("should fetch the published analysis when someone else published it first", async () => {
      const published = analysis({ status: "PUBLISHED", version: 6 });
      mockApi((request) =>
        request.method === "POST"
          ? apiError(409, "ANALYSIS_PUBLISHED")
          : jsonResponse(200, published),
      );
      const queryClient = createQueryClient();

      const { result } = renderHook(
        () => ({
          analysis: useIncidentAnalysis(ORG, NUMBER),
          publish: usePublishIncidentAnalysis(ORG, NUMBER),
        }),
        { wrapper: wrapperFor(queryClient) },
      );

      await waitFor(() => expect(result.current.analysis.isSuccess).toBe(true));
      await act(() =>
        result.current.publish.mutateAsync({ version: 5 }).catch(() => {}),
      );

      await waitFor(() =>

        expect(analysisRefusalOf(result.current.publish.error)).toBe("published"),

      );
      await waitFor(() => expect(cached(queryClient)?.status).toBe("PUBLISHED"));
    });
  });

  describe("analysisRefusalOf", () => {
    it("should name every refusal the analysis API gives", async () => {
      const cases = [
        ["ANALYSIS_CHANGED", 409, "changed"],
        ["ANALYSIS_PUBLISHED", 409, "published"],
        ["NOT_ANALYSIS_OWNER", 403, "not-owner"],
        ["ANALYSIS_NOT_STARTED", 404, "not-started"],
        ["ANALYSIS_ALREADY_STARTED", 409, "already-started"],
        ["ANALYSIS_SUMMARY_REQUIRED", 409, "summary-required"],
        ["INCIDENT_NOT_RESOLVED", 409, "not-resolved"],
      ] as const;

      for (const [code, status, refusal] of cases) {
        mockApi(() => apiError(status, code));
        const queryClient = createQueryClient();
        const { result } = renderHook(
          () => useEditIncidentAnalysis(ORG, NUMBER),
          { wrapper: wrapperFor(queryClient) },
        );

        await act(() =>
          result.current.mutateAsync({ version: 1, summary: "x" }).catch(() => {}),
        );

        await waitFor(() =>

          expect(analysisRefusalOf(result.current.error)).toBe(refusal),

        );
      }
    });

    it("should name nothing else", () => {
      expect(analysisRefusalOf(new NetworkError())).toBeUndefined();
      expect(analysisRefusalOf(new Error("boom"))).toBeUndefined();
      expect(analysisRefusalOf(undefined)).toBeUndefined();
    });
  });

  describe("analysisAccess", () => {
    const ADMIN = [
      Permission.INCIDENTS_READ,
      Permission.INCIDENTS_MANAGE,
      Permission.INCIDENT_ANALYSES_WRITE,
    ];
    const MEMBER = [Permission.INCIDENTS_READ, Permission.INCIDENT_ANALYSES_WRITE];
    const READER = [Permission.INCIDENTS_READ];

    const as = (permissions: string[], membershipId = OWNER) => ({
      membershipId,
      permissions,
    });

    it("should let only an Admin start an analysis, and only when none exists", () => {
      expect(analysisAccess(as(ADMIN), null).canStart).toBe(true);
      expect(analysisAccess(as(MEMBER), null).canStart).toBe(false);
      expect(analysisAccess(as(ADMIN), analysis()).canStart).toBe(false);
      expect(analysisAccess(as(ADMIN), undefined).canStart).toBe(false);
    });

    it("should let the owner, or an Admin, write a draft — the API's mayWriteAnalysis", () => {
      expect(analysisAccess(as(MEMBER, OWNER), analysis())).toEqual({
        canStart: false,
        canWrite: true,
        canReassign: false,
        isOwner: true,
      });
      expect(analysisAccess(as(MEMBER, OTHER), analysis())).toEqual({
        canStart: false,
        canWrite: false,
        canReassign: false,
        isOwner: false,
      });
      expect(analysisAccess(as(ADMIN, OTHER), analysis())).toEqual({
        canStart: false,
        canWrite: true,
        canReassign: true,
        isOwner: false,
      });
    });

    it("should not let an owner write without incident-analyses:write", () => {
      expect(analysisAccess(as(READER, OWNER), analysis()).canWrite).toBe(false);
    });

    it("should allow no writes to a published analysis", () => {
      const published = analysis({ status: "PUBLISHED" });

      expect(analysisAccess(as(ADMIN, OWNER), published)).toEqual({
        canStart: false,
        canWrite: false,
        canReassign: false,
        isOwner: true,
      });
    });

    it("should allow nothing while the analysis is not yet known", () => {
      expect(analysisAccess(as(ADMIN), undefined)).toEqual({
        canStart: false,
        canWrite: false,
        canReassign: false,
        isOwner: false,
      });
    });
  });
});
