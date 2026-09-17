"use client";

import Link from "next/link";
import { useState } from "react";
import type { FormEvent } from "react";

import { SessionUnavailable } from "@/components/app/session-unavailable";
import { ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { PageSpinner } from "@/components/ui/spinner";
import { ApiErrorCode } from "@/lib/api/contracts";
import { fieldErrorsOf, isApiError } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session-provider";

import { useAuthRedirect } from "./use-auth-redirect";

const messageFor = (error: unknown): string | undefined => {
  if (!isApiError(error)) return undefined;
  if (error.code === ApiErrorCode.INVALID_CREDENTIALS) {
    return "Incorrect email or password.";
  }
  if (error.details.length > 0) return "Please correct the highlighted fields.";

  return undefined;
};

export function LoginForm() {
  const { login } = useSession();
  const { status, next } = useAuthRedirect();
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === "unavailable") return <SessionUnavailable />;
  if (status !== "unauthenticated") return <PageSpinner />;

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
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Log in</h1>
      {error !== null && (
        <ErrorAlert error={error} message={messageFor(error)} />
      )}
      <Field
        label="Email"
        name="email"
        type="email"
        autoComplete="email"
        required
        error={fields.email}
      />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        error={fields.password}
      />
      <Button type="submit" disabled={submitting}>
        {submitting ? "Logging in…" : "Log in"}
      </Button>
      <p className="text-sm text-slate-600">
        New to SentinelOps?{" "}
        <Link href={registerHref} className="font-medium underline">
          Create an organization
        </Link>
      </p>
    </form>
  );
}
