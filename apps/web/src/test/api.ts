import { vi } from "vitest";

export const API = "http://api.test/api/v1";

export const jsonResponse = (status: number, body?: unknown): Response =>
  status === 204
    ? new Response(null, { status })
    : new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });

export const apiError = (
  statusCode: number,
  code?: string,
  extra: Record<string, unknown> = {},
) =>
  jsonResponse(statusCode, {
    statusCode,
    error: "Error",
    message: `Failed with ${statusCode}`,
    ...(code ? { code } : {}),
    requestId: "req-1",
    timestamp: "2026-09-17T00:00:00.000Z",
    path: "/api/v1/test",
    ...extra,
  });

export interface SentRequest {
  method: string;
  path: string;
  credentials: RequestCredentials | undefined;
  authorization: string | null;
  body: unknown;
}

type Handler = (request: SentRequest) => Response | Promise<Response>;

/**
 * Replaces `fetch` with a handler keyed on "METHOD /path" (relative to the
 * API base), recording every request it receives.
 */
export const mockApi = (handler: Handler) => {
  const requests: SentRequest[] = [];

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = new Headers(init?.headers);
    const request: SentRequest = {
      method: init?.method ?? "GET",
      path: url.startsWith(API) ? url.slice(API.length) : url,
      credentials: init?.credentials,
      authorization: headers.get("Authorization"),
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    };

    requests.push(request);

    return handler(request);
  });

  vi.stubGlobal("fetch", fetchMock);

  return { fetchMock, requests };
};

export const route = (request: SentRequest) =>
  `${request.method} ${request.path}`;

export const refreshed = (accessToken: string) =>
  jsonResponse(200, { accessToken, expiresIn: 900, tokenType: "Bearer" });

export const organization = {
  id: "0199a1b2-c3d4-7000-8000-00000000000a",
  name: "Acme Operations",
  slug: "acme-ops",
  createdAt: "2026-09-01T12:00:00.000Z",
  demo: false,
};

export const currentUser = {
  id: "0199a1b2-c3d4-7000-8000-000000000001",
  email: "ada@example.com",
  name: "Ada Lovelace",
  createdAt: "2026-09-01T12:00:00.000Z",
  passwordChangeRequired: false,
  memberships: [
    {
      id: "0199a1b2-c3d4-7000-8000-0000000000aa",
      role: "ADMIN",
      organization,
    },
  ],
};

export const organizationDetail = (permissions: string[], role = "ADMIN") => ({
  ...organization,
  membership: {
    id: "0199a1b2-c3d4-7000-8000-0000000000aa",
    role,
    permissions,
  },
});
