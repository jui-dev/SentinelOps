"use client";

import {
  ArrowLeft,
  KeyRound,
  LogOut,
  X,
} from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { SessionUnavailable } from "@/components/app/session-unavailable";
import { Alert, ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { PageSpinner } from "@/components/ui/spinner";
import { RequiredNote } from "@/components/ui/required";
import { fieldErrorsOf, isApiError } from "@/lib/api/errors";
import { useCurrentUser, useSession } from "@/lib/auth/session-provider";

import { AuthHeading } from "./auth-heading";

const MISMATCH = "The passwords do not match.";

/**
 * Where to go back to, from `?from=`. Only a path inside this app is
 * accepted — `//host` and `/\host` would leave it — so the link can never
 * send anyone to another site.
 */
export const returnPathOf = (from: string | null): string =>
  from && from.startsWith("/") && !from.startsWith("//") && !from.startsWith("/\\")
    ? from
    : "/";

/** The page's address for someone who chose to change their password here. */
export const changePasswordHref = (from: string): string =>
  `/change-password?from=${encodeURIComponent(from)}`;

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
  const returnPath = returnPathOf(useSearchParams().get("from"));
  const [error, setError] = useState<unknown>(null);
  const [mismatch, setMismatch] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/login");
  }, [router, status]);

  if (status === "unavailable") return <SessionUnavailable />;
  if (status !== "authenticated" || !me.data) {
    return <PageSpinner size="panel" />;
  }

  const required = me.data.passwordChangeRequired;

  if (changed) {
    return (
      <div className="flex flex-col gap-5">
        <AuthHeading title="Password changed" />
        <Alert tone="success" title="Your new password is saved.">
          <p>Every other device you were signed in on has been signed out.</p>
        </Alert>
        <Button icon={ArrowLeft} size="lg" onClick={() => router.replace(returnPath)}>
          Back to work
        </Button>
      </div>
    );
  }

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
      // Someone on a one-time password goes straight on into the app; anyone
      // who came here by choice is told it worked before going back.
      if (required) {
        router.replace("/");
      } else {
        setChanged(true);
        setSubmitting(false);
      }
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
      <Button icon={KeyRound} type="submit" size="lg" disabled={submitting}>
        {submitting ? "Saving…" : "Save password"}
      </Button>
      <div className="pt-1">
        {required ? (
          <Button icon={LogOut} variant="secondary" size="sm" onClick={() => void logout()}>
            Log out instead
          </Button>
        ) : (
          <Button icon={X}
            variant="secondary"
            size="sm"
            onClick={() => router.replace(returnPath)}
          >
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
