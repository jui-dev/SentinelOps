"use client";

import { useEffect, useRef, useState } from "react";

import { incidentKey } from "@/components/incidents/severity";
import { useOrganization } from "@/components/organizations/organization-scope";
import { Alert, ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DialogActions, FormDialog } from "@/components/ui/dialog";
import { ANALYSIS_SECTIONS } from "@/lib/api/contracts";
import type { IncidentAnalysisResponse } from "@/lib/api/contracts";

import { sectionsInSentence, SECTION_TITLES } from "./analysis-document";
import { analysisRefusalOf, usePublishIncidentAnalysis } from "./analysis-queries";
import { PROGRESS_WORDS, SectionMark } from "./section-editor";
import type { AnalysisDraft } from "./use-analysis-draft";

/**
 * How a publication ended, for the page to say once the editor is gone:
 * published by this writer, published by someone else first, or no longer
 * theirs to publish.
 */
export type PublishOutcome = "published" | "preempted" | "not-owner";

/**
 * Publishing the draft as it is saved — the only text that can be — after
 * the writer has seen what will be in it: each section done, still in
 * progress, or blank. Final, so asked for once more, and a section left in
 * progress is warned about before it goes out as it stands.
 *
 * It publishes the version it opened on. Should another arrive while it is
 * open, it closes without publishing, and the writer reviews what changed:
 * nothing is published that they have not seen. The same when the API finds
 * the analysis changed.
 */
export function PublishDialog({
  draft,
  incidentNumber,
  onClose,
  onOutcome,
}: {
  draft: AnalysisDraft;
  incidentNumber: number;
  onClose: () => void;
  onOutcome: (outcome: PublishOutcome) => void;
}) {
  const organization = useOrganization();
  const publish = usePublishIncidentAnalysis(organization.id, incidentNumber);
  const [version] = useState(draft.state.base.version);
  const { progress } = draft;
  const unfinished = ANALYSIS_SECTIONS.filter(
    (section) => progress[section] === "in-progress",
  );
  const warning = unfinished.length > 0;
  const one = unfinished.length === 1;
  const moved = draft.state.base.version !== version;

  useEffect(() => {
    if (!moved) return;

    draft.noteChanged();
    onClose();
  }, [moved, draft, onClose]);

  const refusal = analysisRefusalOf(publish.error);
  const summaryMissing = refusal === "summary-required";

  const confirm = () =>
    publish.mutate(
      { version },
      {
        onSuccess: () => onOutcome("published"),
        onError: (error) => {
          switch (analysisRefusalOf(error)) {
            case "changed":
              draft.noteChanged();
              onClose();
              return;
            case "published":
              onOutcome("preempted");
              return;
            case "not-owner":
              onOutcome("not-owner");
              return;
            default:
            // Shown here, where it can be tried again.
          }
        },
      },
    );

  return (
    <FormDialog
      title="Publish this analysis?"
      description={`${incidentKey(incidentNumber)}'s published analysis is final and is kept as it is.`}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        {summaryMissing ? (
          <Alert>Mark the summary as done before publishing.</Alert>
        ) : (
          publish.isError && !refusal && <ErrorAlert error={publish.error} />
        )}
        {warning && (
          <Alert tone="warning">
            <strong className="font-semibold">
              {sectionsInSentence(unfinished)} {one ? "is" : "are"} still in progress.
            </strong>{" "}
            {one ? "It" : "They"} will be published exactly as {one ? "it is" : "they are"}{" "}
            written now.
          </Alert>
        )}
        <ul
          aria-label="What will be published"
          className="divide-y divide-line-subtle border-y border-line-subtle"
        >
          {ANALYSIS_SECTIONS.map((section) => (
            <li
              key={section}
              className="flex items-center justify-between gap-3 py-2 text-sm text-fg"
            >
              {SECTION_TITLES[section]}
              {progress[section] === "not-started" ? (
                <span className="text-xs text-fg-muted">Blank, left out</span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
                  <SectionMark progress={progress[section]} className="size-3" />
                  {PROGRESS_WORDS[progress[section]]}
                </span>
              )}
            </li>
          ))}
        </ul>
        <DialogActions>
          <Button variant="secondary" onClick={onClose}>
            {warning ? "Go back and finish" : "Cancel"}
          </Button>
          <Button
            variant="complete"
            onClick={confirm}
            disabled={publish.isPending || summaryMissing}
          >
            {publish.isPending
              ? "Publishing…"
              : warning
                ? "Publish anyway"
                : "Publish analysis"}
          </Button>
        </DialogActions>
      </div>
    </FormDialog>
  );
}

/**
 * What became of a publication, said once where the editor was, and
 * focused: the field the writer was in has gone. Light — the status line
 * and the published record are what last.
 */
export function PublishOutcomeNotice({
  outcome,
  analysis,
}: {
  outcome: PublishOutcome;
  analysis: IncidentAnalysisResponse;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const [tone, text] =
    outcome === "published"
      ? (["success", "Analysis published."] as const)
      : outcome === "preempted"
        ? ([
            "info",
            `${analysis.publishedBy?.name ?? "Someone else"} published this analysis first.`,
          ] as const)
        : ([
            "warning",
            `${analysis.owner.name} now owns this analysis, so you can no longer publish it.`,
          ] as const);

  return (
    <div ref={ref} tabIndex={-1} className="max-w-[68ch] outline-none">
      <Alert tone={tone}>{text}</Alert>
    </div>
  );
}
