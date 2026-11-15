"use client";

import { FormerMember } from "@/components/organizations/former-member";
import {
  ArrowRight,
  BookOpen,
  Check,
  FilePen,
  FilePenLine,
  FileText,
} from "lucide-react";
import { useId } from "react";
import type { ReactNode } from "react";

import { useOrganization } from "@/components/organizations/organization-scope";
import { INSTRUMENT } from "@/components/overview/analytical-view-header";
import { SectionIcon } from "@/components/overview/overview-panel";
import { ErrorAlert } from "@/components/ui/alert";

import { cx } from "@/components/ui/cx";
import { Spinner } from "@/components/ui/spinner";
import { LocalDateTime } from "@/components/ui/timestamp";
import { ANALYSIS_SECTIONS } from "@/lib/api/contracts";
import type {
  IncidentAnalysisResponse,
  IncidentDetailResponse,
} from "@/lib/api/contracts";

import { SECTION_TITLES } from "./analysis-document";
import {
  incidentAnalysisHref,
  useAnalysisAccess,
  useIncidentAnalysis,
} from "./analysis-queries";
import { AnalysisStatusMark } from "./analysis-status";
import { savedProgress } from "./draft-state";
import { PROGRESS_WORDS, SECTION_HINTS, SectionMark } from "./section-editor";
import { StartAnalysis } from "./start-analysis";
import { ButtonLink } from "@/components/ui/button-link";

/** How far a draft has come, as a bar; the words beside it say the same. */
function Progress({ done }: { done: number }) {
  return (
    <span
      aria-hidden="true"
      className="h-1.5 w-36 overflow-hidden rounded-full bg-line"
    >
      <span
        className="block h-full rounded-full bg-linear-to-r from-status-resolved-text to-status-investigating-text"
        style={{ width: `${(done / ANALYSIS_SECTIONS.length) * 100}%` }}
      />
    </span>
  );
}

/**
 * The four sections as a checklist: each one's name, whether it is required,
 * what it is for, and where it stands. The summary is the one a draft needs
 * to be published, so it says so — and, for whoever is writing, that it comes
 * first while it is missing.
 */
