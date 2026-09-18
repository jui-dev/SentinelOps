import type { ReactNode } from "react";

import { cx } from "./cx";

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
        "flex max-w-xl flex-col items-start gap-2 border-l-2 border-line-strong py-1 pl-4",
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
