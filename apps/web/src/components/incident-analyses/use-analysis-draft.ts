"use client";

import { useEffect, useState } from "react";

import { useOrganization } from "@/components/organizations/organization-scope";
import type {
  AnalysisSection,
  EditIncidentAnalysisRequest,
  IncidentAnalysisResponse,
} from "@/lib/api/contracts";

import { analysisRefusalOf, useEditIncidentAnalysis } from "./analysis-queries";
import { clearDraft, readDraft, writeDraft } from "./draft-storage";
import {
  canMarkDone,
  canSave,
  dirtySections,
  discarded,
  initialDraft,
  keepMine,
  markDoneRequest,
  publishBlock,
  reconcile,
  reopenRequest,
  saveFailed,
  saveRequest,
  sectionProgress,
  startSaving,
  takeSaved,
  typed,
} from "./draft-state";
import type { DraftState } from "./draft-state";

interface Draft {
  /**
   * Which analysis this is the draft of: its organization and incident.
   * Text typed for one analysis is never shown for, saved to, or reconciled
   * with another.
   */
  identity: string;
  state: DraftState;
  /** Unsaved text brought back from an earlier visit to this page. */
  restored: boolean;
  /** Someone else's changes arrived while there was unsaved text. */
  merged: boolean;
}

/** The draft to start from: unsaved text left in this tab, or the analysis. */
const startingDraft = (
  identity: string,
  analysis: IncidentAnalysisResponse,
  membershipId: string,
  incidentNumber: number,
): Draft => {
  const stored = readDraft(membershipId, incidentNumber);

  if (!stored) {
    return { identity, state: initialDraft(analysis), restored: false, merged: false };
  }

  // Left at an earlier version: reconciled like any later analysis, so what
  // was saved meanwhile is never overwritten, nor what was typed lost.
  const { state, merged } = reconcile(
    { ...stored, conflicts: {}, saving: null },
    analysis,
  );

  return { identity, state, restored: dirtySections(state).length > 0, merged };
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
  const identity = `${organization.id}:${incidentNumber}`;
  const [draft, setDraft] = useState(() =>
    startingDraft(identity, analysis, membershipId, incidentNumber),
  );
  const [seen, setSeen] = useState(analysis.version);

  if (draft.identity !== identity) {
    // Another analysis: its own draft, from its server state and whatever
    // this tab kept for it — nothing of the last one's.
    setDraft(startingDraft(identity, analysis, membershipId, incidentNumber));
    setSeen(analysis.version);
  } else if (analysis.version !== seen) {
    // A later version of the analysis — a refetch, someone else's change, or
    // this writer's own save — brought into the draft as the render sees it.
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

  /** Applies a save's answer only to the draft it was sent from. */
  const settle = (from: string, next: (current: Draft) => Draft) =>
    setDraft((current) => (current.identity === from ? next(current) : current));

  const send = (request: EditIncidentAnalysisRequest) => {
    update((current) => startSaving(current, request));
    edit.mutate(request, {
      // The answer also reaches the draft through the cache; applied here as
      // well so the save never waits on a render, and harmlessly twice.
      onSuccess: (saved) =>
        settle(identity, (current) => ({
          ...current,
          state: reconcile(current.state, saved).state,
          restored: false,
          merged: false,
        })),
      onError: (error) =>
        settle(identity, (current) => ({
          ...current,
          state: saveFailed(current.state),
          // Refused for someone else's change: the analysis is fetched
          // again, and the writer is told why their save did not go in.
          merged: current.merged || analysisRefusalOf(error) === "changed",
        })),
    });
  };

  const save = () => {
    if (canSave(state)) send(saveRequest(state));
  };

  const failure =
    edit.isError && analysisRefusalOf(edit.error) === undefined ? edit.error : null;

  return {
    state,
    dirty,
    unsaved,
    saving: state.saving !== null,
    canSave: canSave(state),
    /** Each section's standing: not started, in progress, or done. */
    progress: sectionProgress(state, analysis.doneSections),
    /** Why it cannot be published now; null when it can. */
    publishBlock: publishBlock(state, analysis.doneSections),
    /** A save that failed for a reason other than the analysis itself. */
    failure,
    restored: draft.restored,
    merged: draft.merged,
    change: (section: AnalysisSection, text: string) =>
      update((current) => typed(current, section, text)),
    save,
    /** Saves this section, and this section alone, as finished. */
    markDone: (section: AnalysisSection) => {
      if (canMarkDone(state, section)) send(markDoneRequest(state, section));
    },
    /** Takes a done section back to work on. */
    reopen: (section: AnalysisSection) => {
      if (state.saving === null) send(reopenRequest(state, section));
    },
    discard: () =>
      setDraft((current) => ({
        ...current,
        state: discarded(current.state),
        restored: false,
        merged: false,
      })),
    /**
     * Someone else's change was found by something other than a save — a
     * refused publication — and the writer should review it.
     */
    noteChanged: () => setDraft((current) => ({ ...current, merged: true })),
    keepMine: (section: AnalysisSection) =>
      update((current) => keepMine(current, section)),
    takeSaved: (section: AnalysisSection) =>
      update((current) => takeSaved(current, section)),
  };
};

export type AnalysisDraft = ReturnType<typeof useAnalysisDraft>;
