"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import type {
  HTMLAttributes,
  ReactNode,
  TdHTMLAttributes,
  ThHTMLAttributes,
} from "react";

import { cx } from "./cx";

/**
 * The default way to show a list of things: its own quiet surface on the
 * workspace, a header on a surface of its own with an edge beneath it, and
 * soft rules between rows — none after the last, and no vertical lines.
 * Columns come from alignment and padding, not a grid.
 *
 * The variant follows urgency. `reference` is for configuration lists —
 * members, teams, services — read calmly; `operational` is for lists that
 * are scanned under pressure and must show many rows at once — incidents.
 */
export type TableVariant = "reference" | "operational";

const VariantContext = createContext<TableVariant>("reference");

/** Whether the element's content is wider than the element. */
const useOverflowing = () => {
  const ref = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const element = ref.current;

    if (!element || typeof ResizeObserver === "undefined") return;

    const measure = () =>
      setOverflowing(element.scrollWidth > element.clientWidth + 1);
    const observer = new ResizeObserver(measure);

    observer.observe(element);
    if (element.firstElementChild) observer.observe(element.firstElementChild);

    return () => observer.disconnect();
  }, []);

  return { ref, overflowing };
};

export function Table({
  label,
  variant = "reference",
  stickyHeader = false,
  fixed = false,
  children,
  className,
}: {
  /** The table's accessible name, and the scroll region's. */
  label: string;
  variant?: TableVariant;
  /**
   * Keeps the column headers in view while the page scrolls. Only while the
   * table fits its width: a table that scrolls sideways has its own scroll
   * container, which a sticky header cannot escape.
   */
  stickyHeader?: boolean;
  /** Fixed layout: widths from a <colgroup>, so truncation is exact. */
  fixed?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const { ref, overflowing } = useOverflowing();

  return (
    <VariantContext.Provider value={variant}>
      {/*
       * A table wider than the screen scrolls sideways. Only then is its
       * container a focusable, named region, so a keyboard user can scroll
       * it without the page gaining a pointless tab stop otherwise.
       */}
      <div
        ref={ref}
        className={cx(
          "rounded-md border border-line-subtle bg-surface",
          stickyHeader && !overflowing
            ? "overflow-x-visible"
            : "overflow-x-auto",
          className,
        )}
        {...(overflowing
          ? { role: "region", "aria-label": label, tabIndex: 0 }
          : {})}
      >
        {/*
         * Separate borders, drawn on the cells: a collapsed border belongs
         * to the table and stays behind when a sticky header moves.
         */}
        <table
          aria-label={label}
          data-sticky-header={stickyHeader || undefined}
          className={cx(
            "group/table w-full border-separate border-spacing-0",
            variant === "operational" ? "text-sm" : "text-base",
            fixed && "table-fixed",
          )}
        >
          {children}
        </table>
      </div>
    </VariantContext.Provider>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return <thead className="text-left">{children}</thead>;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function TR({
  interactive = false,
  className,
  ...props
}: HTMLAttributes<HTMLTableRowElement> & {
  /**
   * The row is one link: its primary link stretches over the whole row
   * (give that link `stretchedLinkClasses`), and the row shows the link's
   * focus. Still one tab stop, named by the link.
   */
  interactive?: boolean;
}) {
  return (
    <tr
      className={cx(
        "group/row",
        interactive &&
          "relative has-[a:focus-visible]:outline-2 has-[a:focus-visible]:-outline-offset-2 has-[a:focus-visible]:outline-focus",
        className,
      )}
      {...props}
    />
  );
}

/**
 * For the one link in an `interactive` row: it covers the row, so the whole
 * row is its target, and leaves drawing focus to the row.
 */
export const stretchedLinkClasses =
  "after:absolute after:inset-0 after:content-[''] focus-visible:outline-none";

type Align = "start" | "end";

export function TH({
  align = "start",
  className,
  ...props
}: Omit<ThHTMLAttributes<HTMLTableCellElement>, "align"> & { align?: Align }) {
  return (
    <th
      scope="col"
      className={cx(
        // Its own surface and an edge beneath: a header at a glance, and
        // strong enough to trace any value up to its column.
        "h-9 border-b border-line bg-thead px-3 align-middle sm:px-4 text-xs font-semibold tracking-[0.01em] whitespace-nowrap text-fg-muted first:rounded-tl-sm last:rounded-tr-sm",
        // Sticky, it keeps its surface and edge over the rows beneath.
        "group-data-sticky-header/table:sticky group-data-sticky-header/table:top-0 group-data-sticky-header/table:z-10",
        align === "end" ? "text-right" : "text-left",
        className,
      )}
      {...props}
    />
  );
}

export function TD({
  kind = "text",
  align = "start",
  className,
  ...props
}: Omit<TdHTMLAttributes<HTMLTableCellElement>, "align"> & {
  /**
   * `data` for identifiers, dates, and durations (mono, tabular); `numeric`
   * for counts (body face, aligned figures); `muted` for secondary text;
   * `actions` for a trailing cell of buttons.
   */
  kind?: "text" | "muted" | "data" | "numeric" | "actions";
  align?: Align;
}) {
  const variant = useContext(VariantContext);

  return (
    <td
      className={cx(
        "border-b border-line-subtle px-3 align-middle transition-colors sm:px-4 duration-(--duration-fast) group-last/row:border-b-0 group-hover/row:bg-hover",
        // The last row's hover fill keeps to the surface's rounded corners.
        "group-last/row:first:rounded-bl-sm group-last/row:last:rounded-br-sm",
        variant === "operational" ? "h-11" : "h-12.5",
        kind === "muted" && "text-fg-muted",
        kind === "data" && "data whitespace-nowrap text-fg-muted",
        kind === "numeric" && "numeric whitespace-nowrap text-fg-muted",
        kind === "actions" && "w-px whitespace-nowrap",
        align === "end" || kind === "actions" ? "text-right" : "text-left",
        className,
      )}
      {...props}
    />
  );
}

/** A single full-width row saying why the table is empty. */
export function TableEmpty({
  columns,
  children,
}: {
  columns: number;
  children: ReactNode;
}) {
  return (
    <tr>
      <td colSpan={columns} className="px-3 py-6 text-sm text-fg-muted sm:px-4">
        {children}
      </td>
    </tr>
  );
}
