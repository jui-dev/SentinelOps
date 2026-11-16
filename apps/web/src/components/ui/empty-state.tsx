import { CircleCheck, Inbox, Search } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cx } from "./cx";

/**
 * Empty states share one surface with the tables they stand in for: the
 * list's own quiet surface and edge, empty — not a recessed well, which
 * reads as a disabled field.
 */
const surface = "rounded-md border border-line-subtle bg-surface";

/**
 * Nothing here yet, or nothing reachable: said plainly, with what it means
 * and what to do. No illustrations — the words are the useful part.
 */
export function EmptyState({
  title,
  children,
  action,
  headingLevel,
  className,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  /** When the title is the page's heading, e.g. a not-found page. */
  headingLevel?: 1 | 2;
  className?: string;
}) {
  const Title = headingLevel ? (`h${headingLevel}` as const) : "p";

  return (
    <div
      className={cx(
        "flex max-w-xl flex-col items-start gap-2 px-5 py-5",
        surface,
        className,
      )}
    >
      <Title className="text-[0.9375rem] leading-6 font-semibold text-fg">
        {title}
      </Title>
      {children && <div className="text-sm text-fg-muted">{children}</div>}
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
}

/** What an empty section or list says about itself, and the tile it shows. */
export type EmptyKind = "empty" | "good" | "noMatch";

const KINDS: Record<EmptyKind, { icon: LucideIcon; tile: string }> = {
  /** Nothing here yet, and that is expected. */
  empty: { icon: Inbox, tile: "bg-accent-subtle text-accent-text" },
  /** Nothing here is itself good news: no active incidents. */
  good: {
    icon: CircleCheck,
    tile: "bg-status-resolved-subtle text-status-resolved-text",
  },
  /** Something is here, but the filters asked for leave none of it. */
  noMatch: { icon: Search, tile: "bg-accent-subtle text-accent-text" },
};

/** The small tile at the head of an empty section or list. */
function KindTile({ kind, icon }: { kind: EmptyKind; icon?: LucideIcon }) {
  const Icon = icon ?? KINDS[kind].icon;

  return (
    <span
      aria-hidden="true"
      className={cx(
        "grid size-10 shrink-0 place-items-center rounded-[0.6875rem]",
        KINDS[kind].tile,
      )}
    >
      <Icon strokeWidth={1.75} className="size-5" />
    </span>
  );
}

/**
 * A section or list with nothing in it, where its rows would be: centred
 * on the section's inner panel — white in light, the darkest ground in
 * dark — a small tile, a title, and what the emptiness means in a line.
 * Good news in teal; filters that match nothing with a search tile. No call
 * to action: the page already offers what can be done, in one place.
 */
export function EmptyNote({
  title,
  children,
  kind,
  icon,
  glyph,
  className,
}: {
  title: ReactNode;
  /** One line on what the emptiness means. */
  children?: ReactNode;
  kind?: EmptyKind;
  /** The tile's icon, where the section's own says it better. */
  icon?: LucideIcon;
  /**
   * The nominal mark some callers pass for good news: it makes the note
   * the good kind. Decorative; the title says it.
   */
  glyph?: ReactNode;
  className?: string;
}) {
  const resolved: EmptyKind = kind ?? (glyph ? "good" : "empty");

  return (
    <div
      className={cx(
        "ink-region flex flex-col items-center gap-2 rounded-md border border-ink-line bg-ink px-5 py-7 text-center",
        className,
      )}
    >
      <KindTile kind={resolved} icon={icon} />
      <p className="text-[0.9375rem] font-semibold text-fg">{title}</p>
      {children && (
        <p className="max-w-sm text-sm leading-relaxed text-fg-muted">{children}</p>
      )}
    </div>
  );
}

/**
 * A filtered list that matched nothing, inside the list's own frame (a
 * table's one cell, a timeline's body): the search tile, a title, what it
 * means in a line, and the way back to everything. Laid out as `EmptyNote`
 * is, without a frame of its own, since the list already draws one.
 */
export function NoMatches({
  title,
  children,
  action,
}: {
  title: ReactNode;
  children?: ReactNode;
  /** The way back: Show everyone, Show every service. */
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-5 text-center">
      <KindTile kind="noMatch" />
      <p className="text-[0.9375rem] font-semibold text-fg">{title}</p>
      {children && (
        <p className="max-w-sm text-sm leading-relaxed text-fg-muted">{children}</p>
      )}
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
