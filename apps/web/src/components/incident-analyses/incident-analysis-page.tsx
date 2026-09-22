"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import {
  IncidentNotFound,
  parseNumber,
} from "@/components/incidents/incident-detail";
import { incidentHref, useIncident } from "@/components/incidents/incident-queries";
import { incidentKey } from "@/components/incidents/severity";
import { useOrganization } from "@/components/organizations/organization-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { EmptyState } from "@/components/ui/empty-state";
import { linkClasses, quietLinkClasses } from "@/components/ui/link";
import { PageBody, PageHeader } from "@/components/ui/page";
import { RecordList, RecordRow } from "@/components/ui/record";
import { PageSpinner, Spinner } from "@/components/ui/spinner";
import { LocalDateTime } from "@/components/ui/timestamp";
import type {
  IncidentAnalysisResponse,
  IncidentDetailResponse,
} from "@/lib/api/contracts";
import { isApiError } from "@/lib/api/errors";

import { AnalysisDocument } from "./analysis-document";
import { useAnalysisAccess, useIncidentAnalysis } from "./analysis-queries";
import { AnalysisStatusMark } from "./analysis-status";
import { FactsStrip } from "./facts-strip";
import { KeyMoments } from "./key-moments";
import { StartAnalysis } from "./start-analysis";

