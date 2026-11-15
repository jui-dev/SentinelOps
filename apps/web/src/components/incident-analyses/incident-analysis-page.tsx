"use client";

import { FormerMember } from "@/components/organizations/former-member";
import Link from "next/link";
import { useParams } from "next/navigation";
import { FilePenLine } from "lucide-react";
import { useState } from "react";

import {
  entityLinkClasses,
  Fact,
  IncidentNotFound,
  parseNumber,
} from "@/components/incidents/incident-detail";
import {
  incidentHref,
  incidentsHref,
  useIncident,
} from "@/components/incidents/incident-queries";
import { incidentKey } from "@/components/incidents/severity";
import { useOrganization } from "@/components/organizations/organization-scope";
import { INSTRUMENT } from "@/components/overview/analytical-view-header";
import { serviceHref } from "@/components/services/service-scope";
import { teamHref } from "@/components/teams/team-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { cx } from "@/components/ui/cx";
import { DetailCard } from "@/components/ui/detail-layout";
import { EmptyState } from "@/components/ui/empty-state";
import { linkClasses, quietLinkClasses } from "@/components/ui/link";
import { PageBody, PageHeader } from "@/components/ui/page";
import { PageSpinner, Spinner } from "@/components/ui/spinner";
import { LocalDateTime } from "@/components/ui/timestamp";
import { ANALYSIS_SECTIONS } from "@/lib/api/contracts";
import type {
  AnalysisSection,
  IncidentAnalysisResponse,
  IncidentDetailResponse,
} from "@/lib/api/contracts";
import { isApiError } from "@/lib/api/errors";

import { AnalysisDocument, sectionsInSentence, SECTION_TITLES } from "./analysis-document";
import { AnalysisEditor } from "./analysis-editor";
import { SectionChecklist } from "./analysis-entry";
import { useAnalysisAccess, useIncidentAnalysis } from "./analysis-queries";
import { savedProgress } from "./draft-state";
import type { SectionProgress } from "./draft-state";
import { AnalysisStatusMark } from "./analysis-status";
import { ChangeOwner } from "./change-owner";
import { UnsavedText } from "./draft-recovery";
import { FactsStrip } from "./facts-strip";
import { KeyMoments } from "./key-moments";
import { PublishOutcomeNotice } from "./publish-dialog";
import { PROGRESS_WORDS, sectionAnchor, SectionMark } from "./section-editor";
import type { PublishOutcome } from "./publish-dialog";
import { StartAnalysis } from "./start-analysis";
import { useAnalysisDraft } from "./use-analysis-draft";

/** Where the analysis stands, beneath its title: its status, then who wrote it. */
function StatusLine({
  analysis,
  incident,
}: {
  analysis: IncidentAnalysisResponse;
  incident: IncidentDetailResponse;
}) {
  const { isOwner, canWrite, canReassign } = useAnalysisAccess(analysis);
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
          <span className="inline-flex items-center gap-1.5">
            Owner {analysis.owner.name}
            {analysis.owner.former && <FormerMember />}
          </span>
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
      {/* A div, not a paragraph: the change of owner opens its dialog here. */}
      <div className="flex flex-wrap items-center gap-x-2 text-sm text-fg-muted">
        <AnalysisStatusMark status="DRAFT" />
        {dot}
        <span>
          Owned by{" "}
          <span className="font-medium text-fg">{analysis.owner.name}</span>
          {isOwner && " (you)"}
        </span>
        {canReassign && (
          <>
            {dot}
            <ChangeOwner analysis={analysis} incident={incident} />
          </>
        )}
      </div>
      {!isOwner && (
        <p className="text-sm text-fg-muted">
          {canWrite
            ? `You're editing ${analysis.owner.name}'s analysis as an admin.`
            : `${analysis.owner.name} is writing this analysis. It may change until it is published.`}
        </p>
      )}
      {/* When it was started and last changed: where a side column held it. */}
      <p className="flex flex-wrap items-center gap-x-2 text-xs text-fg-subtle">
        <span>
          Started <LocalDateTime value={analysis.createdAt} /> by {analysis.createdBy.name}
        </span>
        {dot}
        <span>
          Last changed <LocalDateTime value={analysis.updatedAt} />
        </span>
      </p>
    </div>
  );
}

