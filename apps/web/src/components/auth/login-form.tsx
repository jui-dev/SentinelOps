"use client";

import { Check, ChevronRight, Copy } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";

import { SessionUnavailable } from "@/components/app/session-unavailable";
import { initialsOf } from "@/components/app/shell-utilities";
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

// ── The demo roles ─────────────────────────────────────────────────────────

/** The roles in the order an incident needs them, the Admin behind them all. */
const STEPS: {
  step: string;
  name: string;
  role: Role;
  what: string;
}[] = [
  { step: "01", name: "Report", role: "REPORTER", what: "Declares what's wrong" },
  {
    step: "02",
    name: "Decide",
    role: "INCIDENT_MANAGER",
    what: "Confirms severity, picks who responds",
  },
  {
    step: "03",
    name: "Respond",
    role: "RESPONDER",
    what: "Fix their teams' incidents · land on My Operations",
  },
  {
    step: "Behind every step",
    name: "Set up",
    role: "ADMIN",
    what: "People, teams, services, roles",
  },
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
    <div className="flex h-10 items-center gap-2 rounded-lg border border-line-subtle bg-sunken pr-1 pl-3">
      <span className="text-xs text-fg-subtle">Password</span>
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
    </div>
  );
}

/**
 * TEMPORARY — the development personas, shown in development only: one click
 * signs in as any of them. Grouped by role along an incident's steps, each
 * saying where they land and what to try. Remove with lib/dev/dev-account.ts.
 */
