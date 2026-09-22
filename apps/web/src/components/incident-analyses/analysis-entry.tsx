"use client";

import { FileText } from "lucide-react";
import Link from "next/link";
import { useId } from "react";
import type { ReactNode } from "react";

import { useOrganization } from "@/components/organizations/organization-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { LocalDateTime } from "@/components/ui/timestamp";
import type {
  IncidentAnalysisResponse,
  IncidentDetailResponse,
} from "@/lib/api/contracts";

import {
  incidentAnalysisHref,
  useAnalysisAccess,
  useIncidentAnalysis,
} from "./analysis-queries";
import { AnalysisStatusMark, sectionsWrittenLabel } from "./analysis-status";
import { StartAnalysis } from "./start-analysis";

/** What the entry says about an analysis, and the way into it. */
function describeAnalysis({
  analysis,
  canWrite,
  isOwner,
  href,
}: {
  analysis: IncidentAnalysisResponse;
  canWrite: boolean;
  isOwner: boolean;
  href: string;
}): { body: ReactNode; action: ReactNode } {
  const link = (label: string) => (
    <Link href={href} className={buttonClasses({ variant: "secondary" })}>
      {label}
    </Link>
  );

  if (analysis.status === "PUBLISHED" && analysis.publishedAt) {
    // The publication is the record's; who owned the draft is secondary.
    // The status mark above already says it is published.
    return {
      body: (
        <>
          <p className="text-sm text-fg">
            <LocalDateTime value={analysis.publishedAt} />
            {analysis.publishedBy && (
              <>
                <span aria-hidden="true"> · </span>
                <span className="sr-only">, </span>
                by{" "}
                <span className="font-medium">{analysis.publishedBy.name}</span>
              </>
            )}
          </p>
          {analysis.summary && (
            <p className="line-clamp-2 max-w-3xl text-sm leading-6 whitespace-pre-line text-fg-muted">
              {analysis.summary}
            </p>
          )}
          <p className="text-xs text-fg-subtle">
            Owner {analysis.owner.name}
          </p>
        </>
      ),
      action: link("Read analysis"),
    };
  }

  return {
    body: (
      <p className="text-sm text-fg-muted">
        Owned by{" "}
        <span className="font-medium text-fg">{analysis.owner.name}</span>
        {isOwner && " (you)"}
        <span aria-hidden="true"> · </span>
        <span className="sr-only">, </span>
        {sectionsWrittenLabel(analysis)}
      </p>
    ),
    action: link(canWrite ? "Open draft" : "Read draft"),
  };
}

/**
 * The way from a resolved incident to its analysis, beneath the resolution:
 * how the incident ended, then what was learned from it. Whether one exists,
 * where it stands, and what the caller may do — start one, write the draft,
 * or read it.
 *
 * Only for a resolved incident, so only then is the analysis asked for. It
 * shares its cache entry with the analysis page, so the two always agree.
 */
export function AnalysisEntry({
  incident,
}: {
  incident: IncidentDetailResponse;
}) {
  const organization = useOrganization();
  const headingId = useId();
  const analysis = useIncidentAnalysis(organization.id, incident.number);
  const { canStart, canWrite, isOwner } = useAnalysisAccess(analysis.data);
  const href = incidentAnalysisHref(organization.slug, incident.number);

  let body: ReactNode;
  let action: ReactNode = null;

  if (analysis.isError) {
    body = <ErrorAlert error={analysis.error} />;
  } else if (analysis.data === undefined) {
    body = <Spinner label="Loading analysis…" />;
  } else if (analysis.data === null) {
    body = (
      <p className="max-w-3xl text-sm text-fg-muted">
        {canStart
          ? "Not started. Write up what happened, its impact, cause, and lessons — SentinelOps brings the incident's facts and key moments."
          : "No analysis has been started for this incident."}
      </p>
    );
    action = canStart && <StartAnalysis incident={incident} />;
  } else {
    ({ body, action } = describeAnalysis({
      analysis: analysis.data,
      canWrite,
      isOwner,
      href,
    }));
  }

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-md border border-line bg-surface"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 px-4 py-4 sm:px-5">
        <div className="flex min-w-0 flex-1 basis-80 gap-3">
          <FileText
            aria-hidden="true"
            strokeWidth={2}
            className="mt-1 size-4 shrink-0 text-fg-subtle"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 id={headingId} className="text-base font-semibold text-fg">
                Incident analysis
              </h2>
              {analysis.data && (
                <AnalysisStatusMark
                  status={analysis.data.status}
                  className="text-sm"
                />
              )}
            </div>
            {body}
          </div>
        </div>
        {action && <div className="flex items-center">{action}</div>}
      </div>
    </section>
  );
}
