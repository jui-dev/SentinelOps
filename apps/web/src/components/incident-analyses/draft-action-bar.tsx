"use client";

import { useId, useState } from "react";

import { Button } from "@/components/ui/button";
import { DialogActions, FormDialog } from "@/components/ui/dialog";
import { LocalTime } from "@/components/ui/timestamp";
import type { AnalysisSection } from "@/lib/api/contracts";

import { SECTION_TITLES } from "./analysis-document";
import type { PublishBlock } from "./draft-state";
import { PublishDialog } from "./publish-dialog";
import type { PublishOutcome } from "./publish-dialog";
import type { AnalysisDraft } from "./use-analysis-draft";

/** "Summary, Cause". */
const named = (sections: readonly AnalysisSection[]) =>
  sections.map((section) => SECTION_TITLES[section]).join(", ");

/**
 * Confirming that unsaved text is to be thrown away. Always asked: one
 * section can hold a great deal of work.
 */
export function ConfirmDiscard({
  onDiscard,
  onClose,
}: {
  onDiscard: () => void;
  onClose: () => void;
}) {
  return (
    <FormDialog
      title="Discard your unsaved changes?"
      description="What you have written since it was last saved will be lost. This can't be undone."
      onClose={onClose}
    >
      <DialogActions>
        <Button variant="secondary" onClick={onClose}>
          Keep editing
        </Button>
        <Button
          variant="destructive"
          onClick={() => {
            onDiscard();
            onClose();
          }}
        >
          Discard changes
        </Button>
      </DialogActions>
    </FormDialog>
  );
}

/** Where the draft stands, in words: the bar's live status. */
function DraftStatus({ draft }: { draft: AnalysisDraft }) {
  const conflicts = Object.keys(draft.state.conflicts) as AnalysisSection[];

  if (draft.saving) return <>Saving…</>;
  if (draft.failure) {
    return (
      <span className="text-danger-text">Couldn&apos;t save. Your text is still here.</span>
    );
  }
  if (conflicts.length > 0) {
    return <>Choose which text to keep: {named(conflicts)}</>;
  }
  if (draft.dirty.length > 0) {
    return (
      <span className="inline-flex items-center gap-2">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-warning-solid" />
        Unsaved changes: {named(draft.dirty)}
      </span>
    );
  }

  return (
    <>
      All changes saved <span aria-hidden="true">·</span>{" "}
      <LocalTime value={draft.state.base.updatedAt} />
    </>
  );
}

/** Why Publish is unavailable, when the status alone does not say it. */
const PUBLISH_REASONS: Partial<Record<PublishBlock, string>> = {
  unsaved: "Save before publishing — only saved text is published.",
  summary: "Write and save a summary to publish.",
};

/**
 * The draft's actions, held at the foot of the document while it scrolls:
 * where it stands — saved, unsaved and in which sections, saving, or not
 * saved — and saving, discarding, or publishing it. Publishing waits until
 * everything is saved, and says why when it cannot. Saving is the enclosing form's
 * submit, so Enter on the button and Ctrl/⌘+S do the same.
 */
export function DraftActionBar({
  draft,
  incidentNumber,
  onPublishOutcome,
}: {
  draft: AnalysisDraft;
  incidentNumber: number;
  onPublishOutcome: (outcome: PublishOutcome) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const reason = draft.publishBlock && PUBLISH_REASONS[draft.publishBlock];
  const reasonId = useId();

  return (
    <div
      role="region"
      aria-label="Draft actions"
      className="sticky bottom-0 z-10 flex max-w-[68ch] flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-line bg-canvas py-3"
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <p role="status" className="text-sm text-fg-muted">
          <DraftStatus draft={draft} />
        </p>
        {reason && (
          <p id={reasonId} className="text-xs text-fg-subtle">
            {reason}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          disabled={!draft.unsaved || draft.saving}
          onClick={() => setConfirming(true)}
        >
          Discard changes
        </Button>
        <Button type="submit" disabled={!draft.canSave}>
          {draft.saving ? "Saving…" : draft.failure ? "Try again" : "Save draft"}
        </Button>
        <Button
          variant="secondary"
          disabled={draft.publishBlock !== null}
          aria-describedby={reason ? reasonId : undefined}
          onClick={() => setPublishing(true)}
        >
          Publish…
        </Button>
      </div>
      {publishing && (
        <PublishDialog
          draft={draft}
          incidentNumber={incidentNumber}
          onClose={() => setPublishing(false)}
          onOutcome={(outcome) => {
            setPublishing(false);
            onPublishOutcome(outcome);
          }}
        />
      )}
      {confirming && (
        <ConfirmDiscard onDiscard={draft.discard} onClose={() => setConfirming(false)} />
      )}
    </div>
  );
}
