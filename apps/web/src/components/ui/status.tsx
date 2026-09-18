import type { ReactNode } from "react";

import { cx } from "./cx";

/**
 * A state, said in words and marked with a glyph whose shape differs by tone
 * — so it survives colour blindness, greyscale, and forced-colours mode. Not
 * a pill: a status sits in a table cell as text, and the glyph carries the
 * signal.
 *
 * The tones are feedback-level states for today's records (an invitation
 * pending or expired). Operational states — incident severity, service
 * health — get their own glyph set with the signal tokens when those models
 * exist.
 */
export type StatusTone = "neutral" | "warning" | "success" | "danger";

const glyphs: Record<StatusTone, { path: ReactNode; colour: string }> = {
  // Hollow ring: open, waiting.
  neutral: {
    path: <circle cx="5" cy="5" r="3.25" fill="none" strokeWidth="1.5" stroke="currentColor" />,
    colour: "text-fg-subtle",
  },
  // Triangle: needs attention.
  warning: {
    path: <path d="M5 1.25 9.25 8.75H.75Z" fill="currentColor" />,
    colour: "text-warning-text",
  },
  // Filled disc: done, good.
  success: {
    path: <circle cx="5" cy="5" r="3.75" fill="currentColor" />,
    colour: "text-success-text",
  },
  // Diamond: failed.
  danger: {
    path: <path d="M5 .75 9.25 5 5 9.25.75 5Z" fill="currentColor" />,
    colour: "text-danger-text",
  },
};

export function Status({
  tone,
  children,
  className,
}: {
  tone: StatusTone;
  children: ReactNode;
  className?: string;
}) {
  const { path, colour } = glyphs[tone];

  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap",
        tone === "neutral" ? "text-fg" : colour,
        className,
      )}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 10 10"
        className={cx("size-2.5 shrink-0", colour)}
      >
        {path}
      </svg>
      {children}
    </span>
  );
}
