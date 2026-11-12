"use client";

import { Check, Copy } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { SessionUnavailable } from "@/components/app/session-unavailable";
import { Mark } from "@/components/app/wordmark";
import { ROLE_META } from "@/components/roles/role-meta";
import { ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { Field } from "@/components/ui/field";
import { PageSpinner } from "@/components/ui/spinner";
import { ApiErrorCode } from "@/lib/api/contracts";
import type { Role } from "@/lib/api/contracts";
import { fieldErrorsOf, isApiError } from "@/lib/api/errors";
import { useSession } from "@/lib/auth/session-provider";
import { env } from "@/lib/config/env";
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

// ── The demo accounts ──────────────────────────────────────────────────────

/** The roles in the order an incident needs them, the Admin behind them all. */
const DEMO_ROLES: Role[] = [
  "REPORTER",
  "INCIDENT_MANAGER",
  "RESPONDER",
  "ADMIN",
];

/** The shared demo password, with a button that copies it. */
function DemoPassword() {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;

    const timer = setTimeout(() => setCopied(false), 2000);

    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div className="flex items-center gap-2 text-xs text-fg-subtle">
      Password
      <span className="data text-sm text-fg select-all">{DEV_PASSWORD}</span>
      <button
        type="button"
        aria-label={copied ? "Copied" : "Copy the demo password"}
        onClick={() => {
          void navigator.clipboard
            ?.writeText(DEV_PASSWORD)
            .then(() => setCopied(true));
        }}
        className="grid size-8 place-items-center rounded-md text-fg-muted hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-focus"
      >
        {copied ? (
          <Check aria-hidden="true" className="size-4 text-success-text" />
        ) : (
          <Copy aria-hidden="true" className="size-4" />
        )}
      </button>
      <span className="flex-1 text-right">Development only</span>
    </div>
  );
}

/**
 * TEMPORARY — the development personas, shown in development only, grouped
 * by role along an incident's steps. Each person has their own Sign in
 * button, in their role's colour. Remove with lib/dev/dev-account.ts.
 */
function DemoAccounts({
  disabled,
  onSignIn,
}: {
  disabled: boolean;
  onSignIn: (email: string) => void;
}) {
  return (
    <section
      aria-labelledby="demo-accounts"
      className="flex flex-col gap-3.5 border-t border-line-subtle bg-sunken p-6 md:border-t-0 md:border-l"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="demo-accounts" className="font-semibold text-fg">
          Try a demo account
        </h2>
        <p className="text-xs text-fg-subtle">Pick a role to sign in</p>
      </div>

      {DEMO_ROLES.map((role) => {
        const meta = ROLE_META[role];
        const people = DEV_PERSONAS.filter((persona) => persona.role === role);
        const one = people.length === 1;
        // Who they are: the role's tagline, or for a Responder their teams.
        const about = (persona: (typeof people)[number]) =>
          "teams" in persona
            ? `${persona.teams.join(" & ")} ${persona.teams.length === 1 ? "team" : "teams"}`
            : meta.tagline;

        return (
          <div key={role} className="flex flex-col gap-1.5">
            <h3
              className={cx(
                "text-xs font-semibold tracking-[0.08em] uppercase",
                meta.tone.text,
              )}
            >
              {one ? meta.label : `${meta.plural} · ${people.length}`}
            </h3>
            {/* Many people (the Responders) scroll in a short box; the half
                row showing at its foot says there are more. Focusable, so the
                keyboard can scroll it too. */}
            <div
              {...(one
                ? {}
                : {
                    role: "region",
                    "aria-label": meta.plural,
                    tabIndex: 0,
                  })}
              className={cx(
                !one &&
                  "max-h-28 overflow-y-auto rounded-md pr-1 [scrollbar-width:thin] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
              )}
            >
              <ul className="flex flex-col gap-1.5">
                {people.map((persona) => (
                  <li
                    key={persona.email}
                    className="flex min-h-10 items-center gap-2.5 rounded-md border border-line-subtle bg-surface py-1 pr-1 pl-2.5"
                  >
                    <span className="truncate text-sm font-semibold text-fg">
                      {persona.name}
                    </span>
                    <span className="flex-1 truncate text-xs text-fg-subtle">
                      {about(persona)}
                    </span>
                    <button
                      type="button"
                      disabled={disabled}
                      aria-label={`Sign in as ${persona.name}`}
                      onClick={() => onSignIn(persona.email)}
                      className={cx(
                        "inline-flex h-8 shrink-0 items-center rounded-md border px-2.5 text-xs font-semibold transition-[filter] duration-(--duration-fast) hover:brightness-125 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-60",
                        meta.tone.text,
                        meta.tone.subtle,
                        meta.tone.line,
                      )}
                    >
                      Sign in
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        );
      })}

      <DemoPassword />
    </section>
  );
}

// ── The page ───────────────────────────────────────────────────────────────

/**
 * The login page: the product's name, then one compact card — the sign-in
 * form, and in development the demo accounts beside it. Creating an
 * organization is offered only while sign-up is switched on; otherwise the
 * form says how people join.
 */
export function LoginForm() {
  const { login } = useSession();
  const { status, next } = useAuthRedirect();
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === "unavailable") return <SessionUnavailable />;
  if (status !== "unauthenticated") return <PageSpinner size="panel" />;

  const demo = showDevAccount();

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
    <div className="flex w-full flex-col items-center gap-6">
      <div className="flex flex-col items-center gap-1.5 text-center">
        <p className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="grid size-8 shrink-0 place-items-center rounded-md border border-accent-rim bg-accent text-on-accent"
          >
            <Mark className="size-4.5" />
          </span>
          <span className="text-lg leading-tight font-bold tracking-[-0.01em] text-fg">
            Sentinel<span className="font-normal text-fg-muted">Ops</span>
          </span>
        </p>
        <p className="text-sm text-fg-muted">
          Incident &amp; operations management
        </p>
      </div>

      <div
        className={cx(
          "grid w-full overflow-hidden rounded-md border border-line-subtle bg-surface shadow-[0_16px_48px_rgb(0_0_0/0.3)]",
          demo ? "max-w-[55rem] md:grid-cols-2" : "max-w-md",
        )}
      >
        <form
          onSubmit={onSubmit}
          noValidate
          className="flex flex-col gap-4 p-6 sm:p-9"
        >
          <AuthHeading title="Log in" description="Sign in to your workspace." />
          {error !== null && (
            <ErrorAlert error={error} message={messageFor(error)} />
          )}
          <Field
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="name@company.com"
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
          <Button type="submit" size="lg" disabled={submitting}>
            {submitting ? "Logging in…" : "Log in"}
          </Button>
          <div className="mt-1 border-t border-line-subtle pt-4 text-sm text-fg-muted">
            {env.registrationEnabled ? (
              <p>
                New to SentinelOps?{" "}
                <Link
                  href={registerHref}
                  className="font-semibold text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  Create an organization
                </Link>
              </p>
            ) : (
              // Organizations are created by whoever runs SentinelOps; people
              // join one when its Admin adds them.
              <p>
                Need an account? Ask your organization&apos;s Admin to add you.
              </p>
            )}
          </div>
        </form>
        {demo && (
          <DemoAccounts
            disabled={submitting}
            onSignIn={(email) => void signIn(email, DEV_PASSWORD)}
          />
        )}
      </div>
    </div>
  );
}
