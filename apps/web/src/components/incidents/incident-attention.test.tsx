import { act, renderHook, waitFor } from "@testing-library/react";
import { focusManager, QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  IncidentAttentionResponse,
  IncidentDetailResponse,
} from "@/lib/api/contracts";
import { queryKeys } from "@/lib/api/query-keys";
import { clearAccessToken, setAccessToken } from "@/lib/auth/token-store";
import { createQueryClient } from "@/lib/query/query-client";
import { jsonResponse, mockApi, organization } from "@/test/api";

import {
  ATTENTION_POLL_MS,
  attentionCount,
  storeIncident,
  useIncidentAttention,
} from "./incident-queries";

const OTHER_ORG = "0199a1b2-c3d4-7000-8000-00000000000b";

const incident = (number: number): IncidentDetailResponse => ({
  id: `0199a1b2-c3d4-7000-8000-0000000000e${number}`,
  number,
  title: "Card payments failing",
  severityConfirmed: true,
  responseAccess: "OPEN",
  assignees: [],
  knownIssue: null,
  summary: null,
  resolution: null,
  severity: "SEV1",
  status: "INVESTIGATING",
  service: {
    id: "0199a1b2-c3d4-7000-8000-0000000000d1",
    name: "Payment API",
    slug: "payment-api",
    criticality: "CRITICAL",
    archivedAt: null,
  },
  team: {
    id: "0199a1b2-c3d4-7000-8000-0000000000c1",
    name: "Payments",
    slug: "payments",
  },
  createdBy: { id: "0199a1b2-c3d4-7000-8000-000000000001", name: "Ada" },
  createdAt: "2026-09-19T10:00:00.000Z",
  updatedAt: "2026-09-19T10:00:00.000Z",
  resolvedAt: null,
  responders: [],
});

/** One organization's attention: incident `number` ready to resolve. */
const readyToResolve = (number: number): IncidentAttentionResponse => ({
  manage: { needsDecision: [], readyToResolve: [incident(number)] },
  respond: { assignedToYou: [], needsYourTeam: [], yourResponses: [] },
});

const attentionPath = (organizationId: string) =>
  `/organizations/${organizationId}/incidents/attention`;

/** Organization A has INC-1 ready; the other organization, INC-7. */
const api = () =>
  mockApi((request) =>
    jsonResponse(
      200,
      readyToResolve(request.path === attentionPath(OTHER_ORG) ? 7 : 1),
    ),
  );

const attentionRequests = (
  requests: { path: string }[],
  organizationId = organization.id,
) => requests.filter(({ path }) => path === attentionPath(organizationId));

/**
 * Waits for `check` to pass on real timeouts, for tests that fake only the
 * interval: every waitFor on offer either polls with the faked interval or
 * advances it, and advancing it would poll.
 */
const eventually = async (check: () => void) => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return check();
    } catch (error) {
      if (attempt >= 100) throw error;
    }

    await act(() => new Promise((resolve) => setTimeout(resolve, 10)));
  }
};

const wrapperFor = (queryClient: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };

