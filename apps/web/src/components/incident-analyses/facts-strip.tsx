import { useId } from "react";
import type { ReactNode } from "react";

import { SeverityMark } from "@/components/incidents/severity";
import { cx } from "@/components/ui/cx";
import { formatDuration, LocalDateTime } from "@/components/ui/timestamp";
import type { IncidentAnalysisResponse } from "@/lib/api/contracts";

import { lasted, severityPath, toFirstResponse } from "./analysis-facts";

/** One cell of the strip: a small caps label over its reading. */
function Cell({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <dl className={cx("flex min-w-0 flex-col gap-1 bg-surface px-4 py-3 sm:px-5", className)}>
      <dt className="label-caps text-fg-subtle">{label}</dt>
      <dd className="flex min-w-0 flex-col gap-0.5">{children}</dd>
    </dl>
  );
}

/** A duration read at a glance: the strip's largest type. */
function Reading({ children }: { children: ReactNode }) {
  return (
    <span className="numeric text-2xl leading-8 font-semibold text-fg">
      {children}
    </span>
  );
}

function SeverityReading({
  severity,
}: {
  severity: IncidentAnalysisResponse["facts"]["severity"];
}) {
  const path = severityPath(severity);

  if ("throughout" in path) {
    return (
      <p className="flex flex-wrap items-baseline gap-x-2 pt-1.5 text-base">
        <SeverityMark severity={path.throughout} label emphasis />
        <span className="text-sm text-fg-muted">throughout</span>
      </p>
    );
  }

  return (
    <ol className="flex flex-wrap items-start gap-x-2 gap-y-2 pt-1.5">
      {path.steps.map((step, index) => (
        <li key={step.role} className="flex items-start gap-2">
          {index > 0 && (
            <span aria-hidden="true" className="pt-0.5 text-sm text-fg-subtle">
              →
            </span>
          )}
          <span className="flex flex-col gap-0.5">
            <SeverityMark severity={step.severity} emphasis className="text-base" />
            <span className="text-xs text-fg-muted">{step.role}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** A count, secondary: the number, then what it counts. */
function Count({ value, one, many }: { value: number; one: string; many: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dd className="numeric order-1 text-base font-semibold text-fg">{value}</dd>
      <dt className="order-2 text-sm text-fg-muted">{value === 1 ? one : many}</dt>
    </div>
  );
}

/**
 * What SentinelOps knew about the incident before anyone wrote a word: how
 * long it lasted, how long until someone responded, and how its severity
 * moved — read first — then how many responded, posted, and were moved
 * between teams, quieter. One strip of readings divided by hairlines, not a
 * row of cards: this is a document's instrument panel, not a dashboard.
 * When things happened is Key moments' to say.
 */
export function FactsStrip({
  analysis,
}: {
  analysis: IncidentAnalysisResponse;
}) {
  const headingId = useId();
  const { facts } = analysis;
  const firstResponse = toFirstResponse(facts);

  return (
    <section
      aria-labelledby={headingId}
      className="overflow-hidden rounded-md border border-line"
    >
      <h2 id={headingId} className="sr-only">
        Incident facts
      </h2>
      {/* The hairlines are the gaps, showing the line colour beneath. */}
      <div className="grid grid-cols-2 gap-px bg-line-subtle md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)] xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.75fr)_minmax(0,1fr)]">
        <Cell label="Lasted">
          <Reading>{formatDuration(lasted(facts))}</Reading>
          <span className="text-xs text-fg-muted">
            <LocalDateTime value={facts.declaredAt} />
            <span aria-hidden="true"> →</span>
            <span className="sr-only"> to </span>
            <span className="block">
              <LocalDateTime value={facts.resolvedAt} />
            </span>
          </span>
        </Cell>
        <Cell label="First response">
          <Reading>{firstResponse === null ? "—" : formatDuration(firstResponse)}</Reading>
          <span className="text-xs text-fg-muted">
            {firstResponse === null ? "None recorded" : "After declaration"}
          </span>
        </Cell>
        <Cell label="Severity" className="col-span-2 md:col-span-1">
          <SeverityReading severity={facts.severity} />
        </Cell>
        <div
          role="group"
          aria-label="Response counts"
          className="col-span-2 bg-surface px-4 py-3 sm:px-5 md:col-span-3 xl:col-span-1"
        >
          <dl className="flex flex-wrap gap-x-5 gap-y-1 xl:flex-col xl:pt-1">
            <Count value={facts.responderCount} one="responder" many="responders" />
            <Count value={facts.updateCount} one="update" many="updates" />
            <Count
              value={facts.reassignmentCount}
              one="reassignment"
              many="reassignments"
            />
          </dl>
        </div>
      </div>
    </section>
  );
}
