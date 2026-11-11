import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { storeIncident } from "@/components/incidents/incident-queries";
import type {
  IncidentDetailResponse,
  IncidentOccurrenceResponse,
} from "@/lib/api/contracts";
import { ApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";
import { clearAccessToken, setAccessToken } from "@/lib/auth/token-store";
import { createQueryClient } from "@/lib/query/query-client";
import { apiError, jsonResponse, mockApi, organization } from "@/test/api";

import { useIncidentOccurrence } from "./use-incident-occurrence";

const OTHER_ORG = "0199a1b2-c3d4-7000-8000-00000000000b";

/** Just after midnight UTC: late on the 20th in the Americas, the 21st here. */
const NOW = new Date("2026-09-21T00:30:00.000Z");

/** The thirty whole UTC days ending on the day `NOW` falls on. */
const PERIOD = { from: "2026-08-23", to: "2026-09-21" };

const occurrencePath = (organizationId: string) =>
  `/organizations/${organizationId}/incidents/occurrence?from=${PERIOD.from}&to=${PERIOD.to}`;

/**
 * An answer whose figures a client could be tempted to recompute, and must
 * not: the counts differ, yet there is no percentage — the previous period
 * was too small — and today, though it has an incident, is neither complete
 * nor averaged.
 */
const answer: IncidentOccurrenceResponse = {
  from: PERIOD.from,
  to: PERIOD.to,
  asOf: NOW.toISOString(),
  trackedFrom: "2026-03-24",
  declared: 7,
  incidentFreeDays: 24,
  completeDays: 29,
  days: [
    {
      date: "2026-09-20",
      declared: 5,
      complete: true,
      tracked: true,
      rollingAverage: 0.86,
    },
    {
      date: "2026-09-21",
      declared: 2,
      complete: false,
      tracked: true,
      rollingAverage: null,
    },
  ],
  previous: {
    from: "2026-07-24",
    to: "2026-08-22",
    declared: 3,
    comparable: true,
    minimumSample: 5,
    changePercent: null,
  },
  services: {
    top: [
      {
        id: "0199a1b2-c3d4-7000-8000-0000000000d1",
        name: "Payment API",
        slug: "payment-api",
        criticality: "CRITICAL",
        archivedAt: null,
        declared: 6,
        share: 6 / 7,
      },
    ],
    others: { services: 1, declared: 1 },
  },
};

const incident: IncidentDetailResponse = {
  id: "0199a1b2-c3d4-7000-8000-0000000000e1",
  number: 1,
  title: "Card payments failing",
  responseAccess: "OPEN",
  assignees: [],
  summary: null,
  resolution: null,
  severity: "SEV1",
  status: "DECLARED",
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
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  resolvedAt: null,
  responders: [],
};

const wrapperFor = (queryClient: QueryClient) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };

describe("incident occurrence", () => {
  beforeEach(() => {
    // Only the clock is fixed; timers stay real, so queries settle.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    setAccessToken("token");
  });

  afterEach(() => {
    vi.useRealTimers();
    clearAccessToken();
  });

  it("asks for the last thirty UTC days, ending today, under its own key", async () => {
    const { requests } = mockApi(() => jsonResponse(200, answer));
    const queryClient = createQueryClient();

    const { result } = renderHook(() => useIncidentOccurrence(organization.id), {
      wrapper: wrapperFor(queryClient),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requests).toEqual([
      expect.objectContaining({
        method: "GET",
        path: occurrencePath(organization.id),
        authorization: "Bearer token",
      }),
    ]);
    expect(
      queryClient.getQueryData(
        queryKeys.incidentOccurrence(organization.id, PERIOD.from, PERIOD.to),
      ),
    ).toEqual(answer);
  });

  it("hands on the API's answer as it is, recomputing nothing", async () => {
    mockApi(() => jsonResponse(200, answer));

    const { result } = renderHook(() => useIncidentOccurrence(organization.id), {
      wrapper: wrapperFor(createQueryClient()),
    });

    await waitFor(() => expect(result.current.data).toEqual(answer));
  });

  it("is its own request, never the summary's", async () => {
    const { requests } = mockApi(() => jsonResponse(200, answer));

    const { result } = renderHook(() => useIncidentOccurrence(organization.id), {
      wrapper: wrapperFor(createQueryClient()),
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(requests.map(({ path }) => path.split("?")[0])).toEqual([
      `/organizations/${organization.id}/incidents/occurrence`,
    ]);
  });

  it("is pending, with no data, until the answer arrives", async () => {
    let respond!: (response: Response) => void;
    mockApi(() => new Promise<Response>((resolve) => (respond = resolve)));

    const { result } = renderHook(() => useIncidentOccurrence(organization.id), {
      wrapper: wrapperFor(createQueryClient()),
    });

    await waitFor(() => expect(respond).toBeDefined());
    expect(result.current.isPending).toBe(true);
    expect(result.current.data).toBeUndefined();

    respond(jsonResponse(200, answer));

    await waitFor(() => expect(result.current.data).toEqual(answer));
  });

  it("gives the API's refusal as an error, and no data", async () => {
    const { requests } = mockApi(() =>
      apiError(403, "PERMISSION_DENIED"),
    );

    const { result } = renderHook(() => useIncidentOccurrence(organization.id), {
      wrapper: wrapperFor(createQueryClient()),
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(ApiError);
    expect(result.current.error).toMatchObject({
      statusCode: 403,
      code: "PERMISSION_DENIED",
    });
    expect(result.current.data).toBeUndefined();
    // A refusal is not retried: asking again would be refused again.
    expect(requests).toHaveLength(1);
  });

  it("goes stale when an incident is declared or changed, in that organization only", async () => {
    mockApi(() => jsonResponse(200, answer));
    const queryClient = createQueryClient();
    const key = (organizationId: string) =>
      queryKeys.incidentOccurrence(organizationId, PERIOD.from, PERIOD.to);

    queryClient.setQueryData(key(organization.id), answer);
    queryClient.setQueryData(key(OTHER_ORG), answer);

    storeIncident(queryClient, organization.id, incident);

    expect(queryClient.getQueryState(key(organization.id))?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(key(OTHER_ORG))?.isInvalidated).toBe(false);
  });
});
