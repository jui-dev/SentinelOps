"use client";

import { CircleCheck, Layers, Siren, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { SEVERITY_LEVELS, SeverityGlyph } from "@/components/incidents/severity";
import { cx } from "@/components/ui/cx";
import type { IncidentSeverity, IncidentSummaryResponse } from "@/lib/api/contracts";

import type { CurrentOperationsState } from "./use-current-operations";
import { SUMMARY_DAYS } from "./use-current-operations";

/**
 * The organization's operational state in four figures: the first answer
 * the page gives, to "what is the state right now?".
 *
 * Each one is a count the API already answers — nothing here is derived
 * from a sample, estimated, or compared against a period it was not asked
 * for. Read left to right they are the shape of the situation: how much is
 * open, how much of the estate it touches, how many people are on it, and
 * how much has been closed lately.
 *
 * Figures only. Nothing is a link and nothing is actionable: what to do
 * about any of it is what the sections beneath are for.
 */

/**
 * Which vocabulary each card is drawn in — the vocabulary of what it
 * counts, so its colour says the same thing it says everywhere else:
 *
 *   active incidents   the worst active severity's signal; the nominal
 *                      signal when nothing is active
 *   services impacted  neutral, as service criticality always is
 *   responders active  the lifecycle's investigating blue
 *   resolved           the lifecycle's resolved green
 *
 * A figure of nought takes no colour: there is nothing for it to signal.
 * The one exception is nothing active, which is itself a state — all clear.
 *
 * Whole class strings, so the stylesheet finds every one of them.
 */
const FAMILIES = {
  critical: "[--family:var(--color-signal-critical)]",
  high: "[--family:var(--color-signal-high)]",
  caution: "[--family:var(--color-signal-caution)]",
  advisory: "[--family:var(--color-signal-advisory)]",
  nominal: "[--family:var(--color-signal-nominal)]",
  investigating: "[--family:var(--color-status-investigating-text)]",
  resolved: "[--family:var(--color-status-resolved-text)]",
  neutral: "[--family:var(--color-fg-muted)]",
} as const;

type Family = keyof typeof FAMILIES;

const SEVERITY_FAMILY: Record<IncidentSeverity, Family> = {
  SEV1: "critical",
  SEV2: "high",
  SEV3: "caution",
  SEV4: "advisory",
};

const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;

/**
 * The active severities in words, each after its own glyph — "▲ 1 major
 * ■ 2 moderate" — most severe first, leaving out the levels with none.
 * The glyphs are the severity vocabulary's, and what separates one count
 * from the next: no dots between them, so a line that wraps never starts
 * with one. Each count stays whole on its line.
 */
function SeverityMix({
  counts,
}: {
  counts: IncidentSummaryResponse["current"]["activeBySeverity"];
}) {
  const present = SEVERITY_LEVELS.filter(({ value }) => counts[value] > 0);

  return (
    <>
      {present.map(({ value, label }) => (
        <span
          key={value}
          className="inline-flex items-center gap-1 whitespace-nowrap"
        >
          <SeverityGlyph severity={value} />
          {counts[value]} {label.toLowerCase()}
        </span>
      ))}
    </>
  );
}

/** The card's frame: a trace of its family, and room for the icon's disc. */
const CARD =
  "relative flex min-h-[5.75rem] flex-col justify-center gap-0.5 rounded-lg border py-3.5 pr-4 pl-[4.25rem]";

/**
 * One figure: its icon, the number, what it counts, and one line of what
 * the number is made of.
 *
 * A `<div>` of a `<dl>`, the term before its values as the markup requires;
 * the number is drawn above its label, not read before it. The icon rides
 * in the term, hidden from assistive technology — the label names it.
 */
function Figure({
  label,
  value,
  context,
  description,
  family,
  Icon,
}: {
  label: string;
  value: number;
  /** One line under the label: what the figure is made of. */
  context: ReactNode;
  /** What exactly is counted, for screen readers. */
  description: string;
  family: Family;
  Icon: LucideIcon;
}) {
  return (
    <div data-family={family} className={cx(CARD, "tint-family", FAMILIES[family])}>
      <dt className="text-sm font-medium text-fg">
        <span
          aria-hidden="true"
          className="tint-family-disc absolute top-1/2 left-4 grid size-10 -translate-y-1/2 place-items-center rounded-full"
        >
          <Icon strokeWidth={2} className="size-[1.125rem]" />
        </span>
        {label}
      </dt>
      <dd className="numeric order-first text-[1.875rem] leading-9 font-semibold tracking-[-0.025em] text-fg">
        {value}
      </dd>
      <dd className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-xs text-fg-muted">
        {context}
      </dd>
      <dd className="sr-only">{description}</dd>
    </div>
  );
}

/** The four cards, labelled, with no figures in them yet. */
const LOADING: ReadonlyArray<{ label: string; Icon: LucideIcon }> = [
  { label: "Active incidents", Icon: Siren },
  { label: "Services impacted", Icon: Layers },
  { label: "Responders active", Icon: Users },
  { label: "Resolved incidents", Icon: CircleCheck },
];

const ROW = "grid gap-3 sm:grid-cols-2 xl:grid-cols-4";

/**
 * The row, once the summary has arrived.
 *
 * While it is still coming the cards are drawn in neutral, with their
 * labels and no figures, so the page beneath does not move when the
 * figures land. Nothing stands in for a number: a dash where a count goes
 * reads as a count.
 *
 * An error draws nothing at all. The same request feeds Current operations,
 * which says what went wrong — twice would be noise.
 */
export function OverviewSummary({ state }: { state: CurrentOperationsState }) {
  if (!state.data) {
    if (state.isError) return null;

    return (
      <div aria-busy="true" className={ROW}>
        {LOADING.map(({ label, Icon }) => (
          <div
            key={label}
            className={cx(CARD, "tint-family", FAMILIES.neutral)}
          >
            <span
              aria-hidden="true"
              className="tint-family-disc absolute top-1/2 left-4 grid size-10 -translate-y-1/2 place-items-center rounded-full"
            >
              <Icon strokeWidth={2} className="size-[1.125rem]" />
            </span>
            <p className="h-9" />
            <p className="text-sm font-medium text-fg-subtle">{label}</p>
            <p className="text-xs text-fg-subtle">Loading…</p>
          </div>
        ))}
      </div>
    );
  }

  const { active, activeBySeverity, affectedServices, responders, resolved } =
    state.data;
  const criticalServices = affectedServices.filter(
    ({ criticality }) => criticality === "CRITICAL",
  ).length;
  const worst = SEVERITY_LEVELS.find(({ value }) => activeBySeverity[value] > 0);

  return (
    <dl aria-label="Operational summary" className={ROW}>
      <Figure
        label="Active incidents"
        value={active}
        family={worst ? SEVERITY_FAMILY[worst.value] : "nominal"}
        Icon={Siren}
        context={
          active === 0 ? (
            "Nothing needs a response"
          ) : (
            <SeverityMix counts={activeBySeverity} />
          )
        }
        description="Incidents not yet resolved, whenever they were declared."
      />
      <Figure
        label="Services impacted"
        value={affectedServices.length}
        family="neutral"
        Icon={Layers}
        context={
          criticalServices > 0
            ? plural(criticalServices, "critical service")
            : "No critical service affected"
        }
        description="Services with at least one unresolved incident."
      />
      <Figure
        label="Responders active"
        value={responders.active}
        family={responders.active > 0 ? "investigating" : "neutral"}
        Icon={Users}
        context={
          responders.active === 0
            ? "No response under way"
            : `Across ${plural(responders.teams, "team")}`
        }
        description="Members whose own response is still under way, each counted once however many incidents they are on."
      />
      <Figure
        label="Resolved incidents"
        value={resolved}
        family={resolved > 0 ? "resolved" : "neutral"}
        Icon={CircleCheck}
        context={`Last ${SUMMARY_DAYS} days`}
        description={`Incidents resolved in the last ${SUMMARY_DAYS} whole UTC days, whenever they were declared.`}
      />
    </dl>
  );
}
