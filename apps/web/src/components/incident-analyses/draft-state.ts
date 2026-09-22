import { ANALYSIS_SECTIONS } from "@/lib/api/contracts";
import type {
  AnalysisSection,
  EditIncidentAnalysisRequest,
  IncidentAnalysisResponse,
} from "@/lib/api/contracts";

/**
 * A draft being written, apart from the server's analysis.
 *
 * The server's analysis is the cache's; what the writer has typed is this.
 * Nothing the server sends is ever written over typed text except through
 * `reconcile`, which takes the server's text only where nothing was typed,
 * and asks where both changed. That is the whole of the rule that unsaved
 * text is never silently lost.
 *
 * Pure: every function takes a state and returns the next.
 */

export type Sections = Record<AnalysisSection, string>;

export interface DraftState {
  /**
   * What the writer last agreed with the server on: the analysis at a
   * version, its sections as stored (unwritten is ""). Every save names
   * this version.
   */
  base: { version: number; updatedAt: string; sections: Sections };
  /** What the writer has typed, section by section. */
  text: Sections;
  /**
   * Sections both the writer and someone else changed, each with the text
   * that was saved meanwhile, until the writer chooses between them.
   */
  conflicts: Partial<Sections>;
  /**
   * A save under way: the version it was based on and the text it sent, so
   * that its own answer is recognised as the writer's, not someone else's.
   */
  saving: { from: number; sent: Partial<Sections> } | null;
}

/** An analysis's sections as stored: unwritten is "". */
export const sectionsOf = (analysis: IncidentAnalysisResponse): Sections => ({
  summary: analysis.summary ?? "",
  impact: analysis.impact ?? "",
  cause: analysis.cause ?? "",
  lessons: analysis.lessons ?? "",
});

/** What the API would store for this text: trimmed, blank meaning unwritten. */
const stored = (text: string) => text.trim();

export const initialDraft = (analysis: IncidentAnalysisResponse): DraftState => ({
  base: {
    version: analysis.version,
    updatedAt: analysis.updatedAt,
    sections: sectionsOf(analysis),
  },
  text: sectionsOf(analysis),
  conflicts: {},
  saving: null,
});

/** Whether this section's text would store differently from the base's. */
export const isDirty = (state: DraftState, section: AnalysisSection) =>
  stored(state.text[section]) !== state.base.sections[section];

/** The sections with unsaved text, in document order. */
export const dirtySections = (state: DraftState): AnalysisSection[] =>
  ANALYSIS_SECTIONS.filter((section) => isDirty(state, section));

/** Whether there is anything to save, and nothing stands in the way. */
export const canSave = (state: DraftState) =>
  state.saving === null &&
  Object.keys(state.conflicts).length === 0 &&
  dirtySections(state).length > 0;

/**
 * Why the draft cannot be published now, or null when it can. Only what is
 * saved is ever published, so anything unsaved, being saved, or awaiting a
 * choice blocks it; then the one section a publication requires.
 */
export type PublishBlock = "saving" | "conflict" | "unsaved" | "summary";

export const publishBlock = (state: DraftState): PublishBlock | null => {
  if (state.saving !== null) return "saving";
  if (Object.keys(state.conflicts).length > 0) return "conflict";
  if (dirtySections(state).length > 0) return "unsaved";
  if (state.base.sections.summary === "") return "summary";

  return null;
};

/**
 * The save to send: the unsaved sections, as they would be stored, based on
 * the base's version.
 */
export const saveRequest = (state: DraftState): EditIncidentAnalysisRequest => ({
  version: state.base.version,
  ...Object.fromEntries(
    dirtySections(state).map((section) => [section, stored(state.text[section])]),
  ),
});

/** A save has been sent. */
export const startSaving = (
  state: DraftState,
  request: EditIncidentAnalysisRequest,
): DraftState => {
  const { version, ...sent } = request;

  return {
    ...state,
    saving: { from: version, sent: sent as Partial<Sections> },
  };
};

/** A save failed: nothing was applied, and the text is as it was. */
export const saveFailed = (state: DraftState): DraftState => ({
  ...state,
  saving: null,
});

export const typed = (
  state: DraftState,
  section: AnalysisSection,
  text: string,
): DraftState => ({ ...state, text: { ...state.text, [section]: text } });

/** Back to the base: every unsaved change and open choice dropped. */
export const discarded = (state: DraftState): DraftState => ({
  ...state,
  text: { ...state.base.sections },
  conflicts: {},
});

/** The writer keeps their own text; saving it will replace what was saved. */
export const keepMine = (state: DraftState, section: AnalysisSection): DraftState => {
  const conflicts = { ...state.conflicts };

  delete conflicts[section];

  return { ...state, conflicts };
};

/** The writer takes the text that was saved meanwhile. */
export const takeSaved = (state: DraftState, section: AnalysisSection): DraftState => ({
  ...keepMine(state, section),
  text: { ...state.text, [section]: state.base.sections[section] },
});

/**
 * The server's analysis at a later version than the base, made the base —
 * without losing a word the writer typed. Section by section, against what
 * the writer last agreed with the server on:
 *
 *   changed by the server only  the server's text: nothing was typed there
 *   changed by the writer only  the writer's text, now based on the later
 *                               version
 *   changed by both, alike      settled
 *   changed by both, unlike     a conflict: the writer's text stays, and the
 *                               saved text waits beside it for their choice
 *
 * A section the writer's own save sent, holding what it sent, is the
 * writer's, not someone else's: the first later version after a save began
 * is that save's answer, or it was refused. Text typed while it was under
 * way stays unsaved.
 *
 * `merged` says the server brought someone else's changes while the writer
 * had unsaved text — which is worth telling them. An analysis at the base's
 * version or earlier changes nothing.
 */
export const reconcile = (
  state: DraftState,
  server: IncidentAnalysisResponse,
): { state: DraftState; merged: boolean } => {
  if (server.version <= state.base.version) return { state, merged: false };

  const theirs = sectionsOf(server);
  const text = { ...state.text };
  const conflicts = { ...state.conflicts };
  const unsaved =
    dirtySections(state).length > 0 || Object.keys(state.conflicts).length > 0;
  let merged = false;

  for (const section of ANALYSIS_SECTIONS) {
    const changed = theirs[section] !== state.base.sections[section];
    const mine = isDirty(state, section) || section in conflicts;
    const own =
      state.saving !== null &&
      section in state.saving.sent &&
      state.saving.sent[section] === theirs[section];

    if (own) {
      // The writer's own save. What they typed since stays unsaved.
      if (stored(text[section]) === theirs[section]) text[section] = theirs[section];
      delete conflicts[section];
    } else if (changed && !mine) {
      text[section] = theirs[section];
      merged ||= unsaved;
    } else if (changed && mine) {
      merged = true;

      if (stored(text[section]) === theirs[section]) {
        delete conflicts[section];
      } else {
        conflicts[section] = theirs[section];
      }
    } else if (section in conflicts && stored(text[section]) === theirs[section]) {
      delete conflicts[section];
    }
  }

  return {
    state: {
      base: { version: server.version, updatedAt: server.updatedAt, sections: theirs },
      text,
      conflicts,
      saving:
        state.saving && server.version > state.saving.from ? null : state.saving,
    },
    merged,
  };
};
