import { env } from "../config/env";
import { NetworkError, toApiError } from "./errors";

/**
 * The transport underneath both request kinds. Nothing outside `lib/api` and
 * `lib/auth` calls it: endpoints choose `sessionRequest` or
 * `authenticatedRequest`, and that choice is the whole of their auth policy.
 */

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

interface Transport {
  /**
   * `include` for the session endpoints, whose cookie must be sent *and*
   * stored — a browser ignores `Set-Cookie` on a cross-origin response unless
   * the request carried credentials. `omit` for everything else.
   */
  credentials: "include" | "omit";
  token?: string | null;
}

export const send = async (
  path: string,
  { method = "GET", body, signal }: RequestOptions,
  { credentials, token }: Transport,
): Promise<Response> => {
  const headers: Record<string, string> = { Accept: "application/json" };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    return await fetch(`${env.apiBaseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials,
      cache: "no-store",
      signal,
    });
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }

    throw new NetworkError();
  }
};

/**
 * Resolves a response to its body, or throws an `ApiError`. The body is read
 * in full before this settles, which the refresh lock depends on.
 */
export const read = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    throw await toApiError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
};

/**
 * A request to one of the session endpoints: register, login, refresh,
 * logout. Carries the refresh cookie and never a bearer token.
 *
 * A 401 here is the answer, not a reason to refresh — which is also why
 * refreshing, itself a session request, cannot recurse.
 */
export const sessionRequest = async <T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> =>
  read<T>(await send(path, options, { credentials: "include" }));
