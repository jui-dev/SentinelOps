"use client";

import { useState } from "react";

import { SEVERITY_LEVELS, SeverityMark } from "@/components/incidents/severity";
import { cx } from "@/components/ui/cx";
import { INSTRUMENT } from "@/components/overview/analytical-view-header";
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

/** The key's swatch: declared rises from the line, resolved hangs below it. */
function Swatch({ tone }: { tone: "declared" | "resolved" }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "h-2.5 w-2",
        tone === "declared"
          ? "rounded-t-xs bg-trend-bar"
          : "rounded-b-xs bg-trend-line",
      )}
    />
  );
}

/**
 * One reading of the period as a badge, set in the card's header beside its
 * title, as the Overview's trend sets its own: the number first, then what
 * it counts and a line of context.
 */
const figure =
  "grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 rounded-md border border-line-subtle bg-surface py-1 pr-3 pl-2.5";
const figureValue =
  "numeric order-first row-span-2 text-xl leading-7 font-semibold tracking-[-0.02em] text-fg";
const figureLabel = "self-end text-xs leading-4 font-medium text-fg";
const figureContext = "self-start text-2xs leading-4 text-fg-muted";

/** The figures the chart is read with, from the same days it draws. */
function FlowFigures({ days }: { days: readonly FlowDay[] }) {
  const declared = days.reduce((sum, day) => sum + day.declared, 0);
  const resolved = days.reduce((sum, day) => sum + day.resolved, 0);
  const net = declared - resolved;
  const busiest = days.reduce<FlowDay | undefined>(
    (best, day) => (day.declared > (best?.declared ?? 0) ? day : best),
    undefined,
  );

  return (
    <dl className="flex flex-wrap items-center gap-2">
      <div className={figure}>
        <dt className={figureLabel}>Declared</dt>
        <dd className={figureValue}>{declared}</dd>
        <dd className={figureContext}>in this period</dd>
      </div>
      <div className={figure}>
        <dt className={figureLabel}>Resolved</dt>
        <dd className={figureValue}>{resolved}</dd>
        <dd className={figureContext}>in this period</dd>
      </div>
      <div className={figure}>
        <dt className={figureLabel}>Net change</dt>
        <dd className={figureValue}>
          {net > 0 ? `+${net}` : net < 0 ? `−${-net}` : "0"}
        </dd>
        <dd className={figureContext}>declared − resolved</dd>
      </div>
      <div className={figure}>
        <dt className={figureLabel}>Busiest day</dt>
        <dd className={figureValue}>{busiest ? busiest.declared : "–"}</dd>
        <dd className={figureContext}>
          {busiest ? DAY.format(dayOf(busiest.date)) : "nothing declared"}
        </dd>
      </div>
    </dl>
  );
}

/** The scale's marks: the top, the middle when it is a whole number, and 0. */
const scaleOf = (max: number): number[] =>
  max >= 2 && max % 2 === 0 ? [max, max / 2, 0] : [max, 0];

/**
 * The period day by day, in the Overview trend's colours on its ink panel:
 * incidents declared rise above the line in icy aqua, those resolved hang
 * below it in steel blue, so a day the team fell behind is a tall bar over
 * a short one. Both halves share one scale, so they compare honestly; the
 * colours are told apart by where they sit as well as by hue.
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
  const pointed = shown === null ? undefined : days[shown];
  const scale = scaleOf(max);

  return (
    <DetailCard
      id="history-flow"
      title="Declared and resolved per day"
      action={<FlowFigures days={days} />}
    >
      <div className="p-3 sm:p-4">
        <div className={cx(INSTRUMENT, "flex flex-col gap-4 p-4 sm:p-5")}>
          <div className="flex gap-2.5">
            {/* The scale: the same counts above the line as below it. */}
            <div
              aria-hidden="true"
              className="numeric relative h-48 w-5 shrink-0 text-right text-[0.6875rem] leading-none text-fg-muted"
            >
              {scale.map((value) => (
                <span key={`up-${value}`}>
                  <span
                    className="absolute right-0 -translate-y-1/2"
                    style={{ top: `${50 - (value / max) * 50}%` }}
                  >
                    {value}
                  </span>
                  {value > 0 && (
                    <span
                      className="absolute right-0 -translate-y-1/2"
                      style={{ top: `${50 + (value / max) * 50}%` }}
                    >
                      {value}
                    </span>
                  )}
                </span>
              ))}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <div className="relative h-48">
                {scale
                  .filter((value) => value > 0)
                  .flatMap((value) => [
                    50 - (value / max) * 50,
                    50 + (value / max) * 50,
                  ])
                  .map((top) => (
                    <span
                      key={top}
                      aria-hidden="true"
                      className="absolute inset-x-0 border-t border-ink-line/60"
                      style={{ top: `${top}%` }}
                    />
                  ))}
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 top-1/2 border-t border-ink-muted/70"
                />
                <div
                  role="group"
                  aria-label="Declared and resolved per day"
                  className={cx(
                    "absolute inset-0 flex",
                    count <= 45 ? "gap-1" : count <= 92 ? "gap-0.5" : "gap-0",
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
                        "flex min-w-0 flex-1 cursor-pointer flex-col rounded-xs transition-opacity duration-(--duration-fast) focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus",
                        shown === index && "bg-ink-inset-hover",
                        shown !== null && shown !== index && "opacity-35",
                      )}
                    >
                      <span className="flex h-1/2 w-full items-end pb-0.5">
                        <span
                          className="w-full rounded-t-[3px] rounded-b-[1px] bg-trend-bar"
                          style={{ height: height(day.declared) }}
                        />
                      </span>
                      <span className="flex h-1/2 w-full items-start pt-0.5">
                        <span
                          className="w-full rounded-t-[1px] rounded-b-[3px] bg-trend-line"
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
                      "pointer-events-none absolute top-1 z-10 rounded-md border border-ink-line bg-ink px-2.5 py-1.5 text-xs leading-5 whitespace-nowrap shadow-overlay",
                      anchorAt(shown, count),
                    )}
                    style={{ left: centreOf(shown, count) }}
                  >
                    <p className="font-semibold text-fg">
                      {DAY.format(dayOf(pointed.date))}
                    </p>
                    <p className="flex items-center gap-1.5 text-fg-muted">
                      <Swatch tone="declared" />
                      {pointed.declared} declared
                    </p>
                    <p className="flex items-center gap-1.5 text-fg-muted">
                      <Swatch tone="resolved" />
                      {pointed.resolved} resolved
                    </p>
                    <p className="text-2xs text-fg-muted">Click to see only this day</p>
                  </div>
                )}
              </div>
              <div aria-hidden="true" className="relative h-4">
                {tickIndexes(count).map((index) => (
                  <span
                    key={index}
                    className={cx(
                      "data absolute top-0 text-[0.6875rem] whitespace-nowrap text-fg-muted",
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

          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-ink-line pt-3 text-xs text-fg-muted">
            <span className="flex items-center gap-4">
              <span className="inline-flex items-center gap-1.5">
                <Swatch tone="declared" />
                Declared
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Swatch tone="resolved" />
                Resolved
              </span>
            </span>
            <span>Point at a day for its counts; click it to see only that day.</span>
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
                className="block h-full rounded-full bg-trend-bar"
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
