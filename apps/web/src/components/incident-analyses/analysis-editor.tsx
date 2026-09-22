"use client";

import { useEffect, useRef } from "react";

import { Alert } from "@/components/ui/alert";
import { ANALYSIS_SECTIONS } from "@/lib/api/contracts";

import { DraftActionBar } from "./draft-action-bar";
import { ChangedNotice, ConflictNotice } from "./draft-recovery";
import type { PublishOutcome } from "./publish-dialog";
import { SectionEditor } from "./section-editor";
import type { AnalysisDraft } from "./use-analysis-draft";

/**
 * The draft written in place: the document's four sections as fields, and
 * the bar that saves them. What happened meanwhile is said at the top —
 * unsaved text restored from an earlier visit, or someone else's changes
 * brought in beside it.
 *
 * Ctrl/⌘+S saves from anywhere on the page while it is open.
 */
export function AnalysisEditor({
  draft,
  incidentNumber,
  onPublishOutcome,
}: {
  draft: AnalysisDraft;
  incidentNumber: number;
  onPublishOutcome: (outcome: PublishOutcome) => void;
}) {
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "s" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        form.current?.requestSubmit();
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <form
      ref={form}
      aria-label="Analysis"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        draft.save();
      }}
      className="flex min-w-0 flex-col gap-8"
    >
      {/* The notices and the bar keep the fields' width, so they read as
          the document's own — measured in its type, not the notices'. */}
      {draft.restored && (
        <div className="max-w-[68ch]">
          <Alert tone="info">Your unsaved changes from earlier have been restored.</Alert>
        </div>
      )}
      {draft.merged && (
        <div className="max-w-[68ch]">
          <ChangedNotice draft={draft} />
        </div>
      )}
      {ANALYSIS_SECTIONS.map((section) => {
        const saved = draft.state.conflicts[section];

        return (
          <SectionEditor
            key={section}
            section={section}
            value={draft.state.text[section]}
            onChange={(text) => draft.change(section, text)}
            notice={
              saved !== undefined && (
                <ConflictNotice section={section} saved={saved} draft={draft} />
              )
            }
          />
        );
      })}
      <DraftActionBar
        draft={draft}
        incidentNumber={incidentNumber}
        onPublishOutcome={onPublishOutcome}
      />
    </form>
  );
}