function DemoRoles({
  disabled,
  onSignIn,
}: {
  disabled: boolean;
  onSignIn: (email: string) => void;
}) {
  return (
    <section
      aria-labelledby="demo-roles"
      className="flex flex-col gap-4 rounded-2xl border border-line-subtle bg-linear-to-b from-rail-top to-rail-mid p-5 sm:p-7"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex flex-col gap-1">
          <h2 id="demo-roles" className="text-lg font-semibold text-fg">
            Explore as a role
          </h2>
          <p className="text-sm text-fg-muted">
            In the order an incident needs them. One click signs you in.
          </p>
        </div>
        <DemoPassword />
      </div>

      <ol className="relative flex flex-col">
        {/* The flow, joining each role's icon to the next. */}
        <span
          aria-hidden="true"
          className="absolute top-8 bottom-8 left-[1.3125rem] w-0.5 bg-linear-to-b from-role-reporter-line via-role-responder-line to-role-admin-line"
        />
        {STEPS.map(({ step, name, role, what }) => {
          const meta = ROLE_META[role];
          const Icon = meta.icon;
          const people = DEV_PERSONAS.filter((persona) => persona.role === role);
          const one = people.length === 1;

          return (
            <li
              key={role}
              className="relative grid grid-cols-[2.75rem_minmax(0,1fr)] gap-4 py-3"
            >
              <span
                aria-hidden="true"
                className={cx(
                  "relative z-10 grid size-11 place-items-center rounded-xl border bg-rail-top ring-4 ring-rail-top",
                  meta.tone.line,
                  meta.tone.text,
                )}
              >
                <Icon strokeWidth={1.8} className="size-5" />
              </span>
              <div className="flex min-w-0 flex-col gap-2.5">
                <div className="flex min-h-11 flex-wrap items-center gap-x-2.5 gap-y-1">
                  <span className="numeric text-xs text-fg-subtle">{step}</span>
                  <span className="font-semibold text-fg">{name}</span>
                  <span
                    className={cx(
                      "inline-flex h-6 items-center rounded-full border px-2 text-xs font-semibold",
                      meta.tone.text,
                      meta.tone.subtle,
                      meta.tone.line,
                    )}
                  >
                    {one ? meta.label : meta.plural}
                  </span>
                  <span className="text-sm text-fg-muted">{what}</span>
                </div>
                <div className={cx("grid gap-1.5", !one && "sm:grid-cols-2")}>
                  {people.map((persona) => (
                    <button
                      key={persona.email}
                      type="button"
                      disabled={disabled}
                      aria-label={`Sign in as ${persona.name}`}
                      onClick={() => onSignIn(persona.email)}
                      className="flex min-h-13 w-full items-center gap-3 rounded-xl border border-line-subtle bg-sunken px-3 text-left transition-colors duration-(--duration-fast) hover:border-line-strong hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span
                        aria-hidden="true"
                        className="grid size-8 shrink-0 place-items-center rounded-full bg-hover text-xs font-semibold text-fg"
                      >
                        {initialsOf(persona.name)}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-sm font-semibold text-fg">
                          {persona.name}
                        </span>
                        <span className="truncate text-xs text-fg-subtle">
                          {persona.detail}
                        </span>
                      </span>
                      <span
                        aria-hidden="true"
                        className={cx(
                          "inline-flex h-8 shrink-0 items-center gap-0.5 rounded-lg border px-2.5 text-sm font-semibold",
                          meta.tone.text,
                          meta.tone.subtle,
                          meta.tone.line,
                        )}
                      >
                        {one && "Sign in"}
                        <ChevronRight className="size-4" />
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ── The page ───────────────────────────────────────────────────────────────

/**
 * The login page: one panel, headed by the product, holding the sign-in form
 * and — in development — the demo roles beside it. Creating an organization
 * is offered only while sign-up is switched on; otherwise the header says how
 * people join.
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
    <div className="overflow-hidden rounded-3xl border border-line-subtle bg-sunken shadow-[0_24px_64px_rgb(0_0_0/0.3)]">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4 border-b border-line-subtle bg-linear-to-r from-accent-subtle to-sunken to-65% px-5 py-5 sm:px-8">
        <div className="flex items-center gap-3.5">
          <span
            aria-hidden="true"
            className="grid size-11 shrink-0 place-items-center rounded-xl border border-accent-rim bg-accent text-on-accent"
          >
            <Mark className="size-6" />
          </span>
          <div className="flex flex-col gap-0.5">
            <p className="text-xl leading-tight font-bold tracking-[-0.015em] text-fg">
              Sentinel<span className="font-normal text-fg-muted">Ops</span>
            </p>
            <p className="text-sm text-fg-muted">
              Incident &amp; operations management · from the first report to
              what you learned
            </p>
          </div>
        </div>
        {env.registrationEnabled ? (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-fg-muted">
            New to SentinelOps?
            <Link
              href={registerHref}
              className="inline-flex h-9 items-center rounded-lg border border-accent-line bg-accent-subtle px-3.5 font-semibold text-accent-text hover:border-accent-rim focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              Create an organization
            </Link>
          </p>
        ) : (
          // Organizations are created by whoever runs SentinelOps; people join
          // one when its Admin adds them.
          <p className="text-sm text-fg-muted">
            Need an account? Ask your organization&apos;s Admin to add you.
          </p>
        )}
      </header>

      <div
        className={cx(
          "grid items-stretch gap-5 p-4 sm:p-6",
          demo ? "lg:grid-cols-[5fr_7fr]" : "mx-auto w-full max-w-lg",
        )}
      >
        <form
          onSubmit={onSubmit}
          noValidate
          className="flex flex-col gap-5 rounded-2xl border border-line-subtle bg-surface p-6 sm:p-8"
        >
          <AuthHeading
            title="Log in"
            description={
              demo
                ? "Sign in to your workspace, or explore as one of the demo roles."
                : "Sign in to your SentinelOps workspace."
            }
          />
          {error !== null && (
            <ErrorAlert error={error} message={messageFor(error)} />
          )}
          <Field
            size="lg"
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="name@company.com"
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
          {demo && (
            <p className="mt-auto border-t border-line-subtle pt-4 text-xs text-fg-subtle">
              Demo accounts appear in development only.
            </p>
          )}
        </form>
        {demo && (
          <DemoRoles
            disabled={submitting}
            onSignIn={(email) => void signIn(email, DEV_PASSWORD)}
          />
        )}
      </div>
    </div>
  );
}
