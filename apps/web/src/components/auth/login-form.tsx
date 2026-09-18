"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import type { FormEvent } from "react";

import { SessionUnavailable } from "@/components/app/session-unavailable";
import { Alert, ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { PageSpinner } from "@/components/ui/spinner";
import { ApiErrorCode } from "@/lib/api/contracts";
import { fieldErrorsOf, isApiError } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session-provider";
import { DEV_ACCOUNT, showDevAccount } from "@/lib/dev/dev-account";

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
 * TEMPORARY — the development account, shown in development only. Remove
 * with lib/dev/dev-account.ts.
 */
function DevAccountPanel({ onUse }: { onUse: () => void }) {
  return (
    <Alert tone="info" title="Development account">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
        <dt className="text-fg-muted">Email</dt>
        <dd className="data select-all">{DEV_ACCOUNT.email}</dd>
        <dt className="text-fg-muted">Password</dt>
        <dd className="data select-all">{DEV_ACCOUNT.password}</dd>
      </dl>
      <div className="pt-1">
        <Button variant="secondary" size="sm" onClick={onUse}>
          Use these
        </Button>
      </div>
    </Alert>
  );
}

export function LoginForm() {
  const { login } = useSession();
  const { status, next } = useAuthRedirect();
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  const fillDevAccount = () => {
    const form = formRef.current;

    if (!form) return;

    for (const [name, value] of Object.entries(DEV_ACCOUNT)) {
      const input = form.elements.namedItem(name);

      if (input instanceof HTMLInputElement) input.value = value;
    }
  };

  if (status === "unavailable") return <SessionUnavailable />;
  if (status !== "unauthenticated") return <PageSpinner size="panel" />;

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);

    setSubmitting(true);
    setError(null);

    try {
      await login({
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
      });
    } catch (caught) {
      setError(caught);
      setSubmitting(false);
    }
  };

  const fields = fieldErrorsOf(error);
  const registerHref = next
    ? `/register?next=${encodeURIComponent(next)}`
    : "/register";

  return (
    <form
      ref={formRef}
      onSubmit={onSubmit}
      noValidate
      className="flex flex-col gap-5"
    >
      <AuthHeading
        title="Log in"
        description="Sign in to your SentinelOps workspace."
      />
      {showDevAccount() && <DevAccountPanel onUse={fillDevAccount} />}
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
      <p className="border-t border-line-subtle pt-4 text-sm text-fg-muted">
        New to SentinelOps?{" "}
        <Link href={registerHref} className="font-medium text-accent-text underline-offset-2 hover:underline">
          Create an organization
        </Link>
      </p>
    </form>
  );
}
