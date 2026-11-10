"use client";

import { useState } from "react";

import { SEVERITY_LEVELS, SeverityMark } from "@/components/incidents/severity";
import { cx } from "@/components/ui/cx";
import { DetailCard } from "@/components/ui/detail-layout";
import type { SeverityCounts } from "@/lib/api/contracts";

/** One day of the period: how many incidents were declared and resolved. */
export interface FlowDay {
  date: string;
  declared: number;
  resolved: number;
}

const DAY = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

const TICK = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

const dayOf = (date: string) => new Date(`${date}T00:00:00.000Z`);

/** Up to five evenly spaced days to label the axis with, first and last kept. */
const tickIndexes = (count: number): number[] => {
  if (count <= 5) return Array.from({ length: count }, (_, index) => index);

  return [
    ...new Set(
      [0, 0.25, 0.5, 0.75, 1].map((share) => Math.round(share * (count - 1))),
    ),
  ];
};

/** Where a mark sits across the plot, as a share of its width: its middle. */
const centreOf = (index: number, count: number) =>
  `${((index + 0.5) / count) * 100}%`;

/** What a label at a day does to stay inside the plot at either edge. */
const anchorAt = (index: number, count: number) =>
  count > 2 && index === 0
    ? "translate-x-0"
    : count > 2 && index === count - 1
      ? "-translate-x-full"
      : "-translate-x-1/2";

/** The key's swatch and word, so neither half is told by colour alone. */
function Key({
  tone,
  label,
  total,
}: {
  tone: "declared" | "resolved";
  label: string;
  total: number;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-fg-muted">
      <span
        aria-hidden="true"
        className={cx(
          "size-2.5 rounded-xs",
          tone === "declared" ? "bg-flow-declared" : "bg-flow-resolved",
        )}
      />
      {label}
      <span className="numeric font-semibold text-fg">{total}</span>
    </span>
  );
}

/**
 * The period day by day: incidents declared rise above the line, those
 * resolved hang below it, so a day the team fell behind is a tall bar over a
 * short one. Both halves share one scale, so they compare honestly.
 *
 * Each day is a button — named with its own counts, so the figures are
 * never the chart's alone — that narrows the page to that day. Pointing at
 * one, or focusing it, dims the rest and says its counts in a tooltip.
 */
