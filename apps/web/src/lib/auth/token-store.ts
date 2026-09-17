/**
 * The access token, held in module memory and nowhere else.
 *
 * Never written to localStorage, sessionStorage, or a cookie: a reload loses
 * it on purpose, and the session is restored from the HttpOnly refresh cookie
 * instead. Each tab therefore holds its own token.
 */

let accessToken: string | null = null;

type SessionEndedListener = () => void;

const listeners = new Set<SessionEndedListener>();

export const getAccessToken = (): string | null => accessToken;

export const setAccessToken = (token: string): void => {
  accessToken = token;
};

export const clearAccessToken = (): void => {
  accessToken = null;
};

/**
 * Ends the session in this tab: the token is dropped and every listener — the
 * session provider — is told, so it can clear cached tenant data.
 */
export const endSession = (): void => {
  accessToken = null;

  for (const listener of listeners) {
    listener();
  }
};

export const onSessionEnded = (listener: SessionEndedListener): (() => void) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};
