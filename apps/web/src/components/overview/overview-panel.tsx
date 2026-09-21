import type { ReactNode } from "react";

import { cx } from "@/components/ui/cx";

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
  default: { section: "border-line", header: "border-line bg-thead" },
  primary: { section: "border-line-strong", header: "border-line bg-thead" },
  action: { section: "border-line", header: "border-line bg-thead" },
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
  children,
}: {
  id: string;
  title: string;
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
        "overflow-hidden rounded-lg border bg-surface",
        frame.section,
      )}
    >
      <div
        className={cx(
          "flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b px-4 py-3 sm:px-5",
          frame.header,
        )}
      >
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
        {actions && <div className="pt-0.5">{actions}</div>}
      </div>
      <div className="flex flex-col gap-7 p-4 sm:p-5">{children}</div>
    </section>
  );
}
