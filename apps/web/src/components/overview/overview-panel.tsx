import type { ReactNode } from "react";

/**
 * One of the Overview's sections, framed the same way: a header band naming
 * it, with a label saying what it covers, then its content. The label — Now
 * — is what tells a section apart from the pages that hold the past.
 */
export function OverviewPanel({
  id,
  title,
  label,
  description,
  actions,
  children,
}: {
  id: string;
  title: string;
  /** What this section covers: a context, not a state. */
  label: ReactNode;
  description: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="overflow-hidden rounded-lg border border-line bg-surface"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-line bg-thead px-4 py-3 sm:px-5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h2
              id={`${id}-title`}
              className="text-[0.9375rem] leading-6 font-semibold text-fg"
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
