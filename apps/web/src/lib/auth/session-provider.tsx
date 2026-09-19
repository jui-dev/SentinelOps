"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";

import type {
  ChangePasswordRequest,
  CurrentUserResponse,
  LoginRequest,
  RegisterRequest,
  RegisterWithInvitationRequest,
} from "../api/contracts";
import * as api from "../api/endpoints";
import { isApiError } from "../api/errors";
import { queryKeys } from "../api/query-keys";
import { refreshSession } from "./refresh";
import {
  clearAccessToken,
  onSessionEnded,
  setAccessToken,
} from "./token-store";

/**
 * - `loading`: restoring the session from the refresh cookie.
 * - `authenticated`: a token is held and `me` is cached.
 * - `unauthenticated`: there is no session — none to restore, the API
 *   refused it, or the user logged out.
 * - `unavailable`: the API could not answer. Not a sign-out: the session may
 *   well be valid, so the user is offered a retry instead of a login form.
 */
export type SessionStatus =
  | "loading"
  | "authenticated"
  | "unauthenticated"
  | "unavailable";

/**
 * Why a session that existed in this tab is gone: the user logged out, or the
 * API refused it. `null` when no session has ended here — for example, a
 * visitor who arrived signed out.
 */
export type SignOutReason = "logout" | "rejected" | null;

interface SessionContextValue {
  status: SessionStatus;
  signOutReason: SignOutReason;
  login: (body: LoginRequest) => Promise<void>;
  register: (body: RegisterRequest) => Promise<void>;
  /** Creates an account by accepting an invitation, and signs it in. */
  registerWithInvitation: (body: RegisterWithInvitationRequest) => Promise<void>;
  /**
   * Replaces the signed-in user's password. The API answers with a new
   * session — every other one ends — which replaces this one in place.
   */
  changePassword: (body: ChangePasswordRequest) => Promise<void>;
  logout: () => Promise<void>;
  retry: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<SessionStatus>("loading");
  const [signOutReason, setSignOutReason] = useState<SignOutReason>(null);
  const [attempt, setAttempt] = useState(0);

  const loadCurrentUser = useCallback(
    () =>
      queryClient.fetchQuery({
        queryKey: queryKeys.me,
        queryFn: api.getCurrentUser,
      }),
    [queryClient],
  );

  // Restore the session. Strict Mode runs this twice in development; both
  // runs share one refresh request, because refreshSession is single-flight.
  useEffect(() => {
    let active = true;

    const restore = async () => {
      try {
        await refreshSession();
        await loadCurrentUser();

        if (active) setStatus("authenticated");
      } catch (error) {
        if (!active) return;

        setStatus(isApiError(error, 401) ? "unauthenticated" : "unavailable");
      }
    };

    void restore();

    return () => {
      active = false;
    };
  }, [attempt, loadCurrentUser]);

  // The API client ends the session when a refresh is refused. Whatever was
  // cached belonged to that session, so it goes too.
  useEffect(
    () =>
      onSessionEnded(() => {
        queryClient.clear();
        setSignOutReason("rejected");
        setStatus("unauthenticated");
      }),
    [queryClient],
  );

  const begin = useCallback(
    async (accessToken: string) => {
      // Nothing cached from an earlier identity may survive into this one.
      queryClient.clear();
      setAccessToken(accessToken);
      await loadCurrentUser();
      setSignOutReason(null);
      setStatus("authenticated");
    },
    [queryClient, loadCurrentUser],
  );

  const login = useCallback(
    async (body: LoginRequest) => {
      const response = await api.login(body);
      await begin(response.accessToken);
    },
    [begin],
  );

  const register = useCallback(
    async (body: RegisterRequest) => {
      const response = await api.register(body);
      await begin(response.accessToken);
    },
    [begin],
  );

  const registerWithInvitation = useCallback(
    async (body: RegisterWithInvitationRequest) => {
      const response = await api.registerWithInvitation(body);
      await begin(response.accessToken);
    },
    [begin],
  );

  const changePassword = useCallback(
    async (body: ChangePasswordRequest) => {
      const response = await api.changePassword(body);
      // The same identity, so nothing cached is foreign to it — but `me`
      // carried the old passwordChangeRequired, and must be read again.
      setAccessToken(response.accessToken);
      await queryClient.fetchQuery({
        queryKey: queryKeys.me,
        queryFn: api.getCurrentUser,
        // Always a fresh read: a cached `me` still says a change is required.
        staleTime: 0,
      });
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      // Local state goes regardless. If the request never reached the API the
      // cookie survives, and a reload would restore the session.
      clearAccessToken();
      queryClient.clear();
      setSignOutReason("logout");
      setStatus("unauthenticated");
    }
  }, [queryClient]);

  const retry = useCallback(() => {
    setStatus("loading");
    setAttempt((value) => value + 1);
  }, []);

  const value = useMemo(
    () => ({
      status,
      signOutReason,
      login,
      register,
      registerWithInvitation,
      changePassword,
      logout,
      retry,
    }),
    [
      status,
      signOutReason,
      login,
      register,
      registerWithInvitation,
      changePassword,
      logout,
      retry,
    ],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export const useSession = (): SessionContextValue => {
  const value = useContext(SessionContext);

  if (!value) {
    throw new Error("useSession must be used within a SessionProvider");
  }

  return value;
};

/** The signed-in user. Only meaningful while the session is authenticated. */
export const useCurrentUser = () => {
  const { status } = useSession();

  return useQuery<CurrentUserResponse>({
    queryKey: queryKeys.me,
    queryFn: api.getCurrentUser,
    enabled: status === "authenticated",
  });
};
