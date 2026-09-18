"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { FormEvent, ReactNode } from "react";

import { SessionUnavailable } from "@/components/app/session-unavailable";
import { formatDate, formatRole } from "@/components/organizations/format";
import { Alert, ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { ApiErrorCode } from "@/lib/api/contracts";
import type { InvitationLookupResponse } from "@/lib/api/contracts";
import { acceptInvitation, lookupInvitation } from "@/lib/api/endpoints";
import { fieldErrorsOf, isApiError } from "@/lib/api/errors";
import { queryKeys } from "@/lib/api/query-keys";
import { useCurrentUser, useSession } from "@/lib/auth/session-provider";

/**
 * The page an invitation link opens: `/invite#<token>`.
 *
 * The token is in the fragment, which a browser never sends to a server or
 * puts in a Referer. It is read here, held in memory, and sent only in the
 * body of a request to the API. It never enters storage, the query cache, a
 * query string, or a link — which is also why signing in happens on this page
 * rather than by a redirect through `/login?next=`.
 */

const subscribeToHash = (onChange: () => void) => {
  window.addEventListener("hashchange", onChange);

  return () => window.removeEventListener("hashchange", onChange);
};

/** The token in the fragment, or `null` when there is none. */
const readToken = (): string | null => {
  const raw = window.location.hash.slice(1);

  if (!raw) return null;

  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
};

/** `undefined` until the page is running in the browser. */
const useInvitationToken = (): string | null | undefined =>
  useSyncExternalStore(subscribeToHash, readToken, () => undefined);

type Lookup =
  | { state: "loading" }
  | { state: "ready"; invitation: InvitationLookupResponse }
  | { state: "failed"; error: unknown };

/**
 * The invitation a token names, in this component's own state rather than
 * the query cache. Two reasons: the token and what it unlocks stay out of any
 * shared cache, and signing in or registering — which clear that cache — do
 * not make the page look the now-accepted invitation up again.
 */
const useInvitationLookup = (token: string) => {
  const [lookup, setLookup] = useState<Lookup>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    lookupInvitation(token, controller.signal).then(
      (invitation) => setLookup({ state: "ready", invitation }),
      (error: unknown) => {
        if (!controller.signal.aborted) setLookup({ state: "failed", error });
      },
    );

    return () => controller.abort();
  }, [token, attempt]);

  const retry = () => {
    setLookup({ state: "loading" });
    setAttempt((value) => value + 1);
  };

  return { lookup, retry };
};

function InvalidInvitation() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Invitation not available</h1>
      <p className="text-sm text-slate-600">
        This invitation link is invalid, has expired, or is no longer active.
        Ask the person who invited you for a new link.
      </p>
      <Link href="/" className="text-sm font-medium underline">
        Go to SentinelOps
      </Link>
    </div>
  );
}

function Offer({
  invitation,
  children,
}: {
  invitation: InvitationLookupResponse;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">
          Join {invitation.organization.name}
        </h1>
        <p className="text-sm text-slate-600">
          {invitation.invitedBy.name} invited{" "}
          <span className="font-medium text-slate-900">
            {invitation.email}
          </span>{" "}
          to join as {formatRole(invitation.role)}. The invitation expires on{" "}
          {formatDate(invitation.expiresAt)}.
        </p>
      </div>
      {children}
    </div>
  );
}

const organizationHref = (invitation: InvitationLookupResponse) =>
  `/orgs/${encodeURIComponent(invitation.organization.slug)}`;

function CreateAccount({
  token,
  invitation,
  onJoining,
  onEmailTaken,
}: {
  token: string;
  invitation: InvitationLookupResponse;
  onJoining: (joining: boolean) => void;
  onEmailTaken: () => void;
}) {
  const router = useRouter();
  const { registerWithInvitation } = useSession();
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    setSubmitting(true);
    setError(null);
    onJoining(true);

    try {
      await registerWithInvitation({
        token,
        name: String(form.get("name") ?? ""),
        password: String(form.get("password") ?? ""),
      });
      router.push(organizationHref(invitation));
    } catch (caught) {
      onJoining(false);
      setSubmitting(false);

      if (
        isApiError(caught, 409) &&
        caught.code === ApiErrorCode.EMAIL_ALREADY_REGISTERED
      ) {
        onEmailTaken();
        return;
      }

      setError(caught);
    }
  };

  const fields = fieldErrorsOf(error);

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {error !== null && (
        <ErrorAlert
          error={error}
          message={
            isApiError(error, 404)
              ? "This invitation is no longer active. Ask for a new link."
              : Object.keys(fields).length > 0
                ? "Please correct the highlighted fields."
                : undefined
          }
        />
      )}
      <Field label="Email" name="email" value={invitation.email} readOnly />
      <Field
        label="Your name"
        name="name"
        autoComplete="name"
        required
        maxLength={100}
        error={fields.name}
      />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={12}
        maxLength={128}
        hint="At least 12 characters. A long passphrase is best."
        error={fields.password}
      />
      <Button type="submit" disabled={submitting}>
        {submitting ? "Creating account…" : "Create account and join"}
      </Button>
    </form>
  );
}

function SignIn({
  invitation,
  notice,
}: {
  invitation: InvitationLookupResponse;
  notice?: string;
}) {
  const { login } = useSession();
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    setSubmitting(true);
    setError(null);

    try {
      // No redirect: once signed in, this page offers to join.
      await login({
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
      });
    } catch (caught) {
      setError(caught);
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      {notice && <Alert tone="info">{notice}</Alert>}
      {error !== null && (
        <ErrorAlert
          error={error}
          message={
            isApiError(error) &&
            error.code === ApiErrorCode.INVALID_CREDENTIALS
              ? "Incorrect email or password."
              : undefined
          }
        />
      )}
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        defaultValue={invitation.email}
        required
      />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
      <Button type="submit" disabled={submitting}>
        {submitting ? "Logging in…" : "Log in"}
      </Button>
    </form>
  );
}

