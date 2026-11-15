import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cx } from "@/components/ui/cx";

/**
 * The colour a section's icon tile is drawn in: the vocabulary of what the
 * section is about, as the view headers inside it are. Whole class strings,
 * so the stylesheet finds every one of them.
 */
export const SECTION_FAMILIES = {
  /** What waits on the reader: the accent, as a decision always is. */
  decision: "[--family:var(--color-accent-text)]",
  /** What is wrong right now: the high signal. */
  operations: "[--family:var(--color-signal-high)]",
  /** Work moving: the flow's blue. */
  flow: "[--family:var(--color-flow-declared)]",
  /**
   * The last thirty days, read: the trend's own colour, as the views inside
   * it are — a reading, never a lifecycle state.
   */
  trend: "[--family:var(--color-trend-bar)]",
  /** How much happened: the activity ramp's blue. */
  activity: "[--family:var(--color-activity-operational-4)]",
  /** Getting set up: a neutral. */
  setup: "[--family:var(--color-fg-muted)]",
} as const;

export type SectionFamily = keyof typeof SECTION_FAMILIES;

/**
 * A section's icon, at the head of its header: the same small tile the view
 * headers inside a section use (analytical-view-header.tsx).
 */
export function SectionIcon({
  icon: Icon,
  family,
}: {
  icon: LucideIcon;
  family: SectionFamily;
}) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "tint-family-tile mt-0.5 grid size-8 shrink-0 place-items-center rounded-md",
        SECTION_FAMILIES[family],
      )}
    >
      <Icon strokeWidth={1.75} className="size-4" />
    </span>
  );
}

/**
 * How much a section asks of the reader, drawn in its frame:
 *
 *   default  a section of the page
 *   primary  the page's main operational section — a firmer edge, so it
 *            holds its place among the others without any colour
 *   action   a section that is waiting on the reader's decision — framed
 *            as any other section: the count in its header and the rows
 *            that need acting on carry the accent, not the frame. The
 *            surface stays the page's, so a panel with one item waiting
 *            never outweighs the operational sections around it. Only
 *            while there is something to act on.
 */
export type OverviewPanelTone = "default" | "primary" | "action";

const FRAMES: Record<OverviewPanelTone, { section: string; header: string }> = {
  default: { section: "border-section-line", header: "border-section-divider bg-section-head" },
  primary: { section: "border-section-line-strong", header: "border-section-divider bg-section-head" },
  action: { section: "border-section-line", header: "border-section-divider bg-section-head" },
};

/**
 * One of the Overview's sections, framed the same way: a header band naming
 * it, with a label saying what it covers, then its content. The label — Now
 * — is what tells a section apart from the pages that hold the past; a
 * section that covers no period of its own, such as what is waiting on the
 * viewer, simply leaves it off.
 */
export function OverviewPanel({
  id,
  title,
  label,
  description,
  actions,
  tone = "default",
  icon,
  family = "setup",
  children,
}: {
  id: string;
  title: string;
  /** The section's icon, in a small tile of its family. */
  icon?: LucideIcon;
  family?: SectionFamily;
  /** What this section covers: a context, not a state. Optional. */
  label?: ReactNode;
  description: string;
  actions?: ReactNode;
  tone?: OverviewPanelTone;
  children: ReactNode;
}) {
  const frame = FRAMES[tone];

  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      data-tone={tone}
      className={cx(
        "overflow-hidden rounded-lg border bg-section-ground shadow-card",
        frame.section,
      )}
    >
      <div
        className={cx(
          "flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b px-4 py-3 sm:px-5",
          frame.header,
        )}
      >
        <div className="flex min-w-0 items-start gap-3">
          {icon && <SectionIcon icon={icon} family={family} />}
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2
                id={`${id}-title`}
                className="text-lg leading-6 font-semibold tracking-[-0.01em] text-fg"
              >
                {title}
              </h2>
              {label}
            </div>
            {/* What the section covers, directly beneath its name. */}
            <p className="text-sm text-fg-muted">{description}</p>
          </div>
        </div>
        {actions && <div className="pt-0.5">{actions}</div>}
      </div>
      <div className="flex flex-col gap-7 p-4 sm:p-5">{children}</div>
    </section>
  );
}
