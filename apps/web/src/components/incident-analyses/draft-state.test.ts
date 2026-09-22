import { describe, expect, it } from "vitest";

import type { IncidentAnalysisResponse } from "@/lib/api/contracts";

import { draft } from "./analysis.fixtures";
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

/** The analysis at version 3: a summary and an impact written. */
const v3 = draft({ version: 3, summary: "Payments failed.", impact: "An hour.", cause: null });

/** The same analysis at a later version, with these sections as saved. */
const later = (
  version: number,
  sections: Partial<Pick<IncidentAnalysisResponse, "summary" | "impact" | "cause" | "lessons">>,
  from: IncidentAnalysisResponse = v3,
) => ({ ...from, ...sections, version, updatedAt: `2026-09-22T0${version}:00:00.000Z` });

const writing = (...edits: [keyof DraftState["text"], string][]) =>
  edits.reduce((state, [section, text]) => typed(state, section, text), initialDraft(v3));

describe("an analysis draft", () => {
  describe("while it is written", () => {
    it("is clean until its text would store differently", () => {
      expect(dirtySections(initialDraft(v3))).toEqual([]);
      // Whitespace the API would trim changes nothing.
      expect(dirtySections(writing(["summary", "  Payments failed.\n"]))).toEqual([]);
      expect(dirtySections(writing(["cause", "A deploy."], ["impact", ""]))).toEqual([
        "impact",
        "cause",
      ]);
    });

    it("saves only its unsaved sections, as stored, at its base version", () => {
      const state = writing(["cause", "  A deploy. "], ["impact", "   "]);

      expect(canSave(state)).toBe(true);
      expect(saveRequest(state)).toEqual({ version: 3, impact: "", cause: "A deploy." });
      expect(canSave(initialDraft(v3))).toBe(false);
    });

    it("goes back to its base when discarded", () => {
      const state = discarded(writing(["cause", "A deploy."], ["summary", "Other."]));

      expect(state.text).toEqual(initialDraft(v3).text);
      expect(dirtySections(state)).toEqual([]);
    });
  });

  describe("when it is saved", () => {
    it("is clean once its own save comes back", () => {
      const sending = writing(["cause", "A deploy."]);
      const saving = startSaving(sending, saveRequest(sending));

      expect(canSave(saving)).toBe(false);

      const { state, merged } = reconcile(saving, later(4, { cause: "A deploy." }));

      expect(merged).toBe(false);
      expect(state.base.version).toBe(4);
      expect(state.saving).toBeNull();
      expect(state.conflicts).toEqual({});
      expect(dirtySections(state)).toEqual([]);
    });

    it("keeps what was typed while the save was under way unsaved, not in conflict", () => {
      const sending = writing(["cause", "A deploy."]);
      const saving = typed(startSaving(sending, saveRequest(sending)), "cause", "A deploy, rolled back.");

      const { state } = reconcile(saving, later(4, { cause: "A deploy." }));

      expect(state.conflicts).toEqual({});
      expect(state.text.cause).toBe("A deploy, rolled back.");
      expect(dirtySections(state)).toEqual(["cause"]);
      expect(saveRequest(state)).toEqual({ version: 4, cause: "A deploy, rolled back." });
    });

    it("keeps every word when a save fails", () => {
      const sending = writing(["cause", "A deploy."]);
      const state = saveFailed(startSaving(sending, saveRequest(sending)));

      expect(state.text.cause).toBe("A deploy.");
      expect(state.base.version).toBe(3);
      expect(canSave(state)).toBe(true);
    });

    it("is idempotent: its answer applied twice changes nothing more", () => {
      const sending = writing(["cause", "A deploy."]);
      const answer = later(4, { cause: "A deploy." });
      const once = reconcile(startSaving(sending, saveRequest(sending)), answer).state;

      expect(reconcile(once, answer).state).toBe(once);
    });
  });

  describe("when someone else's changes arrive", () => {
    it("takes them silently where nothing was typed", () => {
      const { state, merged } = reconcile(initialDraft(v3), later(4, { impact: "Two hours." }));

      expect(merged).toBe(false);
      expect(state.text.impact).toBe("Two hours.");
      expect(dirtySections(state)).toEqual([]);
    });

    it("merges them beside unsaved text in another section", () => {
      const { state, merged } = reconcile(
        writing(["cause", "A deploy."]),
        later(4, { impact: "Two hours." }),
      );

      expect(merged).toBe(true);
      expect(state.text).toMatchObject({ impact: "Two hours.", cause: "A deploy." });
      expect(state.conflicts).toEqual({});
      expect(saveRequest(state)).toEqual({ version: 4, cause: "A deploy." });
    });

    it("asks where both changed the same section, keeping the writer's text", () => {
      const { state, merged } = reconcile(
        writing(["cause", "A deploy."]),
        later(4, { cause: "A config change." }),
      );

      expect(merged).toBe(true);
      expect(state.text.cause).toBe("A deploy.");
      expect(state.conflicts).toEqual({ cause: "A config change." });
      expect(canSave(state)).toBe(false);
    });

    it("saves the writer's text over theirs only once they choose to keep it", () => {
      const conflicted = reconcile(writing(["cause", "A deploy."]), later(4, { cause: "A config change." })).state;
      const kept = keepMine(conflicted, "cause");

      expect(canSave(kept)).toBe(true);
      expect(saveRequest(kept)).toEqual({ version: 4, cause: "A deploy." });
    });

    it("takes the saved text when the writer chooses it", () => {
      const conflicted = reconcile(writing(["cause", "A deploy."]), later(4, { cause: "A config change." })).state;
      const taken = takeSaved(conflicted, "cause");

      expect(taken.text.cause).toBe("A config change.");
      expect(taken.conflicts).toEqual({});
      expect(dirtySections(taken)).toEqual([]);
    });

    it("settles a section both changed alike", () => {
      const { state } = reconcile(writing(["cause", "A deploy. "]), later(4, { cause: "A deploy." }));

      expect(state.conflicts).toEqual({});
      expect(dirtySections(state)).toEqual([]);
    });

    it("keeps an open choice current when the section changes again", () => {
      const first = reconcile(writing(["cause", "A deploy."]), later(4, { cause: "A config change." })).state;
      const { state } = reconcile(first, later(5, { cause: "A certificate expiry." }));

      expect(state.text.cause).toBe("A deploy.");
      expect(state.conflicts).toEqual({ cause: "A certificate expiry." });
    });

    it("treats a changed section its own failed save sent as a conflict, not its own", () => {
      // Someone else's change made the next version; this save was refused.
      const sending = writing(["cause", "A deploy."]);
      const saving = startSaving(sending, saveRequest(sending));

      const { state } = reconcile(saveFailed(saving), later(4, { cause: "A config change." }));

      expect(state.conflicts).toEqual({ cause: "A config change." });
    });

    it("changes nothing for a version it already has", () => {
      const state = writing(["cause", "A deploy."]);

      expect(reconcile(state, v3).state).toBe(state);
      expect(reconcile(state, later(2, { cause: "Old." })).state).toBe(state);
    });
  });
});