const JUMP_LINK_CLASSES: Record<SectionProgress, string> = {
  done: "text-fg",
  "in-progress": "text-fg",
  "not-started": "text-fg-muted",
};

/** What the sections' standing means for publishing. */
const progressMessage = (progress: Record<AnalysisSection, SectionProgress>) => {
  const open = ANALYSIS_SECTIONS.filter((section) => progress[section] === "in-progress");

  if (ANALYSIS_SECTIONS.every((section) => progress[section] === "done")) {
    return "Every section is done. Publish it when it reads right.";
  }
  if (progress.summary === "done") {
    const said = "The summary is done, so this can be published.";

    return open.length > 0
      ? `${said} ${sectionsInSentence(open)} ${open.length === 1 ? "is" : "are"} still in progress.`
      : `${said} Impact, cause and lessons are optional.`;
  }

  return progress.summary === "in-progress"
    ? "Mark the summary as done when it is finished: it is all a draft needs to be published."
    : "Start with the summary: it is all a draft needs to be published.";
};

/**
 * How far the draft has come, read at a glance: a ring filled by the share
 * of its four sections marked done, what that means for publishing, and a
 * link to each section showing where it stands, so the writer can go
 * straight to what is left. Only a section its writer has finished counts.
 */
function DraftProgress({
  progress,
}: {
  progress: Record<AnalysisSection, SectionProgress>;
}) {
  const count = ANALYSIS_SECTIONS.filter((section) => progress[section] === "done").length;
  const share = (count / ANALYSIS_SECTIONS.length) * 100;

  return (
    <section
      aria-label="Progress"
      className="flex flex-wrap items-center gap-x-6 gap-y-4 rounded-lg border border-status-investigating-line bg-linear-to-r from-status-investigating-subtle to-surface px-5 py-4 sm:px-6"
    >
      <span
        role="img"
        aria-label={`${count} of ${ANALYSIS_SECTIONS.length} sections done`}
        className="grid size-18 shrink-0 place-items-center rounded-full"
        style={{
          background: `conic-gradient(var(--color-status-resolved-text) 0 ${share}%, var(--color-line) ${share}% 100%)`,
        }}
      >
        <span className="data grid size-14 place-items-center rounded-full bg-surface text-[0.9375rem] font-semibold text-fg">
          {count}/{ANALYSIS_SECTIONS.length}
        </span>
      </span>
      <div className="flex min-w-0 flex-1 basis-60 flex-col gap-1">
        <p className="text-base font-semibold text-fg">
          {count} of {ANALYSIS_SECTIONS.length} sections done
        </p>
        <p className="text-sm text-fg-muted">{progressMessage(progress)}</p>
      </div>
      {/* One track of links, as every set of choices is drawn; each
          section's mark says where it stands. */}
      <nav
        aria-label="Sections"
        className="inline-flex flex-wrap gap-0.5 rounded-lg border border-line bg-sunken p-0.5"
      >
        {ANALYSIS_SECTIONS.map((section) => (
          <a
            key={section}
            href={`#${sectionAnchor(section)}`}
            className={cx(
              "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-sm transition-colors duration-(--duration-fast) hover:bg-surface hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
              JUMP_LINK_CLASSES[progress[section]],
            )}
          >
            <SectionMark progress={progress[section]} className="size-3.5" />
            {SECTION_TITLES[section]}
            <span className="sr-only">, {PROGRESS_WORDS[progress[section]].toLowerCase()}</span>
          </a>
        ))}
      </nav>
    </section>
  );
}

/**
 * What the incident was about — the service it affected and the team
 * responsible — so the analysis reads on its own long after. Quieter than
 * the analysis's own status, in the incident header's own terms.
 */
