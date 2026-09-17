import type { RefreshedResponse } from "../api/contracts";
import { sessionRequest } from "../api/http";
import { setAccessToken } from "./token-store";

/**
 * Exchanging the refresh cookie for a new access token, safely.
 *
 * The API rotates the cookie on every refresh and treats a second use of the
 * same cookie as theft: the whole token family is revoked, signing the user
 * out everywhere. Two overlapping refreshes from one browser would trip that.
 * So:
 *
 * - Within a tab, refreshes are single-flight: every caller that arrives while
 *   one is pending shares its promise. N concurrent callers, one request. This
 *   also absorbs React Strict Mode running an effect twice.
 *
 * - Across tabs, the request runs under an exclusive Web Lock, held until the
 *   response body has been read — by which point the browser has stored the
 *   rotated cookie. Tabs refresh one after another, each presenting the
 *   cookie the previous one stored. This *serializes*; it does not share: N
 *   tabs refreshing together make N requests and N rotations, and each ends
 *   with its own access token. Tokens other tabs already hold stay valid,
 *   because rotation does not touch access tokens.
 *
 * Where Web Locks is missing (it needs a secure context; `localhost` is one,
 * a plain-http LAN address is not) only the in-tab guarantee holds, and two
 * tabs refreshing at the same instant can end the session. So can a tab that
 * unloads after the server rotated but before the response arrived. Both
 * failures sign the user out; neither exposes anything.
 */

export const REFRESH_LOCK_NAME = "sentinelops:auth-refresh";

let inFlight: Promise<string> | null = null;

const lockManager = (): LockManager | undefined =>
  typeof navigator === "undefined"
    ? undefined
    : (navigator as Navigator & { locks?: LockManager }).locks;

const performRefresh = async (): Promise<string> => {
  const response = await sessionRequest<RefreshedResponse>("/auth/refresh", {
    method: "POST",
  });

  setAccessToken(response.accessToken);

  return response.accessToken;
};

const underRefreshLock = async (
  task: () => Promise<string>,
): Promise<string> => {
  const locks = lockManager();

  if (!locks) return task();

  // The lock is released when `task` settles, i.e. after the body is read.
  return await locks.request(REFRESH_LOCK_NAME, { mode: "exclusive" }, task);
};

/**
 * Obtains a new access token and stores it. Rejects with the `ApiError` or
 * `NetworkError` that stopped it; deciding whether that ends the session is
 * the caller's business.
 */
export const refreshSession = (): Promise<string> => {
  inFlight ??= underRefreshLock(performRefresh).finally(() => {
    inFlight = null;
  });

  return inFlight;
};
