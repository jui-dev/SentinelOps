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

/**
 * An empty list inside a page: nothing here, and that is expected. Where the
 * table would be, compact — a title, what it means in a line, and, when the
 * emptiness is itself a state worth seeing (no active incidents), a glyph.
 * No call to action: the page already offers what can be done.
 */
export function EmptyNote({
  title,
  children,
  glyph,
  className,
}: {
  title: ReactNode;
  /** One line on what the emptiness means. */
  children?: ReactNode;
  /** Decorative: the title says it. */
  glyph?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx("flex items-start gap-3 px-4 py-3.5", surface, className)}>
      {glyph && (
        <span aria-hidden="true" className="flex h-5 shrink-0 items-center">
          {glyph}
        </span>
      )}
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="text-sm font-medium text-fg">{title}</p>
        {children && <p className="text-sm text-fg-subtle">{children}</p>}
      </div>
    </div>
  );
}
