import type { ReactNode } from "react";

import { cx } from "@/components/ui/cx";
import type { IncidentAnalysisStatus } from "@/lib/api/contracts";

/**
 * An analysis's status as a glyph and its word — never a pill, and never the
 * incident lifecycle's colours, so "Published" is not read as "Resolved". A
 * draft is open, a hollow ring in quiet ink; a published analysis is
 * complete, a filled disc in the accent. The shapes differ, so nothing rests
 * on colour.
 */
const MARKS: Record<
  IncidentAnalysisStatus,
  { label: string; glyph: ReactNode; colour: string }
> = {
  DRAFT: {
    label: "Draft",
    glyph: (
      <circle
        cx="5"
        cy="5"
        r="3.25"
        fill="none"
        strokeWidth="1.5"
        stroke="currentColor"
      />
    ),
    colour: "text-fg-subtle",
  },
  PUBLISHED: {
    label: "Published",
    glyph: <circle cx="5" cy="5" r="3.75" fill="currentColor" />,
    colour: "text-accent-mark",
  },
};

export function AnalysisStatusMark({
  status,
  className,
}: {
  status: IncidentAnalysisStatus;
  className?: string;
}) {
  const mark = MARKS[status];

  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap text-fg",
        className,
      )}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 10 10"
        className={cx("size-2.5 shrink-0", mark.colour)}
      >
        {mark.glyph}
      </svg>
      {mark.label}
    </span>
  );
}
