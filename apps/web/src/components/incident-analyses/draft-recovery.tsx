"use client";

import { useEffect, useRef, useState } from "react";

import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CopyField } from "@/components/ui/copy-field";
import type { AnalysisSection, IncidentAnalysisResponse } from "@/lib/api/contracts";

import { SECTION_TITLES } from "./analysis-document";
import { ConfirmDiscard } from "./draft-action-bar";
import type { AnalysisDraft } from "./use-analysis-draft";

/**
 * A section both the writer and someone else changed: what was saved
 * meanwhile, and the writer's choice between it and their own text. Saving
 * waits until it is made.
 */
export function ConflictNotice({
  section,
  saved,
  draft,
}: {
  section: AnalysisSection;
  saved: string;
  draft: AnalysisDraft;
}) {
  return (
    <Alert tone="warning" title={`Someone else saved a different ${SECTION_TITLES[section]}.`}>
      <p>Your text is below, unsaved. Keep it, or use what was saved.</p>
      <details className="mt-1">
        <summary className="cursor-pointer text-fg-muted">Show the saved text</summary>
        <p className="mt-1.5 rounded-md bg-surface px-3 py-2 whitespace-pre-line [overflow-wrap:anywhere]">
          {saved || "Nothing — it was cleared."}
        </p>
      </details>
      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" onClick={() => draft.keepMine(section)}>
          Keep my text
        </Button>
        <Button size="sm" variant="secondary" onClick={() => draft.takeSaved(section)}>
          Use saved text
        </Button>
      </div>
    </Alert>
  );
}

/** Someone else's changes arrived while the writer had unsaved text. */
export function ChangedNotice({ draft }: { draft: AnalysisDraft }) {
  const conflicts = Object.keys(draft.state.conflicts).length > 0;

  return (
    <Alert tone="warning" title="Someone saved changes to this analysis while you were editing.">
      <p>
        {!draft.unsaved
          ? "Their changes are in. Review them before publishing."
          : conflicts
            ? "None of your text was lost. Where you both changed a section, choose which text to keep."
            : "None of your text was lost. Their changes are in; yours are still unsaved."}
      </p>
    </Alert>
  );
}

/**
 * Unsaved text the writer can no longer save — the analysis was published,
 * or given to someone else — kept to be copied, never dropped. It stays in
 * this tab until they discard it.
 *
 * It takes focus when it appears: the field the writer was typing in has
 * just gone, and this says why.
 */
export function UnsavedText({
  analysis,
  draft,
}: {
  analysis: IncidentAnalysisResponse;
  draft: AnalysisDraft;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    ref.current?.focus();
  }, []);

  const reason =
    analysis.status === "PUBLISHED"
      ? `This analysis was published${
          analysis.publishedBy ? ` by ${analysis.publishedBy.name}` : ""
        } while you were editing. Your unsaved changes weren't included.`
      : `${analysis.owner.name} now owns this analysis, so you can no longer edit it.`;

  return (
    <div ref={ref} tabIndex={-1} className="outline-none">
      <Alert tone="warning" title={reason}>
        <details open className="mt-1">
          <summary className="cursor-pointer font-medium">
            Your unsaved text ({draft.dirty.length}{" "}
            {draft.dirty.length === 1 ? "section" : "sections"})
          </summary>
          <div className="mt-3 flex flex-col gap-4">
            {draft.dirty.map((section) => (
              <CopyField
                key={section}
                multiline
                label={SECTION_TITLES[section]}
                value={draft.state.text[section]}
              />
            ))}
            <div>
              <Button variant="secondary" size="sm" onClick={() => setConfirming(true)}>
                Discard unsaved text
              </Button>
            </div>
          </div>
        </details>
      </Alert>
      {confirming && (
        <ConfirmDiscard onDiscard={draft.discard} onClose={() => setConfirming(false)} />
      )}
    </div>
  );
}