export function FlowChart({
  days,
  onPick,
}: {
  days: readonly FlowDay[];
  /** Narrows the page to one day. */
  onPick: (date: string) => void;
}) {
  const [shown, setShown] = useState<number | null>(null);
  const count = days.length;
  const max = Math.max(1, ...days.flatMap((day) => [day.declared, day.resolved]));
  const height = (value: number) => `${(value / max) * 100}%`;
  const declared = days.reduce((sum, day) => sum + day.declared, 0);
  const resolved = days.reduce((sum, day) => sum + day.resolved, 0);
  const pointed = shown === null ? undefined : days[shown];

  return (
    <DetailCard
      id="history-flow"
      title="Declared and resolved per day"
      action={
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Key tone="declared" label="Declared" total={declared} />
          <Key tone="resolved" label="Resolved" total={resolved} />
        </span>
      }
      footer="Pick a day to see only it."
    >
      <div className="flex gap-2 px-4 pt-4 pb-3 sm:px-5">
        {/* The scale: the same count above the line as below it. */}
        <div
          aria-hidden="true"
          className="numeric flex h-40 w-5 shrink-0 flex-col justify-between text-right text-[0.6875rem] leading-none text-fg-subtle"
        >
          <span>{max}</span>
          <span>0</span>
          <span>{max}</span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="relative h-40">
            <span
              aria-hidden="true"
              className="absolute inset-x-0 top-0 border-t border-dashed border-line-subtle"
            />
            <span
              aria-hidden="true"
              className="absolute inset-x-0 bottom-0 border-t border-dashed border-line-subtle"
            />
            <span
              aria-hidden="true"
              className="absolute inset-x-0 top-1/2 border-t border-line-strong"
            />
            <div
              role="group"
              aria-label="Declared and resolved per day"
              className={cx(
                "absolute inset-0 flex",
                count <= 62 ? "gap-0.5" : "gap-0",
              )}
              onMouseLeave={() => setShown(null)}
            >
              {days.map((day, index) => (
                <button
                  key={day.date}
                  type="button"
                  aria-label={`${DAY.format(dayOf(day.date))}: ${day.declared} declared, ${day.resolved} resolved. Show only this day`}
                  onMouseEnter={() => setShown(index)}
                  onFocus={() => setShown(index)}
                  onBlur={() => setShown(null)}
                  onClick={() => onPick(day.date)}
                  className={cx(
                    "flex min-w-0 flex-1 cursor-pointer flex-col rounded-xs transition-opacity duration-(--duration-fast) hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus",
                    shown !== null && shown !== index && "opacity-40",
                  )}
                >
                  <span className="flex h-1/2 w-full items-end pb-px">
                    <span
                      className="w-full rounded-t-sm bg-flow-declared"
                      style={{ height: height(day.declared) }}
                    />
                  </span>
                  <span className="flex h-1/2 w-full items-start pt-px">
                    <span
                      className="w-full rounded-b-sm bg-flow-resolved"
                      style={{ height: height(day.resolved) }}
                    />
                  </span>
                </button>
              ))}
            </div>
            {pointed && shown !== null && (
              // Said by the button's own name too; this is for the eye.
              <div
                aria-hidden="true"
                className={cx(
                  "pointer-events-none absolute top-1 z-10 rounded-md border border-line-strong bg-surface px-2.5 py-1.5 text-xs leading-5 whitespace-nowrap shadow-lg",
                  anchorAt(shown, count),
                )}
                style={{ left: centreOf(shown, count) }}
              >
                <p className="font-semibold text-fg">
                  {DAY.format(dayOf(pointed.date))}
                </p>
                <p className="flex items-center gap-1.5 text-fg-muted">
                  <span className="size-2 rounded-xs bg-flow-declared" />
                  {pointed.declared} declared
                </p>
                <p className="flex items-center gap-1.5 text-fg-muted">
                  <span className="size-2 rounded-xs bg-flow-resolved" />
                  {pointed.resolved} resolved
                </p>
              </div>
            )}
          </div>
          <div aria-hidden="true" className="relative h-4">
            {tickIndexes(count).map((index) => (
              <span
                key={index}
                className={cx(
                  "data absolute top-0 text-[0.6875rem] whitespace-nowrap text-fg-subtle",
                  anchorAt(index, count),
                )}
                style={{ left: centreOf(index, count) }}
              >
                {TICK.format(dayOf(days[index].date))}
              </span>
            ))}
          </div>
        </div>
      </div>
    </DetailCard>
  );
}

/**
 * The period's incidents by severity, each at its severity now: a bar
 * against the most common, and the count beside it.
 */
export function SeverityCard({ counts }: { counts: SeverityCounts }) {
  const max = Math.max(1, ...SEVERITY_LEVELS.map(({ value }) => counts[value]));

  return (
    <DetailCard
      id="history-severity"
      title="By severity"
      aside="declared, at their severity now"
    >
      <dl
        aria-label="Incidents declared in this period, by current severity"
        className="flex flex-col gap-3 px-4 py-4 sm:px-5"
      >
        {SEVERITY_LEVELS.map(({ value }) => (
          <div
            key={value}
            className="grid grid-cols-[7.5rem_minmax(0,1fr)_2rem] items-center gap-3"
          >
            <dt>
              <SeverityMark severity={value} label />
            </dt>
            <span
              aria-hidden="true"
              className="h-2 overflow-hidden rounded-full bg-sunken"
            >
              <span
                className="block h-full rounded-full bg-flow-declared"
                style={{ width: `${(counts[value] / max) * 100}%` }}
              />
            </span>
            <dd
              className={cx(
                "numeric text-right font-semibold",
                counts[value] > 0 ? "text-fg" : "text-fg-subtle",
              )}
            >
              {counts[value]}
            </dd>
          </div>
        ))}
      </dl>
    </DetailCard>
  );
}
