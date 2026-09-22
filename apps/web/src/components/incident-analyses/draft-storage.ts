import { ANALYSIS_SECTIONS } from "@/lib/api/contracts";

import type { DraftState, Sections } from "./draft-state";

/**
 * Unsaved analysis text, kept for this tab until it is saved or discarded,
 * so that leaving the page — a link, the back button, a reload — never
 * loses it: returning restores it, through the same reconciliation as any
 * later version of the analysis.
 *
 * Per tab (sessionStorage): gone when the tab closes, and never shared with
 * another tab. Per membership and incident: another member signed in on the
 * same tab never sees it. Storage that is unavailable or refuses a write is
 * no worse than none; the page never depends on it.
 */

export type StoredDraft = Pick<DraftState, "base" | "text">;

const keyOf = (membershipId: string, incidentNumber: number) =>
  `sentinelops.analysis-draft.${membershipId}.${incidentNumber}`;

const isSections = (value: unknown): value is Sections =>
  typeof value === "object" &&
  value !== null &&
  ANALYSIS_SECTIONS.every(
    (section) => typeof (value as Record<string, unknown>)[section] === "string",
  );

const isStoredDraft = (value: unknown): value is StoredDraft => {
  const draft = value as StoredDraft | null;

  return (
    typeof draft === "object" &&
    draft !== null &&
    typeof draft.base?.version === "number" &&
    typeof draft.base.updatedAt === "string" &&
    isSections(draft.base.sections) &&
    isSections(draft.text)
  );
};

export const readDraft = (
  membershipId: string,
  incidentNumber: number,
): StoredDraft | null => {
  try {
    const value = JSON.parse(
      window.sessionStorage.getItem(keyOf(membershipId, incidentNumber)) ?? "null",
    );

    return isStoredDraft(value) ? value : null;
  } catch {
    return null;
  }
};

export const writeDraft = (
  membershipId: string,
  incidentNumber: number,
  draft: StoredDraft,
) => {
  try {
    window.sessionStorage.setItem(
      keyOf(membershipId, incidentNumber),
      JSON.stringify({ base: draft.base, text: draft.text }),
    );
  } catch {
    // Full, or refused: the page works without it.
  }
};

export const clearDraft = (membershipId: string, incidentNumber: number) => {
  try {
    window.sessionStorage.removeItem(keyOf(membershipId, incidentNumber));
  } catch {
    // Nothing to clear where there is no storage.
  }
};
