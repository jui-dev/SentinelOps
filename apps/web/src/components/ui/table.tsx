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
 * The default way to show a list of things. Horizontal rules only, no
 * vertical lines, no rounded outer box: the page's structure holds it.
 *
 * Density follows urgency. `default` suits administrative lists; `compact`
 * is for operational lists that must show many rows at once.
 */
export type TableDensity = "compact" | "default";

const DensityContext = createContext<TableDensity>("default");

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
  density = "default",
  children,
  className,
}: {
  /** The table's accessible name, and the scroll region's. */
  label: string;
  density?: TableDensity;
  children: ReactNode;
  className?: string;
}) {
  const { ref, overflowing } = useOverflowing();

  return (
    <DensityContext.Provider value={density}>
      {/*
       * A table wider than the screen scrolls sideways. Only then is its
       * container a focusable, named region, so a keyboard user can scroll
       * it without the page gaining a pointless tab stop otherwise.
       */}
      <div
        ref={ref}
        className={cx("-mx-3 overflow-x-auto", className)}
        {...(overflowing
          ? { role: "region", "aria-label": label, tabIndex: 0 }
          : {})}
      >
        <table
          aria-label={label}
          className="w-full border-collapse border-t border-line-strong text-sm"
        >
          {children}
        </table>
      </div>
    </DensityContext.Provider>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="border-b border-line text-left">
      {children}
    </thead>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

export function TR({
  className,
  ...props
}: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cx(
        "border-b border-line-subtle transition-colors duration-(--duration-fast) [tbody_&]:hover:bg-hover",
        className,
      )}
      {...props}
    />
  );
}

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
        "label-caps h-8 px-3 align-middle whitespace-nowrap text-fg-subtle",
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
   * `data` for identifiers, dates, and numbers (mono, tabular); `muted` for
   * secondary text; `actions` for a trailing cell of buttons.
   */
  kind?: "text" | "muted" | "data" | "actions";
  align?: Align;
}) {
  const density = useContext(DensityContext);

  return (
    <td
      className={cx(
        "px-3 align-middle",
        density === "compact" ? "h-9" : "h-11",
        kind === "muted" && "text-fg-muted",
        kind === "data" && "data whitespace-nowrap text-fg-muted",
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
      <td colSpan={columns} className="px-3 py-6 text-sm text-fg-muted">
        {children}
      </td>
    </tr>
  );
}
