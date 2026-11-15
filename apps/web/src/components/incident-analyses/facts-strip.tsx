import { useId } from "react";
import type { ReactNode } from "react";

import { ChangeArrow } from "@/components/ui/change-arrow";
import { SeverityMark } from "@/components/incidents/severity";
import { cx } from "@/components/ui/cx";
import { formatDuration, LocalDateTime } from "@/components/ui/timestamp";
import type { IncidentAnalysisResponse } from "@/lib/api/contracts";

import { lasted, severityPath, toFirstResponse } from "./analysis-facts";

/** One fact card: a small caps label over its reading. */
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
    <dl
      className={cx(
        "flex min-w-0 flex-col gap-1 rounded-lg border border-line bg-linear-to-b from-surface to-sunken px-4 py-3.5",
        className,
      )}
    >
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
            <ChangeArrow className="mt-1" />
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
 * What SentinelOps knew about the incident before anyone wrote a word, as
 * "What the record says": how long it lasted, how long until someone
 * responded, how its severity moved, and the response in counts — four
 * cards in a dark section of their own, as the incident page holds its
 * facts. The key moments follow inside it, given as `children`: when things
 * happened is theirs to say.
 */
export function FactsStrip({
  analysis,
  children,
}: {
  analysis: IncidentAnalysisResponse;
  children?: ReactNode;
}) {
  const headingId = useId();
  const { facts } = analysis;
  const firstResponse = toFirstResponse(facts);

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-lg border border-line-subtle bg-linear-to-b from-band-top to-band-bottom p-3 sm:p-3.5"
    >
      <h2 id={headingId} className="label-caps px-1 pt-1 text-fg-subtle">
        What the record says
      </h2>
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <Cell label="Lasted">
          <Reading>{formatDuration(lasted(facts))}</Reading>
          <span className="text-xs text-fg-muted">
            <LocalDateTime value={facts.declaredAt} />
            {" "}
            <ChangeArrow />
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
        <Cell label="Severity">
          <SeverityReading severity={facts.severity} />
        </Cell>
        <div
          role="group"
          aria-label="Response counts"
          className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-line bg-linear-to-b from-surface to-sunken px-4 py-3.5"
        >
          <span aria-hidden="true" className="label-caps text-fg-subtle">
            The response
          </span>
          <dl className="flex flex-col gap-0.5">
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
      {children}
    </section>
  );
}
