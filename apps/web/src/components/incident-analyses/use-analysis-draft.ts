"use client";

import { useEffect, useState } from "react";

import { useOrganization } from "@/components/organizations/organization-scope";
import type {
  AnalysisSection,
  IncidentAnalysisResponse,
} from "@/lib/api/contracts";

import { analysisRefusalOf, useEditIncidentAnalysis } from "./analysis-queries";
import { clearDraft, readDraft, writeDraft } from "./draft-storage";
import {
  canSave,
  dirtySections,
  discarded,
  initialDraft,
  keepMine,
  reconcile,
  saveFailed,
  saveRequest,
  startSaving,
  takeSaved,
  typed,
} from "./draft-state";
import type { DraftState } from "./draft-state";

interface Draft {
  state: DraftState;
  /** Unsaved text brought back from an earlier visit to this page. */
  restored: boolean;
  /** Someone else's changes arrived while there was unsaved text. */
  merged: boolean;
}

/** The draft to start from: unsaved text left in this tab, or the analysis. */
const startingDraft = (
  analysis: IncidentAnalysisResponse,
  membershipId: string,
  incidentNumber: number,
): Draft => {
  const stored = readDraft(membershipId, incidentNumber);

  if (!stored) return { state: initialDraft(analysis), restored: false, merged: false };

  // Left at an earlier version: reconciled like any later analysis, so what
  // was saved meanwhile is never overwritten, nor what was typed lost.
  const { state, merged } = reconcile(
    { ...stored, conflicts: {}, saving: null },
    analysis,
  );

  return { state, restored: dirtySections(state).length > 0, merged };
};

/**
 * One analysis's draft, for as long as its page is open: what the writer
 * typed, kept apart from the server's analysis, and brought up to each later
 * version of it through `reconcile` — never overwritten.
 *
 * Owned by the page, not the editor, so that the text outlives the editor:
 * when the analysis is published meanwhile, or given to someone else, the
 * editor goes and the text stays to be copied.
 *
 * While there is unsaved text it is kept in this tab (draft-storage), and
 * closing or reloading the tab asks first.
 */
export const useAnalysisDraft = (
  analysis: IncidentAnalysisResponse,
  incidentNumber: number,
) => {
  const organization = useOrganization();
  const membershipId = organization.membership.id;
  const edit = useEditIncidentAnalysis(organization.id, incidentNumber);
  const [draft, setDraft] = useState(() =>
    startingDraft(analysis, membershipId, incidentNumber),
  );
  const [seen, setSeen] = useState(analysis.version);

  // A later version of the analysis — a refetch, someone else's change, or
  // this writer's own save — brought into the draft as the render sees it.
  if (analysis.version !== seen) {
    setSeen(analysis.version);

    const next = reconcile(draft.state, analysis);

    if (next.state !== draft.state) {
      setDraft({ ...draft, state: next.state, merged: draft.merged || next.merged });
    }
  }

  const { state } = draft;
  const dirty = dirtySections(state);
  const unsaved = dirty.length > 0 || Object.keys(state.conflicts).length > 0;

  useEffect(() => {
    if (unsaved) writeDraft(membershipId, incidentNumber, state);
    else clearDraft(membershipId, incidentNumber);
  }, [unsaved, state, membershipId, incidentNumber]);

  useEffect(() => {
    if (!unsaved) return;

    const ask = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Older browsers ask only when this is set.
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", ask);

    return () => window.removeEventListener("beforeunload", ask);
  }, [unsaved]);

  const update = (next: (current: DraftState) => DraftState) =>
    setDraft((current) => ({ ...current, state: next(current.state) }));

  const save = () => {
    if (!canSave(state)) return;

    const request = saveRequest(state);

    update((current) => startSaving(current, request));
    edit.mutate(request, {
      // The answer also reaches the draft through the cache; applied here as
      // well so the save never waits on a render, and harmlessly twice.
      onSuccess: (saved) =>
        setDraft((current) => ({
          state: reconcile(current.state, saved).state,
          restored: false,
          merged: false,
        })),
      onError: (error) =>
        setDraft((current) => ({
          ...current,
          state: saveFailed(current.state),
          // Refused for someone else's change: the analysis is fetched
          // again, and the writer is told why their save did not go in.
          merged: current.merged || analysisRefusalOf(error) === "changed",
        })),
    });
  };

  const failure =
    edit.isError && analysisRefusalOf(edit.error) === undefined ? edit.error : null;

  return {
    state,
    dirty,
    unsaved,
    saving: state.saving !== null,
    canSave: canSave(state),
    /** A save that failed for a reason other than the analysis itself. */
    failure,
    restored: draft.restored,
    merged: draft.merged,
    change: (section: AnalysisSection, text: string) =>
      update((current) => typed(current, section, text)),
    save,
    discard: () =>
      setDraft((current) => ({
        state: discarded(current.state),
        restored: false,
        merged: false,
      })),
    keepMine: (section: AnalysisSection) =>
      update((current) => keepMine(current, section)),
    takeSaved: (section: AnalysisSection) =>
      update((current) => takeSaved(current, section)),
  };
};

export type AnalysisDraft = ReturnType<typeof useAnalysisDraft>;
