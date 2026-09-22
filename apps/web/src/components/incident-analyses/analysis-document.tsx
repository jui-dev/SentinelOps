import { Lock } from "lucide-react";

import { ANALYSIS_SECTIONS } from "@/lib/api/contracts";
import type {
  AnalysisSection,
  IncidentAnalysisResponse,
} from "@/lib/api/contracts";

/** Each section's heading, in the order the document reads. */
export const SECTION_TITLES: Record<AnalysisSection, string> = {
  summary: "Summary",
  impact: "Impact",
  cause: "Cause",
  lessons: "Lessons",
};

/**
 * The analysis as a document: Summary, Impact, Cause, and Lessons, always
 * in that order and always each under its heading, so every analysis reads
 * the same way. A section nobody wrote says so — still to be written in a
 * draft, not recorded in a published one — rather than leaving a gap.
 *
 * A published analysis closes on its being final, as a resolved incident
 * closes on its being kept as it is.
 */
export function AnalysisDocument({
  analysis,
}: {
  analysis: IncidentAnalysisResponse;
}) {
  const published = analysis.status === "PUBLISHED";

  return (
    <article aria-label="Analysis" className="flex min-w-0 flex-col gap-8">
      {ANALYSIS_SECTIONS.map((section) => {
        const text = analysis[section];
        const headingId = `analysis-${section}`;

        return (
          <section
            key={section}
            aria-labelledby={headingId}
            className="flex flex-col gap-2"
          >
            <h2
              id={headingId}
              className="text-[0.9375rem] leading-6 font-semibold text-fg"
            >
              {SECTION_TITLES[section]}
            </h2>
            {text ? (
              <p className="max-w-[68ch] text-base leading-7 whitespace-pre-line text-fg [overflow-wrap:anywhere]">
                {text}
              </p>
            ) : (
              <p className="text-sm text-fg-subtle">
                {published ? "Not recorded." : "Not written yet."}
              </p>
            )}
          </section>
        );
      })}
      {published && (
        <p className="flex items-start gap-2 border-t border-line-subtle pt-4 text-xs text-fg-muted">
          <Lock aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          This analysis is final. It is kept as published.
        </p>
      )}
    </article>
  );
}
