"use client";

import { useEffect, useRef } from "react";

import { Alert } from "@/components/ui/alert";
import { ANALYSIS_SECTIONS } from "@/lib/api/contracts";

import { DraftActionBar } from "./draft-action-bar";
import { SectionEditor } from "./section-editor";
import type { AnalysisDraft } from "./use-analysis-draft";

/**
 * The draft written in place: the document's four sections as fields, and
 * the bar that saves them. Unsaved text restored from an earlier visit is
 * said at the top.
 *
 * Ctrl/⌘+S saves from anywhere on the page while it is open.
 */
export function AnalysisEditor({ draft }: { draft: AnalysisDraft }) {
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
      {/* The notice and the bar keep the fields' width, so they read as
          the document's own — measured in its type, not the notice's. */}
      {draft.restored && (
        <div className="max-w-[68ch]">
          <Alert tone="info">Your unsaved changes from earlier have been restored.</Alert>
        </div>
      )}
      {ANALYSIS_SECTIONS.map((section) => (
        <SectionEditor
          key={section}
          section={section}
          value={draft.state.text[section]}
          onChange={(text) => draft.change(section, text)}
        />
      ))}
      <DraftActionBar draft={draft} />
    </form>
  );
}
