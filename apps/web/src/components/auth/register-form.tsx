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

/** Conflicts the API reports by code, placed on the field they concern. */
const conflictFields = (error: unknown): Record<string, string> => {
  if (!isApiError(error, 409)) return {};
  if (error.code === ApiErrorCode.EMAIL_ALREADY_REGISTERED) {
    return { email: "This email is already registered." };
  }
  if (error.code === ApiErrorCode.ORGANIZATION_SLUG_TAKEN) {
    return { organizationSlug: "This URL name is already taken." };
  }

  return {};
};

export function RegisterForm() {
  const { register } = useSession();
  const { status, next } = useAuthRedirect();
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === "unavailable") return <SessionUnavailable />;
  if (status !== "unauthenticated") return <PageSpinner />;

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const slug = String(form.get("organizationSlug") ?? "").trim();

    setSubmitting(true);
    setError(null);

    try {
      await register({
        name: String(form.get("name") ?? ""),
        email: String(form.get("email") ?? ""),
        password: String(form.get("password") ?? ""),
        organizationName: String(form.get("organizationName") ?? ""),
        // Omitted when blank, so the API derives it from the name.
        ...(slug ? { organizationSlug: slug } : {}),
      });
    } catch (caught) {
      setError(caught);
      setSubmitting(false);
    }
  };

  const fields = { ...fieldErrorsOf(error), ...conflictFields(error) };
  const hasFieldErrors = Object.keys(fields).length > 0;
  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : "/login";

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Create your organization</h1>
      {error !== null && (
        <ErrorAlert
          error={error}
          message={
            hasFieldErrors ? "Please correct the highlighted fields." : undefined
          }
        />
      )}
      <Field
        label="Your name"
        name="name"
        autoComplete="name"
        required
        maxLength={100}
        error={fields.name}
      />
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
        autoComplete="new-password"
        required
        minLength={12}
        maxLength={128}
        hint="At least 12 characters. A long passphrase is best."
        error={fields.password}
      />
      <Field
        label="Organization name"
        name="organizationName"
        autoComplete="organization"
        required
        maxLength={100}
        error={fields.organizationName}
      />
      <Field
        label="Organization URL name (optional)"
        name="organizationSlug"
        hint="Lowercase letters, digits, and hyphens. Derived from the name if left blank."
        maxLength={48}
        error={fields.organizationSlug}
      />
      <Button type="submit" disabled={submitting}>
        {submitting ? "Creating…" : "Create organization"}
      </Button>
      <p className="text-sm text-slate-600">
        Already have an account?{" "}
        <Link href={loginHref} className="font-medium underline">
          Log in
        </Link>
      </p>
    </form>
  );
}
