import { refreshSession } from "../auth/refresh";
import { endSession, getAccessToken } from "../auth/token-store";
import { isApiError } from "./errors";
import { read, send } from "./http";
import type { RequestOptions } from "./http";

export { publicRequest, sessionRequest } from "./http";
export type { RequestOptions } from "./http";

/**
 * Chooses the token for the one retry after a 401.
 *
 * If another request already refreshed while this one was in flight, the
 * current token differs from the one that was refused, and it is used as-is —
 * refreshing again would only rotate the cookie for nothing. Otherwise this
 * refreshes (single-flight). A refresh the API refuses ends the session; one
 * that could not reach the API does not, since the API being down says
 * nothing about whether the session is still valid.
 */
const tokenForRetry = async (refused: string | null): Promise<string> => {
  const current = getAccessToken();

  if (current && current !== refused) {
    return current;
  }

  try {
    return await refreshSession();
  } catch (error) {
    if (isApiError(error, 401)) {
      endSession();
    }

    throw error;
  }
};

/**
 * A request on behalf of the signed-in user, with the in-memory bearer
 * token.
 *
 * Only a 401 is special, and it gets exactly one recovery:
 *
 *   request → 401 → one refresh (or a token some other request just obtained)
 *           → one retry → final
 *
 * A retry that is refused again ends the session. There is no loop. A 403
 * `PERMISSION_DENIED` or 404 `ORGANIZATION_NOT_FOUND` is thrown to the
 * caller unchanged: those are answers, not authentication failures.
 */
const bearerRequest = async <T>(
  path: string,
  options: RequestOptions,
  credentials: "include" | "omit",
): Promise<T> => {
  const sentWith = getAccessToken();
  const first = await send(path, options, { credentials, token: sentWith });

  if (first.status !== 401) {
    return read<T>(first);
  }

  const retryToken = await tokenForRetry(sentWith);
  const second = await send(path, options, { credentials, token: retryToken });

  if (second.status === 401) {
    endSession();
  }

  return read<T>(second);
};

/**
 * A request on behalf of the signed-in user: `/auth/me` and every
 * organization route. Sends the bearer token and never the cookie.
 */
export const authenticatedRequest = <T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> => bearerRequest<T>(path, options, "omit");

/**
 * A request on behalf of the signed-in user that also replaces the session:
 * changing a password answers with a new refresh cookie, which the browser
 * only accepts from a credentialed request. The bearer token and the same
 * single 401 recovery as `authenticatedRequest`.
 */
export const authenticatedSessionRequest = <T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> => bearerRequest<T>(path, options, "include");