export function SectionChecklist({
  analysis,
  writing,
}: {
  analysis: IncidentAnalysisResponse | null;
  /** The caller writes this draft: the missing summary is theirs to do first. */
  writing: boolean;
}) {
  const progress = analysis ? savedProgress(analysis) : null;

  return (
    <ol aria-label="Analysis sections" className="divide-y divide-line-subtle">
      {ANALYSIS_SECTIONS.map((section, index) => {
        const standing = progress?.[section] ?? "not-started";
        const done = standing === "done";
        const required = section === "summary";
        const first = required && standing === "not-started" && writing;
        const amber = first || standing === "in-progress";

        return (
          <li
            key={section}
            className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-x-3.5 px-4 py-3"
          >
            <span
              aria-hidden="true"
              className={cx(
                "data grid size-6 place-items-center rounded-md border text-xs",
                done
                  ? "border-status-resolved-line bg-status-resolved-subtle text-status-resolved-text"
                  : amber
                    ? "border-warning-line text-warning-text"
                    : "border-line-strong text-fg-subtle",
              )}
            >
              {done ? <Check strokeWidth={3} className="size-3.5" /> : index + 1}
            </span>
            <span className="flex min-w-0 flex-col">
              <span className="text-sm">
                <span className="font-semibold text-fg">{SECTION_TITLES[section]}</span>{" "}
                <span
                  className={cx("text-xs", required ? "text-warning-text" : "text-fg-subtle")}
                >
                  {required ? "required to publish" : "optional"}
                </span>
              </span>
              <span className="truncate text-xs text-fg-muted">{SECTION_HINTS[section]}</span>
            </span>
            <span
              className={cx(
                "inline-flex items-center gap-1.5 text-xs whitespace-nowrap",
                done
                  ? "text-status-resolved-text"
                  : amber
                    ? "text-warning-text"
                    : "text-fg-subtle",
              )}
            >
              {standing !== "not-started" && (
                <SectionMark progress={standing} className="size-3" />
              )}
              {first ? "Write this first" : PROGRESS_WORDS[standing]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The way from a resolved incident to its analysis, and the Admin's next
 * step once it is resolved: start the analysis, carry on writing it, review
 * and publish it, and once published, read it. Its header says which, with
 * the one button that does it; beneath, the four sections as a checklist of
 * where each stands.
 *
 * Whoever cannot act on it — a member, while the Admin's draft is written —
 * sees where it stands, without the words "next step". Only for a resolved
 * incident, so only then is the analysis asked for. It shares its cache
 * entry with the analysis page, so the two always agree.
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
  const data = analysis.data;

  if (analysis.isError || data === undefined) {
    return (
      <section
        aria-labelledby={headingId}
        className="flex flex-col gap-3 rounded-lg border border-section-line bg-section-ground px-5 py-4 shadow-card sm:px-6"
      >
        <h2 id={headingId} className="text-lg leading-6 font-semibold text-fg">
          Incident analysis
        </h2>
        {analysis.isError ? (
          <ErrorAlert error={analysis.error} />
        ) : (
          <Spinner label="Loading analysis…" />
        )}
      </section>
    );
  }

  const link = (label: string, primary = true) => (
    <ButtonLink
      href={href}
      variant={primary ? "primary" : "view"}
      size="lg"
      icon={primary ? FilePen : BookOpen}
      trailingIcon={ArrowRight}
    >
      {label}
    </ButtonLink>
  );

  const published = data?.status === "PUBLISHED";
  const standings = data ? Object.values(savedProgress(data)) : [];
  const done = standings.filter((standing) => standing === "done").length;
  const inProgress = standings.filter((standing) => standing === "in-progress").length;
  const summaryDone = data?.doneSections.includes("summary") ?? false;
  // Whose move it is: the caller's, while there is something for them to do.
  const yours = data === null ? canStart : !published && canWrite;

  let headline: string;
  let meta: ReactNode;
  let action: ReactNode = null;

  if (data === null) {
    headline = canStart ? "Start the analysis." : "No analysis yet.";
    meta = canStart
      ? "Write up what happened while it's fresh. SentinelOps brings the incident's facts and key moments."
      : "The Admin starts one once an incident is resolved.";
    action = canStart && <StartAnalysis incident={incident} />;
  } else if (published) {
    headline = "Analysis published.";
    meta = data.publishedAt && (
      <>
        <LocalDateTime value={data.publishedAt} />
        {data.publishedBy && ` · by ${data.publishedBy.name}`}
      </>
    );
    action = link("Read analysis", false);
  } else {
    headline = !canWrite
      ? `Being written by ${data.owner.name}.`
      : summaryDone
        ? "Ready to publish."
        : "Write up what happened while it's fresh.";
    meta = (
      <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
        <Progress done={done} />
        <AnalysisStatusMark status={data.status} />
        <span>
          {done} of {ANALYSIS_SECTIONS.length} sections done
        </span>
        {inProgress > 0 && (
          <>
            <span aria-hidden="true">·</span>
            <span>{inProgress} in progress</span>
          </>
        )}
        <span aria-hidden="true">·</span>
        <span className="inline-flex items-center gap-1.5">
          owned by {isOwner ? "you" : data.owner.name}
          {data.owner.former && <FormerMember />}
        </span>
      </span>
    );
    action = canWrite
      ? link(summaryDone ? "Review and publish" : "Continue writing")
      : link("Read draft", false);
  }

  const Icon = published ? FileText : FilePenLine;
  const standing = data === null ? "Not started" : published ? "Published" : "Draft";

  // In the sections' frame, as Happened before and the Timeline beneath it.
  return (
    <section
      aria-labelledby={headingId}
      className="overflow-hidden rounded-lg border border-section-line bg-section-ground shadow-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-5 gap-y-3 border-b border-section-divider bg-section-head px-4 py-3 sm:px-5">
        <div className="flex min-w-0 flex-1 basis-72 items-start gap-3">
          <SectionIcon icon={Icon} family={published ? "resolved" : "decision"} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              {/* Read "Next step: Incident analysis"; seen as the name, then its pill. */}
              <h2
                id={headingId}
                className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-lg leading-6 font-semibold tracking-[-0.01em] text-fg"
              >
                {yours && (
                  <>
                  <span className="order-last inline-flex items-center rounded-full border border-accent-line bg-accent-subtle px-2 py-0.5 text-xs font-semibold tracking-normal text-accent-text">
                    Next step
                    <span className="sr-only">:</span>
                  </span>{" "}
                  </>
                )}
                Incident analysis
              </h2>
              <span
                className={cx(
                  "numeric inline-flex items-center rounded-full border border-line bg-surface px-2 py-0.5 text-xs font-medium",
                  published ? "text-status-resolved-text" : "text-fg-muted",
                )}
              >
                {standing}
                {data && !published && ` · ${done} of ${ANALYSIS_SECTIONS.length}`}
              </span>
            </div>
            <p className="text-sm font-medium text-fg">{headline}</p>
            {meta && <div className="text-xs text-fg-muted">{meta}</div>}
          </div>
        </div>
        {action && <div className="flex items-center pt-0.5">{action}</div>}
      </div>
      {((published && data?.summary) || (!published && (data !== null || canStart))) && (
        <div className="p-4 sm:p-5">
          <div className={cx(INSTRUMENT, "overflow-hidden")}>
            {published && data?.summary ? (
              <p className="line-clamp-3 px-4 py-3.5 text-sm leading-6 whitespace-pre-line text-fg-muted">
                {data.summary}
              </p>
            ) : (
              <SectionChecklist analysis={data} writing={yours} />
            )}
          </div>
        </div>
      )}
    </section>
  );
}
