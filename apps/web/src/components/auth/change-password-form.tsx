"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { SessionUnavailable } from "@/components/app/session-unavailable";
import { ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { PageSpinner } from "@/components/ui/spinner";
import { RequiredNote } from "@/components/ui/required";
import { fieldErrorsOf, isApiError } from "@/lib/api/errors";
import { useCurrentUser, useSession } from "@/lib/auth/session-provider";

import { AuthHeading } from "./auth-heading";

const MISMATCH = "The passwords do not match.";

const messageFor = (error: unknown): string | undefined => {
  if (!isApiError(error)) return undefined;
  if (error.details.length > 0) return "Please correct the highlighted fields.";

  return undefined;
};

/**
 * Replaces the signed-in user's password. Where someone who was given a
 * one-time password is sent before anything else — the API refuses them
 * every organization route until they have chosen their own — and usable by
 * anyone signed in who wants to change theirs.
 *
 * Handles its own session states rather than sitting behind RequireSession,
 * which would send a person on a one-time password straight back here.
 */
export function ChangePasswordForm() {
  const router = useRouter();
  const { status, changePassword, logout } = useSession();
  const me = useCurrentUser();
  const [error, setError] = useState<unknown>(null);
  const [mismatch, setMismatch] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [router, status]);

  if (status === "unavailable") return <SessionUnavailable />;
  if (status !== "authenticated" || !me.data) {
    return <PageSpinner size="panel" />;
  }

  const required = me.data.passwordChangeRequired;

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const newPassword = String(form.get("newPassword") ?? "");

    setError(null);

    if (newPassword !== String(form.get("confirmPassword") ?? "")) {
      setMismatch(true);
      return;
    }

    setMismatch(false);
    setSubmitting(true);

    try {
      await changePassword({
        currentPassword: String(form.get("currentPassword") ?? ""),
        newPassword,
      });
      router.replace("/");
    } catch (caught) {
      setError(caught);
      setSubmitting(false);
    }
  };

  const fields = fieldErrorsOf(error);

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <AuthHeading
        title={required ? "Choose your password" : "Change your password"}
        description={
          required
            ? `You signed in as ${me.data.email} with a one-time password. Choose your own to continue.`
            : "Every other device you are signed in on will be signed out."
        }
      />
      <RequiredNote />
      {error !== null && (
        <ErrorAlert error={error} message={messageFor(error)} />
      )}
      <Field
        size="lg"
        label={required ? "One-time password" : "Current password"}
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        required
        error={fields.currentPassword}
      />
      <Field
        size="lg"
        label="New password"
        name="newPassword"
        type="password"
        autoComplete="new-password"
        hint="At least 12 characters."
        required
        error={fields.newPassword}
      />
      <Field
        size="lg"
        label="Confirm new password"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        required
        error={mismatch ? MISMATCH : undefined}
      />
      <Button type="submit" size="lg" disabled={submitting}>
        {submitting ? "Saving…" : "Save password"}
      </Button>
      <div className="pt-1">
        <Button variant="quiet" size="sm" onClick={() => void logout()}>
          Log out instead
        </Button>
      </div>
    </form>
  );
}