function SignedOut({
  token,
  invitation,
  onJoining,
}: {
  token: string;
  invitation: InvitationLookupResponse;
  onJoining: (joining: boolean) => void;
}) {
  const [mode, setMode] = useState<"create" | "sign-in">("create");
  const [notice, setNotice] = useState<string>();

  const tab = (value: typeof mode, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === value}
      onClick={() => {
        setMode(value);
        setNotice(undefined);
      }}
      className={`-mb-px border-b-2 px-3 py-2 text-sm ${
        mode === value
          ? "border-slate-900 font-medium text-slate-900"
          : "border-transparent text-slate-600 hover:text-slate-900"
      }`}
    >
      {label}
    </button>
  );

  return (
    <>
      <div role="tablist" className="flex gap-1 border-b border-slate-200">
        {tab("create", "Create an account")}
        {tab("sign-in", "I have an account")}
      </div>
      {mode === "create" ? (
        <CreateAccount
          token={token}
          invitation={invitation}
          onJoining={onJoining}
          onEmailTaken={() => {
            setMode("sign-in");
            setNotice(
              "An account already exists for this email. Log in to accept the invitation.",
            );
          }}
        />
      ) : (
        <SignIn invitation={invitation} notice={notice} />
      )}
    </>
  );
}

function Join({
  token,
  invitation,
  onJoining,
}: {
  token: string;
  invitation: InvitationLookupResponse;
  onJoining: (joining: boolean) => void;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const accept = useMutation({
    mutationFn: () => acceptInvitation(token),
    onSuccess: async () => {
      onJoining(true);
      // The organization scope resolves slugs from `me`, so it must list the
      // new membership before the organization opens.
      await queryClient.refetchQueries({ queryKey: queryKeys.me, exact: true });
      router.push(organizationHref(invitation));
    },
  });

  if (
    isApiError(accept.error, 409) &&
    accept.error.code === ApiErrorCode.ALREADY_A_MEMBER
  ) {
    return (
      <Alert tone="info">
        You are already a member of {invitation.organization.name}.{" "}
        <Link
          href={organizationHref(invitation)}
          className="font-medium underline"
        >
          Open it
        </Link>
      </Alert>
    );
  }

  if (isApiError(accept.error, 404)) return <InvalidInvitation />;

  return (
    <div className="flex flex-col gap-3">
      {accept.isError && <ErrorAlert error={accept.error} />}
      <Button onClick={() => accept.mutate()} disabled={accept.isPending}>
        {accept.isPending ? "Joining…" : `Join ${invitation.organization.name}`}
      </Button>
    </div>
  );
}

function WrongAccount({
  invitation,
  signedInAs,
}: {
  invitation: InvitationLookupResponse;
  signedInAs: string;
}) {
  const { logout } = useSession();
  const [signingOut, setSigningOut] = useState(false);

  const onLogout = async () => {
    setSigningOut(true);

    try {
      await logout();
    } catch {
      // Local state is cleared regardless; this page then offers sign-in.
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <Alert tone="info">
        This invitation is for{" "}
        <span className="font-medium">{invitation.email}</span>, but you are
        signed in as <span className="font-medium">{signedInAs}</span>. Log out
        and sign in with the invited address to accept it.
      </Alert>
      <div>
        <Button variant="secondary" onClick={onLogout} disabled={signingOut}>
          {signingOut ? "Logging out…" : "Log out"}
        </Button>
      </div>
    </div>
  );
}

function SignedIn({
  token,
  invitation,
  onJoining,
}: {
  token: string;
  invitation: InvitationLookupResponse;
  onJoining: (joining: boolean) => void;
}) {
  const me = useCurrentUser();

  if (me.isError) return <ErrorAlert error={me.error} />;
  if (!me.data) return <Spinner />;

  return me.data.email === invitation.email ? (
    <Join token={token} invitation={invitation} onJoining={onJoining} />
  ) : (
    <WrongAccount invitation={invitation} signedInAs={me.data.email} />
  );
}

function InvitationForToken({ token }: { token: string }) {
  const { status } = useSession();
  const { lookup, retry } = useInvitationLookup(token);
  // Set while an acceptance is under way. It only takes effect once the
  // session is authenticated — the moment the organization is about to open —
  // so a form that fails before then stays mounted and shows why.
  const [joining, setJoining] = useState(false);

  if (joining && status === "authenticated") {
    return <Spinner label="Opening your organization…" />;
  }

  if (lookup.state === "failed") {
    return isApiError(lookup.error, 404) ? (
      <InvalidInvitation />
    ) : (
      <div className="flex flex-col gap-3">
        <ErrorAlert error={lookup.error} />
        <div>
          <Button variant="secondary" onClick={retry}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (lookup.state === "loading" || status === "loading") return <Spinner />;
  if (status === "unavailable") return <SessionUnavailable />;

  const { invitation } = lookup;

  return (
    <Offer invitation={invitation}>
      {status === "unauthenticated" ? (
        <SignedOut
          token={token}
          invitation={invitation}
          onJoining={setJoining}
        />
      ) : (
        <SignedIn token={token} invitation={invitation} onJoining={setJoining} />
      )}
    </Offer>
  );
}

export function InvitationAcceptance() {
  const token = useInvitationToken();

  if (token === undefined) return <Spinner />;
  if (token === null) return <InvalidInvitation />;

  // Keyed, so a different token in the fragment starts from nothing.
  return <InvitationForToken key={token} token={token} />;
}
