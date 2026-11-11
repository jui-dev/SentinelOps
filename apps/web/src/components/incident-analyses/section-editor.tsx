import { Check, Circle, Contrast } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cx } from "@/components/ui/cx";
import { controlClasses } from "@/components/ui/field";
import { ANALYSIS_SECTION_MAX_LENGTH } from "@/lib/api/contracts";
import type { AnalysisSection } from "@/lib/api/contracts";

import { SECTION_TITLES } from "./analysis-document";
import type { SectionProgress } from "./draft-state";

/**
 * What each section is for, said beneath its heading while it is written —
 * and in the checklist an incident shows of its analysis.
 */
export const SECTION_HINTS: Record<AnalysisSection, string> = {
  summary: "What happened, in a few sentences someone outside the response could follow.",
  impact: "Who or what was affected, and how much. Leave it blank if it isn't known.",
  cause: "Why it happened, as far as is known.",
  lessons: "What to keep, change, or look into.",
};

/** Where a section is on the page, for the links that lead to it. */
export const sectionAnchor = (section: AnalysisSection) => `section-${section}`;

/** The count appears once a section nears its limit, and not before. */
const COUNT_FROM = ANALYSIS_SECTION_MAX_LENGTH - 400;

/** What each standing is called, on its card and to a screen reader. */
export const PROGRESS_WORDS: Record<SectionProgress, string> = {
  "not-started": "Not started",
  "in-progress": "In progress",
  done: "Done",
};

/** A section's standing as a mark: ticked, half full, or empty. */
export function SectionMark({
  progress,
  className,
}: {
  progress: SectionProgress;
  className: string;
}) {
  if (progress === "done") {
    return (
      <Check
        aria-hidden="true"
        strokeWidth={3}
        className={cx(className, "text-status-resolved-text")}
      />
    );
  }

  return progress === "in-progress" ? (
    <Contrast
      aria-hidden="true"
      strokeWidth={2.5}
      className={cx(className, "text-warning-text")}
    />
  ) : (
    <Circle aria-hidden="true" strokeWidth={2} className={cx(className, "text-fg-subtle")} />
  );
}

const CARD_CLASSES: Record<SectionProgress, string> = {
  "not-started": "border-line bg-surface",
  "in-progress": "border-warning-line bg-surface",
  done: "border-status-resolved-line bg-linear-to-b from-status-resolved-subtle to-surface",
};

const BADGE_CLASSES: Record<SectionProgress, string> = {
  "not-started": "border-line text-fg-muted",
  "in-progress": "border-warning-line bg-warning-subtle text-warning-text",
  done: "border-status-resolved-line bg-status-resolved-subtle text-status-resolved-text",
};

/**
 * One section of the document, in one of three standings: not started, an
 * empty field; in progress, a field holding text, which counts for nothing
 * until its writer marks it done; and done, the finished text to read, with
 * Edit to take it back. The heading names the field; the hint, and the count
 * near the limit, describe it.
 *
 * `notice` sits between the hint and the text: what the writer must decide
 * about this section before it can be saved, and so before it can be done.
 */
export function SectionEditor({
  section,
  value,
  onChange,
  progress,
  saving,
  onMarkDone,
  onEdit,
  notice,
}: {
  section: AnalysisSection;
  value: string;
  onChange: (value: string) => void;
  progress: SectionProgress;
  /** A save is under way, so marking and reopening wait for it. */
  saving: boolean;
  onMarkDone: () => void;
  onEdit: () => void;
  notice?: ReactNode;
}) {
  const id = useId();
  const headingId = `${id}-heading`;
  const hintId = `${id}-hint`;
  const countId = `${id}-count`;
  const counting = value.length > COUNT_FROM;
  const done = progress === "done";
  const card = useRef<HTMLElement>(null);
  const refocus = useRef<boolean | null>(null);

  // The button pressed goes when the section changes standing: focus moves
  // to what replaced it, once the section has actually changed.
  useEffect(() => {
    if (saving || refocus.current !== done) return;

    refocus.current = null;
    card.current?.querySelector<HTMLElement>(done ? "button" : "textarea")?.focus();
  }, [saving, done]);

  // A card of its own; its id is where the progress card's link to it lands.
  return (
    <section
      ref={card}
      id={sectionAnchor(section)}
      aria-labelledby={headingId}
      className={cx(
        "flex scroll-mt-6 flex-col gap-2 rounded-2xl border px-5 py-4.5 sm:px-6",
        CARD_CLASSES[progress],
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex items-baseline gap-2">
          <h2 id={headingId} className="text-base leading-6 font-semibold text-fg">
            {SECTION_TITLES[section]}
          </h2>
          <span
            className={cx(
              "text-xs",
              section === "summary" ? "text-warning-text" : "text-fg-subtle",
            )}
          >
            {section === "summary" ? "Required to publish" : "Optional"}
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          <span
            className={cx(
              "inline-flex h-6 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium",
              BADGE_CLASSES[progress],
            )}
          >
            <SectionMark progress={progress} className="size-3" />
            {PROGRESS_WORDS[progress]}
          </span>
          {done && (
            <Button
              variant="secondary"
              aria-label={`Edit ${SECTION_TITLES[section]}`}
              disabled={saving}
              onClick={() => {
                refocus.current = false;
                onEdit();
              }}
            >
              Edit
            </Button>
          )}
        </div>
      </div>
      {done ? (
        <p className="max-w-[68ch] text-base leading-7 whitespace-pre-line text-fg [overflow-wrap:anywhere]">
          {value}
        </p>
      ) : (
        <>
          <p id={hintId} className="text-sm text-fg-muted">
            {SECTION_HINTS[section]}
          </p>
          {notice}
          <textarea
            aria-labelledby={headingId}
            aria-describedby={counting ? `${hintId} ${countId}` : hintId}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            maxLength={ANALYSIS_SECTION_MAX_LENGTH}
            className={cx(
              controlClasses("multiline"),
              "field-sizing-content resize-y leading-7",
              section === "summary" ? "min-h-36" : "min-h-24",
            )}
          />
          {counting && (
            <p id={countId} className="numeric text-xs text-fg-muted">
              {value.length.toLocaleString()} / {ANALYSIS_SECTION_MAX_LENGTH.toLocaleString()}
            </p>
          )}
        </>
      )}
      {progress === "in-progress" && (
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <p className="text-xs text-fg-muted">Not counted until you mark it done.</p>
          {!notice && (
            <Button
              variant="complete"
              icon={Check}
              aria-label={`Mark as done: ${SECTION_TITLES[section]}`}
              disabled={saving}
              onClick={() => {
                refocus.current = true;
                onMarkDone();
              }}
            >
              Mark as done
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
