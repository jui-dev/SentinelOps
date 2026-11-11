"use client";

import Link from "next/link";
import { useId } from "react";

import { incidentAnalysisHref } from "@/components/incident-analyses/analysis-queries";
import { incidentHref, useIncidentRepeats } from "@/components/incidents/incident-queries";
import { incidentKey, SeverityMark } from "@/components/incidents/severity";
import { useOrganization } from "@/components/organizations/organization-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { cx } from "@/components/ui/cx";
import { linkClasses } from "@/components/ui/link";
import { Spinner } from "@/components/ui/spinner";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { Duration, formatDuration, IsoDate } from "@/components/ui/timestamp";
import type {
  IncidentRepeatsResponse,
  IncidentResponse,
  IncidentSeverity,
} from "@/lib/api/contracts";

type Other = IncidentRepeatsResponse["others"][number];

const median = (values: number[]): number | undefined => {
  if (values.length === 0) return undefined;

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

const lasted = (other: Other) =>
  other.resolvedAt
    ? Date.parse(other.resolvedAt) - Date.parse(other.createdAt)
    : undefined;

/** "SEV1 3 times · SEV2 once", most severe first. */
const severities = (others: readonly Other[]) =>
  (["SEV1", "SEV2", "SEV3", "SEV4"] as IncidentSeverity[])
    .map((severity) => [severity, others.filter((o) => o.severity === severity).length] as const)
    .filter(([, count]) => count > 0)
    .map(([severity, count]) => `${severity} ${count === 1 ? "once" : `${count} times`}`)
    .join(" · ");

/** How often an incident's known issue has happened, for its header. */
export const timesOnRecord = (repeats: IncidentRepeatsResponse | undefined) =>
  repeats?.knownIssue ? repeats.others.length + repeats.hidden + 1 : undefined;

function Figure({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-4 py-3 sm:px-5">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="text-base font-semibold text-fg">{value}</dd>
    </div>
  );
}

/**
 * The other times this incident's known issue happened, before it: when
 * last, how long it usually lasted, at what severities, and which have an
 * analysis to learn from — then each one, newest first.
 *
 * Read-only, like the rest of an incident's record. Only what the reader may
 * see is listed; how many others there are beyond that is said, not shown.
 * A one-off has no known issue, and nothing here.
 */
export function HappenedBefore({ incident }: { incident: IncidentResponse }) {
  const organization = useOrganization();
  const headingId = useId();
  const repeats = useIncidentRepeats(
    organization.id,
    incident.number,
    incident.knownIssue !== null,
  );

  if (!incident.knownIssue) return null;
  if (repeats.isError) return <ErrorAlert error={repeats.error} />;
  if (!repeats.data) return <Spinner label="Loading when it happened before…" />;

  const declared = Date.parse(incident.createdAt);
  const earlier = repeats.data.others.filter((o) => Date.parse(o.createdAt) < declared);
  const since = repeats.data.others.length - earlier.length;
  const usual = median(earlier.map(lasted).filter((ms): ms is number => ms !== undefined));
  const resolved = earlier.filter((o) => o.resolvedAt).length;
  const analysed = earlier.filter((o) => o.analysisPublished).length;
  const notes = [
    since > 0 && `It has happened ${since === 1 ? "once" : `${since} times`} since.`,
    repeats.data.hidden > 0 &&
      `${repeats.data.hidden} more ${repeats.data.hidden === 1 ? "is" : "are"} on teams you are not on.`,
  ].filter(Boolean);

  return (
    <section
      id="happened-before"
      aria-labelledby={headingId}
      className="overflow-hidden rounded-2xl border border-line bg-surface"
    >
      <div className="flex flex-col gap-1 border-b border-line-subtle px-5 py-4 sm:px-6">
        <h2 id={headingId} className="text-base font-semibold text-fg">
          Happened before
        </h2>
        <p className="text-sm text-fg-muted">
          Known issue: {incident.knownIssue.name} ·{" "}
          {earlier.length === 0
            ? "this is the first time on record"
            : `${earlier.length} earlier ${earlier.length === 1 ? "time" : "times"} on ${incident.service.name}`}
        </p>
      </div>
      {earlier.length > 0 && (
        <>
          <dl
            aria-label="The earlier times at a glance"
            className="grid grid-cols-2 divide-line-subtle border-b border-line-subtle bg-sunken lg:grid-cols-4 lg:divide-x"
          >
            <Figure
              label="Last time"
              value={
                <>
                  <Duration from={earlier[0].createdAt} /> ago
                </>
              }
            />
            <Figure label="Usually lasts" value={usual === undefined ? "—" : formatDuration(usual)} />
            <Figure label="Severity before" value={severities(earlier)} />
            <Figure
              label="Analyses published"
              value={resolved === 0 ? "—" : `${analysed} of ${resolved}`}
            />
          </dl>
          <div className="overflow-x-auto">
            <Table label="Earlier times" variant="operational">
              <THead>
                <TR>
                  <TH>Severity</TH>
                  <TH>Incident</TH>
                  <TH className="hidden sm:table-cell">Declared</TH>
                  <TH className="hidden sm:table-cell">Lasted</TH>
                  <TH>Analysis</TH>
                </TR>
              </THead>
              <TBody>
                {earlier.map((other) => (
                  <TR key={other.number}>
                    <TD>
                      <SeverityMark severity={other.severity} />
                    </TD>
                    <TD>
                      <Link
                        href={incidentHref(organization.slug, other.number)}
                        className={cx("flex min-w-0 items-baseline gap-2", linkClasses)}
                      >
                        <span className="data shrink-0 text-fg-subtle">
                          {incidentKey(other.number)}
                        </span>
                        <span className="truncate">{other.title}</span>
                      </Link>
                    </TD>
                    <TD kind="data" className="hidden sm:table-cell">
                      <IsoDate value={other.createdAt} />
                    </TD>
                    <TD kind="data" className="hidden sm:table-cell">
                      {other.resolvedAt ? (
                        <Duration from={other.createdAt} to={other.resolvedAt} />
                      ) : (
                        <span className="text-warning-text">Still active</span>
                      )}
                    </TD>
                    <TD>
                      {other.analysisPublished ? (
                        <Link
                          href={incidentAnalysisHref(organization.slug, other.number)}
                          className={cx("text-sm", linkClasses)}
                        >
                          Read the analysis
                        </Link>
                      ) : (
                        <span className="text-sm text-fg-subtle">None published</span>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        </>
      )}
      {notes.length > 0 && (
        <p className="border-t border-line-subtle px-5 py-3 text-xs text-fg-muted sm:px-6">
          {notes.join(" ")}
        </p>
      )}
    </section>
  );
}

/**
 * Beside an incident's severity and status, when it is a known issue: how
 * often that has happened, counting this time, linking to the section that
 * says when.
 */
export function KnownIssueMark({ incident }: { incident: IncidentResponse }) {
  const organization = useOrganization();
  const repeats = useIncidentRepeats(
    organization.id,
    incident.number,
    incident.knownIssue !== null,
  );
  const times = timesOnRecord(repeats.data);

  if (!incident.knownIssue) return null;

  return (
    <a
      href="#happened-before"
      className="inline-flex items-center rounded-full border border-warning-line bg-warning-subtle px-2.5 py-0.5 text-xs font-medium text-warning-text hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      Known issue
      {times !== undefined && (times === 1 ? " · first time" : ` · happened ${times} times`)}
    </a>
  );
}
