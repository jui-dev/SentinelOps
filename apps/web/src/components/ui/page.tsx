import type { ReactNode } from "react";

import { cx } from "./cx";

/**
 * The top of a page: where you are (eyebrow), what this is (the page's one
 * <h1>), and what you can do here. Closed by a full-width rule rather than
 * boxed.
 */
export function PageHeader({
  eyebrow,
  title,
  meta,
  description,
  actions,
}: {
  /** Context above the title — the organization, usually. */
  eyebrow?: ReactNode;
  title: ReactNode;
  /** Set beside the title, quieter: a count, an identifier. */
  meta?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="border-b border-line bg-canvas">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3 px-4 pt-6 pb-5 sm:px-6 xl:px-8">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {eyebrow && (
            <p className="label-caps truncate text-fg-subtle">{eyebrow}</p>
          )}
          <div className="flex min-w-0 items-baseline gap-3">
            <h1 className="truncate text-xl font-semibold tracking-[-0.01em] text-fg">
              {title}
            </h1>
            {meta && <span className="data shrink-0 text-fg-subtle">{meta}</span>}
          </div>
          {description && (
            <p className="max-w-2xl text-sm text-fg-muted">{description}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

const widths = {
  /** Lists and tables: the workspace, capped for very wide screens. */
  full: "max-w-[90rem]",
  /** Settings and forms: a readable measure. */
  form: "max-w-3xl",
};

/**
 * The page's content, padded to align with the header. `className` is for
 * additions such as a grid, never for overriding its padding or gap.
 */
export function PageBody({
  width = "full",
  className,
  children,
}: {
  width?: keyof typeof widths;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cx(
        "flex flex-col gap-10 px-4 py-6 sm:px-6 xl:px-8",
        widths[width],
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * A titled part of a page. Separated from its neighbours by space and a
 * rule under its heading, not by a box.
 */
export function Section({
  title,
  level = 2,
  spacing = "default",
  meta,
  description,
  actions,
  children,
  className,
  id,
}: {
  title: ReactNode;
  level?: 2 | 3;
  /** `loose` for a section holding sub-sections rather than one list. */
  spacing?: "default" | "loose";
  meta?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  const Heading = level === 2 ? "h2" : "h3";

  return (
    <section
      id={id}
      aria-labelledby={id ? `${id}-title` : undefined}
      className={cx(
        "flex flex-col",
        spacing === "loose" ? "gap-6" : "gap-3",
        className,
      )}
    >
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-baseline gap-2">
            <Heading
              id={id ? `${id}-title` : undefined}
              className={cx(
                "font-semibold text-fg",
                level === 2 ? "text-[0.9375rem] leading-6" : "text-sm",
              )}
            >
              {title}
            </Heading>
            {meta && <span className="data text-fg-subtle">{meta}</span>}
          </div>
          {description && (
            <p className="max-w-2xl text-sm text-fg-muted">{description}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