describe("incident attention", () => {
  beforeEach(() => {
    setAccessToken("token");
  });

  afterEach(() => {
    vi.useRealTimers();
    focusManager.setFocused(undefined);
    clearAccessToken();
  });

  it("reads the caller's attention in the organization, under its own key", async () => {
    const { requests } = api();
    const queryClient = createQueryClient();

    const { result } = renderHook(
      () => useIncidentAttention(organization.id),
      { wrapper: wrapperFor(queryClient) },
    );

    await waitFor(() => expect(result.current.data).toEqual(readyToResolve(1)));
    expect(requests).toEqual([
      expect.objectContaining({
        method: "GET",
        path: attentionPath(organization.id),
        authorization: "Bearer token",
      }),
    ]);
    expect(
      queryClient.getQueryData(queryKeys.incidentAttention(organization.id)),
    ).toEqual(readyToResolve(1));
  });

  it("asks again every 30 seconds for the one component that polls", async () => {
    // Only the interval is faked; fetches, promises, and timeouts stay real.
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { requests } = api();

    const { result } = renderHook(
      () => useIncidentAttention(organization.id, { poll: true }),
      { wrapper: wrapperFor(createQueryClient()) },
    );

    await eventually(() => expect(result.current.isSuccess).toBe(true));
    expect(attentionRequests(requests)).toHaveLength(1);

    await act(() => vi.advanceTimersByTimeAsync(ATTENTION_POLL_MS - 1));
    expect(attentionRequests(requests)).toHaveLength(1);

    await act(() => vi.advanceTimersByTimeAsync(1));
    await eventually(() => expect(attentionRequests(requests)).toHaveLength(2));

    await act(() => vi.advanceTimersByTimeAsync(ATTENTION_POLL_MS));
    await eventually(() => expect(attentionRequests(requests)).toHaveLength(3));
  });

  it("does not ask while the tab is hidden", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { requests } = api();

    const { result } = renderHook(
      () => useIncidentAttention(organization.id, { poll: true }),
      { wrapper: wrapperFor(createQueryClient()) },
    );

    await eventually(() => expect(result.current.isSuccess).toBe(true));

    act(() => focusManager.setFocused(false));
    await act(() => vi.advanceTimersByTimeAsync(ATTENTION_POLL_MS * 3));

    expect(attentionRequests(requests)).toHaveLength(1);
  });

  it("does not ask again for a reader that does not poll", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const { requests } = api();

    const { result } = renderHook(
      () => useIncidentAttention(organization.id),
      { wrapper: wrapperFor(createQueryClient()) },
    );

    await eventually(() => expect(result.current.isSuccess).toBe(true));
    await act(() => vi.advanceTimersByTimeAsync(ATTENTION_POLL_MS * 3));

    expect(attentionRequests(requests)).toHaveLength(1);
  });

  it("keeps each organization's attention to itself when switching", async () => {
    const { requests } = api();
    const queryClient = createQueryClient();

    const { result, rerender } = renderHook(
      ({ organizationId }) => useIncidentAttention(organizationId),
      {
        wrapper: wrapperFor(queryClient),
        initialProps: { organizationId: organization.id },
      },
    );

    await waitFor(() => expect(result.current.data).toEqual(readyToResolve(1)));

    rerender({ organizationId: OTHER_ORG });

    // Never the first organization's answer under the second's name.
    await waitFor(() => expect(result.current.data).toEqual(readyToResolve(7)));
    expect(attentionRequests(requests, OTHER_ORG)).toHaveLength(1);
    expect(
      queryClient.getQueryData(queryKeys.incidentAttention(organization.id)),
    ).toEqual(readyToResolve(1));
    expect(
      queryClient.getQueryData(queryKeys.incidentAttention(OTHER_ORG)),
    ).toEqual(readyToResolve(7));
  });

  it("is refreshed by every change stored for an incident, in that organization only", () => {
    const queryClient = createQueryClient();
    const stale = (organizationId: string) =>
      queryClient.getQueryState(queryKeys.incidentAttention(organizationId))
        ?.isInvalidated;

    queryClient.setQueryData(
      queryKeys.incidentAttention(organization.id),
      readyToResolve(1),
    );
    queryClient.setQueryData(
      queryKeys.incidentAttention(OTHER_ORG),
      readyToResolve(7),
    );

    // Declaring, starting, completing, resolving, and reassigning all end
    // here with the API's answer.
    storeIncident(queryClient, organization.id, {
      ...incident(1),
      status: "RESOLVED",
    });

    expect(stale(organization.id)).toBe(true);
    expect(stale(OTHER_ORG)).toBe(false);
  });
});

describe("the attention count", () => {
  const empty = { assignedToYou: [], needsYourTeam: [], yourResponses: [] };

  it("counts what is ready to resolve", () => {
    expect(
      attentionCount({
        manage: { needsDecision: [], readyToResolve: [incident(1), incident(2)] },
        respond: empty,
      }),
    ).toBe(2);
  });

  it("counts a member's team work and own responses together", () => {
    expect(
      attentionCount({
        manage: null,
        respond: { assignedToYou: [], needsYourTeam: [incident(1)], yourResponses: [incident(2)] },
      }),
    ).toBe(2);
  });

  it("counts an incident in two lists once", () => {
    // Resolvable, and reassigned to a team the caller is on.
    expect(
      attentionCount({
        manage: { needsDecision: [], readyToResolve: [incident(1)] },
        respond: { assignedToYou: [], needsYourTeam: [incident(1)], yourResponses: [] },
      }),
    ).toBe(1);
  });

  it("is zero with nothing waiting, or no part at all", () => {
    expect(
      attentionCount({ manage: { needsDecision: [], readyToResolve: [] }, respond: empty }),
    ).toBe(0);
    expect(attentionCount({ manage: null, respond: null })).toBe(0);
  });
});
