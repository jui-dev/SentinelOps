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

import { useAnalysisAccess, useIncidentAnalysis } from "./analysis-queries";
import { AnalysisStatusMark, sectionsWrittenLabel } from "./analysis-status";
import { StartAnalysis } from "./start-analysis";

/** A moment and who made it: "Sep 22, 2026, 2:10 PM", then "by Alex Kim". */
function Attributed({ at, by }: { at: string; by?: string }) {
  return (
    <>
      <LocalDateTime value={at} />
      {by && (
        <span className="mt-0.5 block text-sm text-fg-muted">by {by}</span>
      )}
    </>
  );
}

/**
 * The analysis's record. Once published, the publication leads: it is the
 * final record's. The owner — who was accountable for the draft — follows.
 */
function AnalysisRecord({ analysis }: { analysis: IncidentAnalysisResponse }) {
  const published = analysis.status === "PUBLISHED" && analysis.publishedAt;

  return (
    <RecordList className="max-w-3xl">
      {published && (
        <RecordRow label="Published">
          <Attributed
            at={analysis.publishedAt!}
            by={analysis.publishedBy?.name}
          />
        </RecordRow>
      )}
      <RecordRow label="Owner">{analysis.owner.name}</RecordRow>
      <RecordRow label="Started">
        <Attributed at={analysis.createdAt} by={analysis.createdBy.name} />
      </RecordRow>
      <RecordRow label="Sections">{sectionsWrittenLabel(analysis)}</RecordRow>
    </RecordList>
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
        description={
          analysis.data && (
            <p className="pt-1 text-sm">
              <AnalysisStatusMark status={analysis.data.status} />
            </p>
          )
        }
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
          <AnalysisRecord analysis={analysis.data} />
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
 * analysis stands, and its record; starting one when there is none.
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
