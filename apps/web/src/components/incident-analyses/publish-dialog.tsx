"use client";

import { Circle, CircleCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { incidentKey } from "@/components/incidents/severity";
import { useOrganization } from "@/components/organizations/organization-scope";
import { Alert, ErrorAlert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DialogActions, FormDialog } from "@/components/ui/dialog";
import { ANALYSIS_SECTIONS } from "@/lib/api/contracts";
import type { IncidentAnalysisResponse } from "@/lib/api/contracts";

import { SECTION_TITLES } from "./analysis-document";
import { analysisRefusalOf, usePublishIncidentAnalysis } from "./analysis-queries";
import type { AnalysisDraft } from "./use-analysis-draft";

/**
 * How a publication ended, for the page to say once the editor is gone:
 * published by this writer, published by someone else first, or no longer
 * theirs to publish.
 */
export type PublishOutcome = "published" | "preempted" | "not-owner";

/**
 * Publishing the draft as it is saved — the only text that can be — after
 * the writer has seen what will be in it: each section, written or to be
 * published as not recorded. Final, so asked for once more.
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
  const { sections } = draft.state.base;
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
      description={`It becomes ${incidentKey(incidentNumber)}'s permanent record. It can't be edited, reassigned, or unpublished.`}
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        {summaryMissing ? (
          <Alert>Write and save a summary before publishing.</Alert>
        ) : (
          publish.isError && !refusal && <ErrorAlert error={publish.error} />
        )}
        <ul aria-label="What will be published" className="flex flex-col gap-1.5">
          {ANALYSIS_SECTIONS.map((section) => {
            const written = sections[section] !== "";
            const Glyph = written ? CircleCheck : Circle;

            return (
              <li key={section} className="flex items-center gap-2 text-sm">
                <Glyph
                  aria-hidden="true"
                  strokeWidth={2}
                  className={
                    written ? "size-3.5 text-fg-muted" : "size-3.5 text-fg-subtle"
                  }
                />
                <span className={written ? "text-fg" : "text-fg-muted"}>
                  {SECTION_TITLES[section]}
                  {!written && <span className="text-fg-subtle"> — not recorded</span>}
                </span>
              </li>
            );
          })}
        </ul>
        <p className="text-sm text-fg-muted">
          Sections left empty are published as &ldquo;Not recorded.&rdquo;
        </p>
        <DialogActions>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={publish.isPending || summaryMissing}>
            {publish.isPending ? "Publishing…" : "Publish analysis"}
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
