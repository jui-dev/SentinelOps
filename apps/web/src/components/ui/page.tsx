import type { ReactNode } from "react";

import { cx } from "./cx";

/** The page's side padding, shared by its header and body so they align. */
const gutter = "px-4 sm:px-6 lg:px-8 2xl:px-10";

/**
 * The top of a page: where you are (eyebrow), what this is (the page's one
 * <h1>), and what you can do here. No rule and no band: type and space set
 * it apart, and it flows into the content beneath.
 */
export function PageHeader({
  eyebrow,
  title,
  meta,
  description,
  actions,
  wrapTitle = false,
  width = "full",
}: {
  /** Context above the title — the organization, usually. */
  eyebrow?: ReactNode;
  title: ReactNode;
  /** Set beside the title, quieter: a count, an identifier. */
  meta?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Up to two lines rather than one, for long titles such as an incident's. */
  wrapTitle?: boolean;
  /** The same as the page body's, so the actions align with the content. */
  width?: PageWidth;
}) {
  return (
    <header>
      <div
        className={cx(
          "flex flex-wrap items-end gap-x-6 gap-y-3 pt-8",
          gutter,
          widths[width],
        )}
      >
        {/* Wide enough to wrap the actions beneath it on a phone. */}
        <div className="flex min-w-0 flex-1 basis-80 flex-col gap-1">
          {eyebrow && (
            // A div, not a p: an eyebrow may hold a breadcrumb's nav and list.
            <div className="eyebrow truncate text-fg-muted">{eyebrow}</div>
          )}
          <div className="flex min-w-0 items-baseline gap-3">
            <h1
              className={cx(
                "text-[1.375rem] leading-7 font-semibold tracking-[-0.015em] text-fg",
                wrapTitle ? "line-clamp-2" : "truncate",
              )}
            >
              {title}
            </h1>
            {meta != null && (
              <span className="numeric shrink-0 text-sm text-fg-subtle">
                {meta}
              </span>
            )}
          </div>
          {description && (
            <div className="mt-0.5 max-w-[68ch] text-base text-fg-muted">
              {description}
            </div>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

const widths = {
  /** Wide operational content — incidents, the overview — capped for very wide screens. */
  full: "max-w-[90rem]",
  /** A reference list of a few columns: proportioned, however few its rows. */
  list: "max-w-[72rem]",
  /** One column read top to bottom — an incident: wide enough for a timeline. */
  reading: "max-w-[60rem]",
  /** Settings and forms: a readable measure. */
  form: "max-w-3xl",
};

export type PageWidth = keyof typeof widths;

/**
 * The page's content, padded to align with the header. `className` is for
 * additions such as a grid, never for overriding its padding or gap.
 */
export function PageBody({
  width = "full",
  className,
  children,
}: {
  width?: PageWidth;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cx(
        "flex flex-col gap-10 pt-6 pb-10",
        gutter,
        widths[width],
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * A titled part of a page. Separated from its neighbours by space and its
 * heading, not by a box or a rule.
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
        spacing === "loose" ? "gap-6" : "gap-4",
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
            {meta != null && (
              <span className="numeric text-sm text-fg-subtle">{meta}</span>
            )}
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