/** Where the analysis stands, beneath its title: its status, then who wrote it. */
function StatusLine({ analysis }: { analysis: IncidentAnalysisResponse }) {
  const { isOwner } = useAnalysisAccess(analysis);
  const dot = (
    <>
      <span aria-hidden="true" className="text-fg-subtle">
        ·
      </span>
      <span className="sr-only">, </span>
    </>
  );

  // Published: the publication is the record's, so it leads; who owned the
  // draft and who started it follow, quieter.
  if (analysis.status === "PUBLISHED" && analysis.publishedAt) {
    return (
      <div className="flex flex-col gap-1 pt-1">
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-fg">
          <AnalysisStatusMark status="PUBLISHED" />
          {dot}
          <LocalDateTime value={analysis.publishedAt} />
          {analysis.publishedBy && (
            <>
              {dot}
              <span>
                by <span className="font-medium">{analysis.publishedBy.name}</span>
              </span>
            </>
          )}
        </p>
        <p className="flex flex-wrap items-center gap-x-2 text-sm text-fg-subtle">
          <span>Owner {analysis.owner.name}</span>
          {dot}
          <span>
            Started <LocalDateTime value={analysis.createdAt} /> by{" "}
            {analysis.createdBy.name}
          </span>
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 pt-1">
      <p className="flex flex-wrap items-center gap-x-2 text-sm text-fg-muted">
        <AnalysisStatusMark status="DRAFT" />
        {dot}
        <span>
          Owned by{" "}
          <span className="font-medium text-fg">{analysis.owner.name}</span>
          {isOwner && " (you)"}
        </span>
      </p>
      {!isOwner && (
        <p className="text-sm text-fg-muted">
          {analysis.owner.name} is writing this analysis. It may change until
          it is published.
        </p>
      )}
    </div>
  );
}

/**
 * The analysis as its page reads it: the incident's facts across the top;
 * the document in the main column; and beside it, from xl up, the moments
 * that shaped the incident and — for a draft — when it was started and last
 * changed. Below xl, one column: the document, then its context.
 */
function Workspace({
  analysis,
  incident,
}: {
  analysis: IncidentAnalysisResponse;
  incident: IncidentDetailResponse;
}) {
  const organization = useOrganization();

  return (
    <>
      <FactsStrip analysis={analysis} />
      <div className="grid items-start gap-x-10 gap-y-10 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <AnalysisDocument analysis={analysis} />
        <aside aria-label="Analysis context" className="flex min-w-0 flex-col gap-8">
          <KeyMoments
            analysis={analysis}
            timelineHref={`${incidentHref(organization.slug, incident.number)}#timeline`}
          />
          {analysis.status === "DRAFT" && (
            <RecordList tone="secondary" stacked>
              <RecordRow label="Started">
                <LocalDateTime value={analysis.createdAt} />
                <span className="mt-0.5 block">by {analysis.createdBy.name}</span>
              </RecordRow>
              <RecordRow label="Last changed">
                <LocalDateTime value={analysis.updatedAt} />
              </RecordRow>
            </RecordList>
          )}
        </aside>
      </div>
    </>
  );
}

function AnalysisBody({ incident }: { incident: IncidentDetailResponse }) {
  const organization = useOrganization();
  const analysis = useIncidentAnalysis(organization.id, incident.number);
  const { canStart } = useAnalysisAccess(analysis.data);
  const key = incidentKey(incident.number);

  return (
    <>
      <PageHeader
        eyebrow={
          <Link
            href={incidentHref(organization.slug, incident.number)}
            className={quietLinkClasses}
          >
            <span className="data">{key}</span>
            <span aria-hidden="true"> · </span>
            <span className="sr-only">, </span>
            {incident.title}
          </Link>
        }
        title="Incident analysis"
        description={analysis.data && <StatusLine analysis={analysis.data} />}
      />
      <PageBody>
        {analysis.isError ? (
          <ErrorAlert error={analysis.error} />
        ) : analysis.data === undefined ? (
          <Spinner label="Loading analysis…" />
        ) : analysis.data === null ? (
          <EmptyState
            title="No analysis yet"
            action={canStart && <StartAnalysis incident={incident} />}
          >
            <p>
              {canStart
                ? `Write up what happened in ${key}, its impact, cause, and lessons — SentinelOps brings the incident's facts and key moments.`
                : "No analysis has been started for this incident."}
            </p>
          </EmptyState>
        ) : (
          <Workspace analysis={analysis.data} incident={incident} />
        )}
      </PageBody>
    </>
  );
}

/** An incident that is still active: its analysis begins once it is resolved. */
function NotResolved({ incident }: { incident: IncidentDetailResponse }) {
  const organization = useOrganization();
  const key = incidentKey(incident.number);

  return (
    <PageBody width="form">
      <EmptyState
        className="mt-6"
        headingLevel={1}
        title="Incident analysis"
        action={
          <Link
            href={incidentHref(organization.slug, incident.number)}
            className={`text-sm ${linkClasses}`}
          >
            Go to {key}
          </Link>
        }
      >
        <p>
          An analysis begins once {key} is resolved. It is still being
          responded to.
        </p>
      </EmptyState>
    </PageBody>
  );
}

function LoadedIncident({ number }: { number: number }) {
  const organization = useOrganization();
  const incident = useIncident(organization.id, number);

  if (isApiError(incident.error, 404)) {
    return <IncidentNotFound orgSlug={organization.slug} />;
  }

  if (incident.isError) {
    return (
      <PageBody width="form">
        <ErrorAlert error={incident.error} />
      </PageBody>
    );
  }

  if (!incident.data) return <PageSpinner />;

  // Only a resolved incident's analysis is asked for: an active one has none.
  if (incident.data.status !== "RESOLVED") {
    return <NotResolved incident={incident.data} />;
  }

  return <AnalysisBody incident={incident.data} />;
}

/**
 * One incident's analysis, at `/incidents/[incidentNumber]/analysis`: a page
 * of its own beneath the incident, whose eyebrow leads back to it. Where the
 * analysis stands, the incident's facts and key moments, and the analysis
 * itself; starting one when there is none.
 */
export function IncidentAnalysisPage() {
  const organization = useOrganization();
  const { incidentNumber } = useParams<{ incidentNumber: string }>();
  const number = parseNumber(incidentNumber);

  if (number === undefined) {
    return <IncidentNotFound orgSlug={organization.slug} />;
  }

  return <LoadedIncident number={number} />;
}
