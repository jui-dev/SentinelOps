import { useId } from "react";
import type { ReactNode } from "react";

import { cx } from "@/components/ui/cx";
import { controlClasses } from "@/components/ui/field";
import { ANALYSIS_SECTION_MAX_LENGTH } from "@/lib/api/contracts";
import type { AnalysisSection } from "@/lib/api/contracts";

import { SECTION_TITLES } from "./analysis-document";

/** What each section is for, said beneath its heading while it is written. */
const SECTION_HINTS: Record<AnalysisSection, string> = {
  summary: "What happened, in a few sentences someone outside the response could follow.",
  impact: "Who or what was affected, and how much. Leave it blank if it isn't known.",
  cause: "Why it happened, as far as is known.",
  lessons: "What to keep, change, or look into.",
};

/** The count appears once a section nears its limit, and not before. */
const COUNT_FROM = ANALYSIS_SECTION_MAX_LENGTH - 400;

/**
 * One section of the document, written in place: its heading, what it is
 * for, and the text in the document's own type — a field that grows with
 * what is written, not a form's box. The heading names the field; the hint,
 * and the count near the limit, describe it.
 *
 * `notice` sits between the hint and the text: what the writer must decide
 * about this section before it can be saved.
 */
export function SectionEditor({
  section,
  value,
  onChange,
  notice,
}: {
  section: AnalysisSection;
  value: string;
  onChange: (value: string) => void;
  notice?: ReactNode;
}) {
  const id = useId();
  const headingId = `${id}-heading`;
  const hintId = `${id}-hint`;
  const countId = `${id}-count`;
  const counting = value.length > COUNT_FROM;

  return (
    <section aria-labelledby={headingId} className="flex max-w-[68ch] flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <h2 id={headingId} className="text-[0.9375rem] leading-6 font-semibold text-fg">
          {SECTION_TITLES[section]}
        </h2>
        <span className="text-xs text-fg-subtle">
          {section === "summary" ? "Required to publish" : "Optional"}
        </span>
      </div>
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
    </section>
  );
}
