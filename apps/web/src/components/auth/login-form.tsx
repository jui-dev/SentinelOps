"use client";

import Link from "next/link";
import { useState } from "react";
import type { FormEvent } from "react";

import { SessionUnavailable } from "@/components/app/session-unavailable";
import { Alert, ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { PageSpinner } from "@/components/ui/spinner";
import { linkClasses } from "@/components/ui/link";
import { ApiErrorCode } from "@/lib/api/contracts";
import { fieldErrorsOf, isApiError } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session-provider";
import {
  DEV_PASSWORD,
  DEV_PERSONAS,
  showDevAccount,
} from "@/lib/dev/dev-account";

import { AuthHeading } from "./auth-heading";
import { useAuthRedirect } from "./use-auth-redirect";

const messageFor = (error: unknown): string | undefined => {
  if (!isApiError(error)) return undefined;
  if (error.code === ApiErrorCode.INVALID_CREDENTIALS) {
    return "Incorrect email or password.";
  }
  if (error.details.length > 0) return "Please correct the highlighted fields.";

  return undefined;
};

/**
 * TEMPORARY — the development personas, shown in development only: one click
 * signs in as any of them. Remove with lib/dev/dev-account.ts.
 */
function DevPersonasPanel({
  disabled,
  onSignIn,
}: {
  disabled: boolean;
  onSignIn: (email: string) => void;
}) {
  return (
    <Alert tone="info" title="Demo personas">
      <ul className="flex flex-col gap-1">
        {DEV_PERSONAS.map((persona) => (
          <li
            key={persona.email}
            className="flex items-center justify-between gap-3"
          >
            <span>
              {persona.name}
              <span className="text-fg-muted"> · {persona.label}</span>
            </span>
            <Button
              variant="secondary"
              size="sm"
              disabled={disabled}
              aria-label={`Sign in as ${persona.name}`}
              onClick={() => onSignIn(persona.email)}
            >
              Sign in
            </Button>
          </li>
        ))}
      </ul>
      <p className="pt-1 text-fg-muted">
        Password for all:{" "}
        <span className="data select-all">{DEV_PASSWORD}</span>
      </p>
    </Alert>
  );
}

export function LoginForm() {
  const { login } = useSession();
  const { status, next } = useAuthRedirect();
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === "unavailable") return <SessionUnavailable />;
  if (status !== "unauthenticated") return <PageSpinner size="panel" />;

  const signIn = async (email: string, password: string) => {
    setSubmitting(true);
    setError(null);

    try {
      await login({ email, password });
    } catch (caught) {
      setError(caught);
      setSubmitting(false);
    }
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    void signIn(
      String(form.get("email") ?? ""),
      String(form.get("password") ?? ""),
    );
  };

  const fields = fieldErrorsOf(error);
  const registerHref = next
    ? `/register?next=${encodeURIComponent(next)}`
    : "/register";

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <AuthHeading
        title="Log in"
        description="Sign in to your SentinelOps workspace."
      />
      {showDevAccount() && (
        <DevPersonasPanel
          disabled={submitting}
          onSignIn={(email) => void signIn(email, DEV_PASSWORD)}
        />
      )}
      {error !== null && (
        <ErrorAlert error={error} message={messageFor(error)} />
      )}
      <Field
        size="lg"
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        error={fields.email}
      />
      <Field
        size="lg"
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        error={fields.password}
      />
      <Button type="submit" size="lg" disabled={submitting}>
        {submitting ? "Logging in…" : "Log in"}
      </Button>
      <p className="pt-2 text-sm text-fg-muted">
        New to SentinelOps?{" "}
        <Link href={registerHref} className={linkClasses}>
          Create an organization
        </Link>
      </p>
    </form>
  );
}
