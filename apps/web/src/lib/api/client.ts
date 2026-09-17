import { refreshSession } from "../auth/refresh";
import { endSession, getAccessToken } from "../auth/token-store";
import { isApiError } from "./errors";
import { read, send } from "./http";
import type { RequestOptions } from "./http";

export { sessionRequest } from "./http";
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
 * A request on behalf of the signed-in user: `/auth/me` and every
 * organization route. Sends the in-memory bearer token and never the cookie.
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
export const authenticatedRequest = async <T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> => {
  const sentWith = getAccessToken();
  const first = await send(path, options, {
    credentials: "omit",
    token: sentWith,
  });

  if (first.status !== 401) {
    return read<T>(first);
  }

  const retryToken = await tokenForRetry(sentWith);
  const second = await send(path, options, {
    credentials: "omit",
    token: retryToken,
  });

  if (second.status === 401) {
    endSession();
  }

  return read<T>(second);
};
