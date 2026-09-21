import type { ReactNode } from "react";

import { cx } from "@/components/ui/cx";

/**
 * The frame an activity calendar and its chosen day share: two surfaces of
 * the same fixed height, side by side, that become one column on a narrow
 * screen.
 *
 * Presentation only, and domain-free — what a day *means* belongs to the
 * feature that fills `detail`. The organization's operational activity uses
 * it today; one member's response activity will use it next, with its own
 * calendar and its own detail inside the same geometry.
 *
 * Both are ink in both themes, and not the same ink. The calendar is the
 * ground — a year of squares, read at a glance, where the ramp is the only
 * colour — and sits on the darker one. The day you pick out of it is
 * raised: a navy panel beside it, carrying prose, which rebinds the
 * workspace's text, line and signal roles to their ink values so what is
 * drawn there needs no ink classes of its own (`ink-region`, globals.css).
 *
 * The height is fixed and equal on purpose. A day with a dozen incidents
 * must not push the page down where a quiet one did not, so the surfaces
 * keep their size and the busy content scrolls inside its own pane. It is
 * the same height whether a day is chosen or not, so choosing one moves
 * nothing at all.
 */

/** Tall enough for the calendar, and for a useful amount of detail. */
const PANE = "lg:h-[19rem]";

/** Which material a surface is made of. */
export type ActivityTone = "surface" | "ink" | "navy";

/** The surface itself, and the edge that bounds it. */
const TONES: Record<ActivityTone, string> = {
  // A layer within the section, not another card: one subtle edge, the
  // workspace's own radius, no shadow.
  surface: "border-line-subtle bg-surface",
  // The instrument panel: ink in both themes, the darkest layer the
  // workspace has, bounded by its own line rather than the workspace's.
  ink: "border-ink-line bg-ink",
  // Raised from it, and bluer, for what a chosen day says in words. The
  // rebind rides along, so everything inside reads on it.
  navy: "ink-region border-ink-inset-line bg-ink-inset",
};

/**
 * One inner surface: the bordered panel the calendar and the chosen day
 * each sit on, a layer inside the section's own panel.
 */
export function ActivitySurface({
  children,
  className,
  tone = "surface",
}: {
  children: ReactNode;
  className?: string;
  tone?: ActivityTone;
}) {
  return (
    <div
      className={cx(
        "min-w-0 overflow-hidden rounded-md border p-4",
        TONES[tone],
        PANE,
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * How the two share the width once a day is chosen.
 *
 * The chosen day needs about the same room whatever is on it — a date, a
 * handful of counts, and a list of incidents — while the calendar wants
 * every pixel it can have, because a year it cannot show at once is a year
 * nobody can scan. So from `xl` the detail takes a fixed column and the
 * calendar takes the rest: 65% of the width at 1280px, and better than
 * three quarters once the page reaches the width it caps at.
 *
 * Between `lg` and `xl` there is not enough room for that to leave the
 * calendar a useful share, so the two split three to two instead. Below
 * `lg` they stack, where one of each beats two narrow columns.
 */
const SPLIT = "lg:grid-cols-[3fr_2fr] xl:grid-cols-[minmax(0,1fr)_20rem]";

/**
 * The calendar, and beside it the day chosen from it. With no day chosen
 * the calendar has the whole width.
 */
export function ActivityPanes({
  calendar,
  detail,
}: {
  calendar: ReactNode;
  /** The chosen day's surface, or null when none is chosen. */
  detail?: ReactNode;
}) {
  return (
    <div className={cx("grid gap-4", detail ? SPLIT : undefined)}>
      {/* Centred in its surface: the grid is shorter than the pane, and the
          space reads as deliberate rather than as a gap at the bottom. */}
      <ActivitySurface tone="ink" className="flex flex-col justify-center">
        {calendar}
      </ActivitySurface>
      {detail && <ActivitySurface tone="navy">{detail}</ActivitySurface>}
    </div>
  );
}
