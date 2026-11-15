import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * The head of one of Recent operational health's two views: a small marker
 * in the view's own colour, its name, what exactly it counts, and — where
 * the view has them — the figures it is read by, at the end of the line.
 * What the view shows sits beneath on its own ink panel (`INSTRUMENT`), as
 * the activity calendar does, so no rule is needed to part the header from
 * it.
 *
 * The marker is the same compact tile the summary cards use: a trace of the
 * view's colour behind its icon, so a view is known by its colour before
 * its name is read. The definition carries the rest, not the size: the name
 * stays the section's body scale, and what it measures is said under it.
 */
export function ViewHeader({
  id,
  title,
  definition,
  Icon,
  family,
  aside,
}: {
  id: string;
  title: string;
  definition: string;
  Icon: LucideIcon;
  /**
   * The view's colour, as a whole class string that sets the family custom
   * property to one colour token — written out in full at the call site so
   * the stylesheet finds it.
   */
  family: string;
  /** The figures the view is read by, when it has them. */
  aside?: ReactNode;
}) {
  return (
    <div
      data-view-header
      className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2"
    >
      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden="true"
          className={`tint-family-tile grid size-8 shrink-0 place-items-center rounded-md ${family}`}
        >
          <Icon strokeWidth={2} className="size-4" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 id={id} className="text-base font-semibold text-fg">
            {title}
          </h3>
          <p className="text-xs text-fg-muted">{definition}</p>
        </div>
      </div>
      {aside}
    </div>
  );
}

/**
 * The ink panel a view's content is drawn on: the same ground the activity
 * calendar sits on — the darkest in dark, white in light — bounded by its
 * own line. The `ink-region`
 * rebinds text, lines and the analytical marks to their ink values, so
 * what is drawn inside keeps the classes that say what it is.
 */
export const INSTRUMENT =
  "ink-region rounded-md border border-ink-line bg-ink";

/**
 * One view's frame: a raised surface holding its header, its ink panel,
 * and the panel's caption beneath, so the two views of the section are told
 * apart by their frames, not by a rule between them. Three rows — header,
 * panel, caption — which, beside the other view from `xl`, are the
 * section's own rows (a subgrid): both headers share one row, both panels
 * the next and both captions the last, so the panels start and end level
 * whatever each holds.
 */
export const VIEW =
  "grid min-w-0 grid-rows-[auto_1fr_auto] gap-3 rounded-lg border border-line-subtle bg-view p-4 xl:row-span-3 xl:grid-rows-subgrid";
