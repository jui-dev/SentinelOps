import { BookOpen, Check, Lock } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { INSTRUMENT } from "@/components/overview/analytical-view-header";

import { cx } from "./cx";

/** One step of setting an organization up, as a first run places itself. */
export interface SetupStep {
  name: string;
  text: string;
  state: "done" | "current" | "next";
}

/**
 * Where a page sits in setting an organization up: teams, then services,
 * each owned by a team, then the incidents declared against a service.
 * `current` is the page asking; what is already there is done.
 */
export const setupPath = (
  current: "teams" | "services" | "incidents",
  has: { teams: boolean; services: boolean },
): SetupStep[] => {
  const state = (step: "teams" | "services" | "incidents", done: boolean) =>
    step === current ? "current" : done ? "done" : "next";

  return [
    {
      name: "Teams",
      text: has.teams ? "Who responds to what — set up." : "Who responds to what.",
      state: state("teams", has.teams),
    },
    {
      name: "Services",
      text: has.services
        ? "The systems you run, each owned by a team — set up."
        : "The systems you run, each owned by a team.",
      state: state("services", has.services),
    },
    {
      name: "Incidents",
      text: "Declared against a service; the team that owns it responds.",
      state: state("incidents", false),
    },
  ];
};

function SetupPath({ steps }: { steps: SetupStep[] }) {
  return (
    <ol aria-label="Where this fits" className="flex flex-col">
      {steps.map((step, index) => (
        <li
          key={step.name}
          aria-current={step.state === "current" ? "step" : undefined}
          className="relative grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3 pb-4 last:pb-0"
        >
          {index < steps.length - 1 && (
            <span
              aria-hidden="true"
              className="absolute top-7 bottom-0.5 left-[0.8125rem] w-0.5 bg-line"
            />
          )}
          <span
            aria-hidden="true"
            className={cx(
              "relative grid size-7 place-items-center rounded-full border-[1.5px] text-xs font-bold",
              step.state === "done" &&
                "border-status-resolved-text bg-status-resolved-subtle text-status-resolved-text",
              step.state === "current" &&
                "border-accent-text bg-accent-subtle text-accent-text ring-4 ring-accent-subtle",
              step.state === "next" && "border-line bg-surface text-fg-subtle",
            )}
          >
            {step.state === "done" ? (
              <Check strokeWidth={3} className="size-3.5" />
            ) : (
              index + 1
            )}
          </span>
          <span className="flex flex-col">
            <span className="text-sm font-semibold text-fg">
              {step.name}
              {step.state === "current" && (
                <span className="font-normal text-fg-muted"> · you are here</span>
              )}
              {step.state === "done" && <span className="sr-only"> (done)</span>}
            </span>
            <span className="text-sm text-fg-muted">{step.text}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * A page with nothing on it yet, welcoming its first step rather than
 * apologising for an empty list: what it is for and why it matters, the one
 * action that starts it — offered only to whoever may take it; everyone
 * else is told who does — a way to how it fits in, and where it sits in
 * setting the organization up, with a glimpse of what the page will hold.
 *
 * Also what a page says when something must come first: its action is then
 * the way to that.
 */
export function FirstRun({
  icon: Icon,
  title,
  children,
  action,
  note,
  learn,
  steps,
  preview = true,
}: {
  icon: LucideIcon;
  title: string;
  /** Why it matters, in a sentence or two. */
  children: ReactNode;
  /** The one action that starts it, for whoever may take it. */
  action?: ReactNode;
  /** For everyone else: who does it. */
  note?: ReactNode;
  learn?: { href: string; label: string };
  steps?: SetupStep[];
  /** A faint glimpse of the list to come. Off where nothing is coming yet. */
  preview?: boolean;
}) {
  return (
    <section
      aria-label={title}
      className="rounded-lg border border-section-line bg-section-ground p-3 shadow-card sm:p-4"
    >
      <div
        className={cx(
          INSTRUMENT,
          "grid overflow-hidden",
          steps && "md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]",
        )}
      >
        <div className="flex flex-col items-start gap-3.5 px-6 py-7 sm:px-8 sm:py-8">
          <span
            aria-hidden="true"
            className="grid size-19 place-items-center rounded-full border-[1.5px] border-dashed border-line-strong"
          >
            <span className="grid size-13 place-items-center rounded-[0.875rem] bg-accent-subtle text-accent-text">
              <Icon strokeWidth={1.75} className="size-6" />
            </span>
          </span>
          <h2 className="text-[1.375rem] leading-7 font-semibold tracking-[-0.01em] text-fg">
            {title}
          </h2>
          <div className="max-w-[34rem] text-base leading-relaxed text-fg-muted">
            {children}
          </div>
          {note && (
            <p className="flex max-w-[34rem] items-start gap-2 text-sm text-fg-muted">
              <Lock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              <span>{note}</span>
            </p>
          )}
          {(action || learn) && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-1">
              {action}
              {learn && (
                <Link
                  href={learn.href}
                  className="inline-flex items-center gap-1.5 rounded-sm text-sm font-medium text-accent-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  <BookOpen aria-hidden="true" strokeWidth={1.75} className="size-4" />
                  {learn.label}
                </Link>
              )}
            </div>
          )}
        </div>
        {steps && (
          <div className="flex flex-col gap-3 border-t border-ink-line px-6 py-6 sm:px-7 md:border-t-0 md:border-l">
            <p className="label-caps text-fg-subtle">Where this fits</p>
            <SetupPath steps={steps} />
            {preview && (
              <div aria-hidden="true" className="mt-1 flex flex-col gap-2">
                <p className="label-caps text-fg-subtle">What it will look like</p>
                {[
                  ["w-[30%]", "w-[16%]"],
                  ["w-[24%]", "w-[20%]"],
                ].map(([first, second]) => (
                  <span
                    key={first}
                    className="flex h-9 items-center gap-2.5 rounded-md border-[1.5px] border-dashed border-line px-3"
                  >
                    <span className={cx("h-2 rounded-full bg-line", first)} />
                    <span className={cx("h-2 rounded-full bg-line", second)} />
                    <span className="ml-auto h-2 w-[12%] rounded-full bg-line" />
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
