"use client";

import { Check, FilePenLine, FileText } from "lucide-react";
import Link from "next/link";
import { useId } from "react";
import type { ReactNode } from "react";

import { useOrganization } from "@/components/organizations/organization-scope";
import { ErrorAlert } from "@/components/ui/alert";
import { buttonClasses } from "@/components/ui/button";
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
function SectionChecklist({
  analysis,
  writing,
}: {
  analysis: IncidentAnalysisResponse | null;
  /** The caller writes this draft: the missing summary is theirs to do first. */
  writing: boolean;
}) {
  const progress = analysis ? savedProgress(analysis) : null;

  return (
    <ol aria-label="Analysis sections" className="divide-y divide-line-subtle border-t border-line-subtle">
      {ANALYSIS_SECTIONS.map((section, index) => {
        const standing = progress?.[section] ?? "not-started";
        const done = standing === "done";
        const required = section === "summary";
        const first = required && standing === "not-started" && writing;
        const amber = first || standing === "in-progress";

        return (
          <li
            key={section}
            className="grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-x-3.5 px-5 py-3 sm:px-6"
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
        className="flex flex-col gap-3 rounded-lg border border-line bg-surface px-5 py-4.5 sm:px-6"
      >
        <h2 id={headingId} className="label-caps text-fg-subtle">
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
    <Link
      href={href}
      className={buttonClasses({ variant: primary ? "primary" : "secondary", size: "lg" })}
    >
      {label}
      <span aria-hidden="true">→</span>
    </Link>
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
        <span>owned by {isOwner ? "you" : data.owner.name}</span>
      </span>
    );
    action = canWrite
      ? link(summaryDone ? "Review and publish" : "Continue writing")
      : link("Read draft", false);
  }

  const Icon = published ? FileText : FilePenLine;

  return (
    <section
      aria-labelledby={headingId}
      className={cx(
        "overflow-hidden rounded-lg border",
        published
          ? "border-status-resolved-line bg-status-resolved-subtle/40"
          : "border-status-investigating-line bg-surface",
      )}
    >
      <div
        className={cx(
          "flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4.5 sm:px-6",
          !published &&
            "bg-linear-to-r from-status-investigating-subtle to-transparent",
        )}
      >
        <span
          aria-hidden="true"
          className={cx(
            "grid size-11 shrink-0 place-items-center rounded-lg border",
            published
              ? "border-status-resolved-line bg-status-resolved-subtle text-status-resolved-text"
              : "border-status-investigating-line bg-status-investigating-subtle text-status-investigating-text",
          )}
        >
          <Icon strokeWidth={2} className="size-5" />
        </span>
        <div className="flex min-w-0 flex-1 basis-72 flex-col gap-1">
          {/* The card's name stays "Incident analysis"; whose move it is, before it. */}
          <h2
            id={headingId}
            className={cx(
              "label-caps",
              published ? "text-status-resolved-text" : "text-status-investigating-text",
            )}
          >
            {yours && (
              <>
                Next step <span aria-hidden="true">·</span>
                <span className="sr-only">:</span>{" "}
              </>
            )}
            Incident analysis
          </h2>
          <p className="text-[1.0625rem] font-semibold text-fg">{headline}</p>
          {meta && <div className="text-xs text-fg-muted">{meta}</div>}
        </div>
        {action && <div className="flex items-center">{action}</div>}
      </div>
      {published && data?.summary && (
        <p className="line-clamp-2 border-t border-status-resolved-line/60 px-5 py-3.5 text-sm leading-6 whitespace-pre-line text-fg-muted sm:px-6">
          {data.summary}
        </p>
      )}
      {!published && (data !== null || canStart) && (
        <SectionChecklist analysis={data} writing={yours} />
      )}
    </section>
  );
}
