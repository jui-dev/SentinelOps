import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cx } from "./cx";

/**
 * The pieces a detail page — a team's, a member's — is built from: a glance
 * band of tiles on the band's ground, and cards that sit level in rows.
 * Shared, so every detail page reads alike.
 */

// ── The glance band ─────────────────────────────────────────────────────────

export type GlanceTone =
  | "neutral"
  | "accent"
  | "info"
  | "warning"
  | "investigating"
  | "resolved"
  | "danger";

/** Each tile's icon square: a quiet fill in one of the system's own tones. */
const CHIPS: Record<GlanceTone, string> = {
  neutral: "border-line-strong bg-hover text-fg-muted",
  accent: "border-accent-line bg-accent-subtle text-accent-text",
  info: "border-info-line bg-info-subtle text-info-text",
  warning: "border-warning-line bg-warning-subtle text-warning-text",
  investigating:
    "border-status-investigating-line bg-status-investigating-subtle text-status-investigating-text",
  resolved:
    "border-status-resolved-line bg-status-resolved-subtle text-status-resolved-text",
  danger: "border-danger-line bg-danger-subtle text-danger-text",
};

/** A tile's note in its tone, for a figure that wants noticing. */
const NOTE_TONES: Record<GlanceTone, string> = {
  neutral: "text-fg-muted",
  accent: "text-accent-text",
  info: "text-info-text",
  warning: "text-warning-text",
  investigating: "text-status-investigating-text",
  resolved: "text-status-resolved-text",
  danger: "text-danger-text",
};

/**
 * The tile's wash in light (`tint-wash`): the family of its tone. Dark keeps
 * the tile's own edge, so it is as it was. Whole class strings, so the
 * stylesheet finds every one of them.
 */
const WASHES: Record<GlanceTone, string> = {
  neutral: "[--family:var(--color-fg-muted)]",
  accent: "[--family:var(--color-accent)]",
  info: "[--family:var(--color-info-text)]",
  warning: "[--family:var(--color-warning-text)]",
  investigating: "[--family:var(--color-status-investigating-text)]",
  resolved: "[--family:var(--color-status-resolved-text)]",
  danger: "[--family:var(--color-wash-active)]",
};

export function GlanceTile({
  label,
  value,
  note,
  icon: Icon,
  tone,
  noteTone = false,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  icon: LucideIcon;
  tone: GlanceTone;
  /** Whether the note carries the tile's tone, for what wants noticing. */
  noteTone?: boolean;
}) {
  return (
    // The term and its value are the group's own children, as a <dl> asks;
    // the icon sits in the term, placed at the tile's leading edge.
    <div
      className={cx(
        "tint-wash relative flex min-w-0 flex-col justify-center gap-0.5 rounded-lg border bg-surface py-3.5 pr-4 pl-17 shadow-[0_1px_2px_light-dark(rgb(15_29_51/0.06),transparent)] [--wash-line:var(--color-line)]",
        WASHES[tone],
      )}
    >
      <dt className="text-sm text-fg-muted">
        <span
          aria-hidden="true"
          className={cx(
            "absolute top-1/2 left-4 grid size-9.5 -translate-y-1/2 place-items-center rounded-lg border",
            CHIPS[tone],
          )}
        >
          <Icon strokeWidth={1.75} className="size-4.5" />
        </span>
        {label}
      </dt>
      <dd className="flex flex-wrap items-baseline gap-x-2">
        <span className="numeric text-2xl leading-tight font-semibold text-fg">
          {value}
        </span>
        {note && (
          <span
            className={cx(
              "text-xs",
              noteTone ? NOTE_TONES[tone] : "text-fg-subtle",
            )}
          >
            {note}
          </span>
        )}
      </dd>
    </div>
  );
}

/**
 * The band that holds a page's tiles, two or four across.
 *
 * The one rule for a band's ground: what SUMMARISES — a page's figures, an
 * incident's or an analysis's facts — sits on the band gradient (`band-top`
 * → `band-bottom`: the rail's own dark ground in dark, plain white in light,
 * where the rail is navy), as this does; what CONTROLS a list — search,
 * filters, a period — sits on the plain surface (ui/filter-bar.tsx). So a
 * reader can tell at a glance which bands are read and which are used.
 */
export function Glance({
  label,
  columns,
  children,
}: {
  /** "Payments at a glance" — names the list for assistive technology. */
  label: string;
  columns: 2 | 3 | 4 | 5;
  children: ReactNode;
}) {
  return (
    <dl
      aria-label={label}
      className={cx(
        "grid gap-3 rounded-lg border border-line-subtle bg-linear-to-b from-band-top to-band-bottom p-3.5",
        columns === 5
          ? "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5"
          : columns === 4
            ? "grid-cols-1 sm:grid-cols-2 xl:grid-cols-4"
            : columns === 3
              ? "grid-cols-1 sm:grid-cols-3"
              : "grid-cols-1 sm:grid-cols-2",
      )}
    >
      {children}
    </dl>
  );
}

// ── Cards ───────────────────────────────────────────────────────────────────

/**
 * One of the page's cards: a header band of one height, its content, and a
 * note pinned to its foot — so two cards side by side line up top, header,
 * and bottom whatever each holds.
 */
export function DetailCard({
  id,
  title,
  meta,
  aside,
  action,
  footer,
  className,
  children,
}: {
  id: string;
  title: string;
  meta?: ReactNode;
  /** A short line beside the title: what the card covers. */
  aside?: ReactNode;
  action?: ReactNode;
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className={cx(
        "flex min-w-0 flex-col overflow-hidden rounded-lg border border-section-line bg-section shadow-card",
        className,
      )}
    >
      <div className="flex min-h-13 flex-wrap items-center gap-x-4 gap-y-1 border-b border-section-line bg-section-head px-4 py-2 sm:px-5">
        <h2 id={`${id}-title`} className="text-base font-semibold text-fg">
          {title}
          {meta !== undefined && (
            <span className="numeric ml-1.5 font-normal text-fg-subtle">
              {meta}
            </span>
          )}
        </h2>
        {aside && <span className="text-sm text-fg-muted">{aside}</span>}
        {action && <span className="ml-auto">{action}</span>}
      </div>
      <div className="flex-1">{children}</div>
      {footer && (
        <div className="border-t border-line-subtle px-4 py-2.5 text-xs leading-relaxed text-fg-subtle sm:px-5">
          {footer}
        </div>
      )}
    </section>
  );
}

/**
 * Two cards side by side, level with each other; stacked on a phone.
 * `main` gives the first the room and the second a side column; `halves`
 * shares the width equally.
 */
export function CardRow({
  layout = "main",
  children,
}: {
  layout?: "main" | "halves";
  children: ReactNode;
}) {
  return (
    <div
      className={cx(
        "grid grid-cols-1 items-stretch gap-6",
        layout === "main"
          ? "lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]"
          : "lg:grid-cols-2",
      )}
    >
      {children}
    </div>
  );
}
