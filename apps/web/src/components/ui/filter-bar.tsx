"use client";

import { ChevronDown, Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, ReactNode, SelectHTMLAttributes } from "react";

import { cx } from "./cx";

/**
 * Every list's filters, drawn one way: one bar, on one line while it fits.
 *
 *   [⌕] │ ROLE [ All 7 · Admins 1 · … ]  SETUP [ Awaiting sign-in 0 · … ]   …
 *
 * The search is a button until it is wanted, then a field in its place;
 * each kind of filter is a labelled track of joined options, one of which
 * is raised when chosen. A bar wider than its room breaks onto a second
 * line between filters — never inside one — so no filter is ever hidden
 * past its edge.
 *
 * On the plain surface, never the rail's gradient: controls are on the
 * surface, summaries on the gradient (see `Glance`, detail-layout.tsx).
 */
export function FilterBar({
  label,
  children,
  end,
  className,
}: {
  /** Names the bar for assistive technology: "Find members". */
  label: string;
  children: ReactNode;
  /** What sits at the far end: a count, or Clear filters. */
  end?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="search"
      aria-label={label}
      className={cx(
        "flex min-h-13 flex-wrap items-center gap-x-3.5 gap-y-2 rounded-lg border border-line-subtle bg-surface px-2.5 py-2 whitespace-nowrap",
        className,
      )}
    >
      {children}
      {end && <div className="ml-auto flex shrink-0 items-center pl-2">{end}</div>}
    </div>
  );
}

/** The hairline between the search and the filters. */
export function FilterDivider() {
  return <span aria-hidden="true" className="h-5 w-px shrink-0 bg-line" />;
}

/**
 * One kind of filter: its name in small capitals, then its options joined
 * in one track. The name is the group's accessible name, so it is not read
 * twice.
 */
export function FilterGroup({
  label,
  showLabel = true,
  children,
}: {
  label: string;
  /** Leave the caption off where the options say what they are. */
  showLabel?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      {showLabel && (
        <span aria-hidden="true" className="label-caps text-fg-subtle">
          {label}
        </span>
      )}
      <div
        role="group"
        aria-label={label}
        className="inline-flex gap-0.5 rounded-lg border border-line bg-sunken p-0.5"
      >
        {children}
      </div>
    </div>
  );
}

/**
 * One option in a group's track. Chosen, it is raised onto the surface;
 * otherwise it is quiet text. Its count is part of its name ("No team 2"),
 * faint at nought, and amber when it asks for attention.
 */
export function FilterOption({
  pressed,
  onClick,
  count,
  attention = false,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  count?: number;
  /** A count above nought that wants someone's attention. */
  attention?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cx(
        "inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-sm whitespace-nowrap transition-colors duration-(--duration-fast) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
        pressed
          ? "bg-surface font-medium text-fg shadow-xs ring-1 ring-line-strong"
          : "text-fg-muted hover:text-fg",
      )}
    >
      {children}
      {count !== undefined && (
        <>
          {/* The space is for the name ("All 3"); flex layout drops it. */}{" "}
          <span
            className={cx(
              "numeric text-xs font-semibold",
              attention && count > 0
                ? "text-warning-text"
                : count === 0
                  ? "text-fg-subtle opacity-70"
                  : "text-fg-subtle",
            )}
          >
            {count}
          </span>
        </>
      )}
    </button>
  );
}

/**
 * The search: a button until it is wanted, then a field where it was. It
 * stays open while it holds something; emptied and left, it closes again.
 * Given `onSubmit` it searches when Enter is pressed, otherwise as the
 * reader types.
 */
export function FilterSearch({
  label,
  value,
  onChange,
  onSubmit,
  placeholder,
  id,
  maxLength,
}: {
  /** The field's name: "Search members". */
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit?: () => void;
  placeholder?: string;
  id?: string;
  maxLength?: number;
}) {
  const generated = useId();
  const inputId = id ?? generated;
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const shown = open || value !== "";

  // Opened from the button: the field takes the focus the button had.
  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  if (!shown) {
    return (
      <button
        type="button"
        aria-label="Open search"
        aria-expanded={false}
        aria-controls={inputId}
        onClick={() => setOpen(true)}
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-line bg-sunken text-fg-muted transition-colors duration-(--duration-fast) hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
      >
        <Search aria-hidden="true" className="size-4" />
      </button>
    );
  }

  const field = (
    <>
      <label htmlFor={inputId} className="sr-only">
        {label}
      </label>
      <Search
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-accent-text"
      />
      <input
        ref={input}
        id={inputId}
        name="q"
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value === "") setOpen(false);
        }}
        onBlur={() => {
          if (value === "") setOpen(false);
        }}
        placeholder={placeholder}
        maxLength={maxLength}
        autoComplete="off"
        className="h-8 w-full rounded-md border border-line-control bg-field pr-2.5 pl-8.5 text-sm text-fg placeholder:text-fg-subtle focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-focus"
      />
    </>
  );

  return onSubmit ? (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        onSubmit();
      }}
      className="relative w-60 shrink-0"
    >
      {field}
    </form>
  ) : (
    <div className="relative w-60 shrink-0">{field}</div>
  );
}

/**
 * A choice among many (a service, a team), drawn to sit in the bar: its
 * name in small capitals, then a compact native select.
 */
export function FilterSelect({
  label,
  className,
  ...select
}: Omit<SelectHTMLAttributes<HTMLSelectElement>, "size"> & { label: string }) {
  const id = useId();

  return (
    <div className="flex shrink-0 items-center gap-2">
      <label htmlFor={id} className="label-caps text-fg-subtle">
        {label}
      </label>
      <div className={cx("relative w-36", className)}>
        <select
          id={id}
          className="h-8 w-full appearance-none rounded-md border border-line bg-sunken pr-7 pl-2.5 text-sm text-fg transition-colors duration-(--duration-fast) hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus disabled:opacity-60"
          {...select}
        />
        <ChevronDown
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-fg-subtle"
        />
      </div>
    </div>
  );
}
