import type { ReactNode } from "react";

import { cx } from "./cx";

/**
 * The facts about one thing, as label/value rows divided by soft rules — a
 * spec sheet, not a grid of cards. No rule above or below the list: the
 * section heading and the space around it hold it. `secondary` sets technical metadata quieter
 * than the facts a person came to read.
 */
export function RecordList({
  tone = "primary",
  stacked = false,
  children,
  className,
}: {
  tone?: "primary" | "secondary";
  /** Label above value on wide screens, where the list is a side column. */
  stacked?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <dl
      data-tone={tone}
      data-stacked={stacked || undefined}
      className={cx("group/record flex flex-col", className)}
    >
      {children}
    </dl>
  );
}

export function RecordRow({
  label,
  children,
}: {
  label: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-0.5 border-b border-line-subtle py-2.5 last:border-b-0 sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-baseline xl:group-data-stacked/record:grid-cols-1">
      <dt className="text-sm text-fg-muted group-data-[tone=secondary]/record:text-fg-subtle">
        {label}
      </dt>
      <dd className="min-w-0 text-base text-fg group-data-[tone=secondary]/record:text-sm group-data-[tone=secondary]/record:text-fg-muted">
        {children}
      </dd>
    </div>
  );
}