function IncidentContext({ incident }: { incident: IncidentDetailResponse }) {
  const organization = useOrganization();

  return (
    <dl className="flex flex-wrap items-center gap-x-6 gap-y-1 pt-1">
      <Fact label="Service">
        <Link
          href={serviceHref(organization.slug, incident.service.slug)}
          className={entityLinkClasses}
        >
          {incident.service.name}
        </Link>
        {incident.service.archivedAt && (
          <span className="text-fg-muted"> (archived)</span>
        )}
      </Fact>
      <Fact label="Team">
        <Link
          href={teamHref(organization.slug, incident.team.slug)}
          className={entityLinkClasses}
        >
          {incident.team.name}
        </Link>
      </Fact>
    </dl>
  );
}

/**
 * The analysis as its page reads it — and, for whoever may write a draft,
 * writes it: the incident's facts across the top;
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
  const { canWrite } = useAnalysisAccess(analysis);
  const draft = useAnalysisDraft(analysis, incident.number);
  const editing = canWrite && analysis.status === "DRAFT";
  const [outcome, setOutcome] = useState<PublishOutcome | null>(null);
  const progress = editing ? draft.progress : savedProgress(analysis);

  // One column, read top to bottom: how far it has come, what the record
  // says and when things happened, then the document.
  return (
    <div className="flex flex-col gap-6">
      {analysis.status === "DRAFT" && <DraftProgress progress={progress} />}
      <FactsStrip analysis={analysis}>
        <KeyMoments
          analysis={analysis}
          timelineHref={`${incidentHref(organization.slug, incident.number)}#timeline`}
        />
      </FactsStrip>
      {editing ? (
        <AnalysisEditor
          draft={draft}
          incidentNumber={incident.number}
          onPublishOutcome={setOutcome}
        />
      ) : (
        <div className="flex min-w-0 flex-col gap-4">
          {outcome && <PublishOutcomeNotice outcome={outcome} analysis={analysis} />}
          {/* Text written here that can no longer be saved: kept to copy. */}
          {draft.unsaved && <UnsavedText analysis={analysis} draft={draft} />}
          <AnalysisDocument analysis={analysis} />
        </div>
      )}
    </div>
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
        width="reading"
        eyebrow={
          <nav aria-label="Breadcrumb">
            <ol className="flex items-center gap-2">
              <li>
                <Link href={incidentsHref(organization.slug)} className={quietLinkClasses}>
                  Incidents
                </Link>
              </li>
              <li aria-hidden="true" className="text-fg-subtle">
                /
              </li>
              <li>
                <Link
                  href={incidentHref(organization.slug, incident.number)}
                  className={quietLinkClasses}
                >
                  <span className="data">{key}</span>
                  <span className="sr-only">, {incident.title}</span>
                </Link>
              </li>
              <li aria-hidden="true" className="text-fg-subtle">
                /
              </li>
              <li aria-current="page" className="text-fg-muted">
                Analysis
              </li>
            </ol>
          </nav>
        }
        title={`Analysis of ${key}`}
        description={
          <div className="flex flex-col gap-2">
            <p className="text-sm text-fg-muted">{incident.title}</p>
            {analysis.data && (
              <>
                <StatusLine analysis={analysis.data} incident={incident} />
                <IncidentContext incident={incident} />
              </>
            )}
          </div>
        }
      />
      <PageBody width="reading">
        {analysis.isError ? (
          <ErrorAlert error={analysis.error} />
        ) : analysis.data === undefined ? (
          <Spinner label="Loading analysis…" />
        ) : analysis.data === null ? (
          // In the sections' frame, as on the incident's page: what is
          // missing, the one button that starts it, and the four sections
          // it will hold.
          <DetailCard
            id="no-analysis"
            title="No analysis yet"
            icon={FilePenLine}
            family="decision"
            description={
              canStart
                ? `Write up what happened in ${key}, its impact, cause, and lessons — SentinelOps brings the incident's facts and key moments.`
                : "No analysis has been started for this incident."
            }
            action={canStart && <StartAnalysis incident={incident} />}
          >
            <div className={cx(INSTRUMENT, "overflow-hidden")}>
              <SectionChecklist analysis={null} writing={canStart} />
            </div>
          </DetailCard>
        ) : (
          // Keyed by the analysis: nothing of one analysis's page state
          // carries into another's.
          <Workspace
            key={`${organization.id}:${incident.number}`}
            analysis={analysis.data}
            incident={incident}
          />
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
