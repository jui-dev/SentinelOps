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

/**
 * One width for each kind of column, shared by every table, so a column of a
 * kind is the same width wherever it appears and lines up across pages. The
 * `main` column — a name, a title — takes what is left. Every cell has the
 * same padding either side, so the gap between any two columns is 32 px.
 * Widths include that padding.
 */
const COLUMN_WIDTHS = {
  main: "",
  /** A clock time: 14:02. */
  time: "w-24",
  severity: "w-26",
  /** A count, aligned right. */
  count: "w-26",
  /** A duration, aligned right: 2h 14m. */
  duration: "w-26",
  /** A date: 2026-11-14. */
  date: "w-30",
  /** A short label or pill: a role, an area, a criticality, a result. */
  label: "w-38",
  /** A date with its time, or a relative time. */
  datetime: "w-38",
  /** A status pill, with room for a second line. */
  status: "w-46",
  /** A person's name. */
  person: "w-48",
  /** A team, a service, or a few of them. */
  group: "w-56",
  /** A longer line of secondary text. */
  wide: "w-64",
  /** One row button. */
  actions: "w-40",
  /** Two row buttons side by side. */
  actions2: "w-56",
} as const;

export type ColumnKind = keyof typeof COLUMN_WIDTHS;

/** The breakpoint a column first shows at; below it, it is hidden. */
const SHOWN_FROM = {
  sm: "hidden sm:table-column",
  md: "hidden md:table-column",
  lg: "hidden lg:table-column",
  xl: "hidden xl:table-column",
} as const;

export type TableColumn =
  | ColumnKind
  | { kind: ColumnKind; from: keyof typeof SHOWN_FROM };

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
  columns,
  stickyHeader = false,
  children,
  className,
}: {
  /** The table's accessible name, and the scroll region's. */
  label: string;
  variant?: TableVariant;
  /**
   * Its columns, in order, each by kind: the widths come from the shared
   * scale and the layout is fixed. A column hidden on narrow screens names
   * the breakpoint it shows from; its header and cells hide at the same one.
   */
  columns: readonly TableColumn[];
  /**
   * Keeps the column headers in view while the page scrolls. Only while the
   * table fits its width: a table that scrolls sideways has its own scroll
   * container, which a sticky header cannot escape.
   */
  stickyHeader?: boolean;
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
          className="group/table w-full table-fixed border-separate border-spacing-0 text-sm"
        >
          <colgroup>
            {columns.map((column, index) => {
              const { kind, from } =
                typeof column === "string"
                  ? { kind: column, from: undefined }
                  : column;

              return (
                <col
                  key={index}
                  data-kind={kind}
                  className={
                    cx(COLUMN_WIDTHS[kind], from && SHOWN_FROM[from]) || undefined
                  }
                />
              );
            })}
          </colgroup>
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
        "h-9 border-b border-line bg-thead px-4 align-middle text-xs font-semibold tracking-[0.01em] whitespace-nowrap text-fg-muted first:rounded-tl-sm last:rounded-tr-sm",
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
        "border-b border-line-subtle px-4 align-middle transition-colors duration-(--duration-fast) group-last/row:border-b-0 group-hover/row:bg-hover",
        // The last row's hover fill keeps to the surface's rounded corners.
        "group-last/row:first:rounded-bl-sm group-last/row:last:rounded-br-sm",
        // 40 px rows for lists scanned under pressure, 48 px for setup lists.
        variant === "operational" ? "h-10" : "h-12",
        kind === "muted" && "text-fg-muted",
        kind === "data" && "data whitespace-nowrap text-fg-muted",
        kind === "numeric" && "numeric whitespace-nowrap text-fg-muted",
        kind === "actions" && "whitespace-nowrap",
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
      <td colSpan={columns} className="px-4 py-6 text-sm text-fg-muted">
        {children}
      </td>
    </tr>
  );
}
