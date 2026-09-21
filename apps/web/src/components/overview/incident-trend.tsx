"use client";

import { ChartColumn } from "lucide-react";
import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { cx } from "@/components/ui/cx";
import { EmptyNote } from "@/components/ui/empty-state";
import type {
  IncidentOccurrenceDayResponse,
  IncidentOccurrenceResponse,
} from "@/lib/api/contracts";

import { INSTRUMENT, VIEW, ViewHeader } from "./analytical-view-header";
import {
  chartTop,
  declaredPhrase,
  describeComparison,
  describeDay,
  formatAverage,
  shortDay,
  tooltipDay,
} from "./occurrence-format";

/**
 * Incident trend: "are incidents becoming more or less frequent?"
 *
 * Two readings of the API's answer, nothing more: how many incidents were
 * declared on each of the last thirty UTC days, and the seven-day average
 * the API gave for each. Both are drawn exactly as they arrived — a day
 * with no average has no point on the line, and none is interpolated.
 *
 * Drawn in the trend's own analytical colours — pale icy-aqua bars under a
 * steel-blue average, on an ink panel — never the activity calendar's ramp
 * nor a state, so the view reads as its own instrument. Nothing turns red or green: more
 * incidents is information, not an alarm.
 *
 * Built for sparse history: most days of a real month have nothing on
 * them. A quiet day is a small neutral stub on the baseline, so it reads as
 * a day that was counted; a day before the organization's history has no
 * baseline at all, so it can never be mistaken for a quiet one; today,
 * which is not over, is drawn hollow and said to be "so far".
 */

/**
 * One statistic as a badge: the number beside what it counts and a line of
 * context, in a compact bordered chip of its own. The number leads the eye
 * and the words qualify it; the markup still reads term before value. Two
 * chips side by side in the view's header, each a reading of the same
 * thirty days.
 */
const figure =
  "grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-0 rounded-md border border-line-subtle bg-surface py-1 pr-3 pl-2.5";
const figureValue =
  "numeric order-first row-span-2 text-xl leading-7 font-semibold tracking-[-0.02em] text-fg";
const figureLabel = "self-end text-xs leading-4 font-medium text-fg";
const figureContext = "self-start text-2xs leading-4 text-fg-muted";

/** The glyph beside a change. Neutral, like the words. */
const DIRECTION_GLYPH = { up: "↑", down: "↓" } as const;

/**
 * The two figures the chart is read with: how many were declared, against
 * the period before, and how many days had none. Statistics of the chart,
 * set as two badges in the view's header, beside its name.
 *
 * Where the API gave a percentage the comparison is shown short — "↑ 33% vs
 * previous 30 days", the glyph saying which way — and read in full by
 * assistive technology: "33% more than the previous 30 days". Anything else
 * is the API-driven sentence itself, both ways.
 */
function TrendFigures({
  occurrence,
}: {
  occurrence: IncidentOccurrenceResponse;
}) {
  const comparison = describeComparison(occurrence);
  const glyph =
    comparison.direction === "up" || comparison.direction === "down"
      ? DIRECTION_GLYPH[comparison.direction]
      : null;

  return (
    <dl className="flex flex-wrap items-center gap-2">
      <div className={figure}>
        <dt className={figureLabel}>Incidents declared</dt>
        <dd className={figureValue}>{occurrence.declared}</dd>
        <dd className={figureContext}>
          {glyph && (
            <span aria-hidden="true" className="mr-1 text-fg-subtle">
              {glyph}
            </span>
          )}
          {comparison.short === comparison.text ? (
            comparison.text
          ) : (
            <>
              <span aria-hidden="true">{comparison.short}</span>
              <span className="sr-only">{comparison.text}</span>
            </>
          )}
        </dd>
      </div>
      <div className={figure}>
        <dt className={figureLabel}>Incident-free days</dt>
        <dd className={figureValue}>
          {occurrence.incidentFreeDays}
          <span className="sr-only">
            {` of ${occurrence.completeDays} complete ${
              occurrence.completeDays === 1 ? "day" : "days"
            }`}
          </span>
        </dd>
        <dd aria-hidden="true" className={figureContext}>
          of {occurrence.completeDays} complete
        </dd>
      </div>
    </dl>
  );
}

/**
 * The chart's key: one mark per series, and today's hollow bar when shown.
 * Notation, not information — set small and quiet beneath the chart's ink
 * panel, as a caption to what is drawn on it.
 */
function Legend({ partialToday }: { partialToday: boolean }) {
  return (
    <ul
      aria-hidden="true"
      className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-2xs text-fg-subtle"
    >
      <li className="flex items-center gap-1.5">
        <span className="h-2 w-1.5 rounded-t-xs bg-trend-bar" />
        Declared per day
      </li>
      <li className="flex items-center gap-1.5">
        <span className="h-0.5 w-3.5 rounded-full bg-trend-line" />
        7-day average
      </li>
      {partialToday && (
        <li className="flex items-center gap-1.5">
          <span className="h-2 w-1.5 rounded-t-xs border border-trend-bar bg-trend-bar/30" />
          Today, so far
        </li>
      )}
    </ul>
  );
}

/**
 * The average as one or more runs of straight segments, one point per day
 * that has an average, at the centre of its column. A day without one ends
 * the run: the line never bridges a gap it has no value for.
 */
const averagePath = (
  days: readonly IncidentOccurrenceDayResponse[],
  top: number,
): string => {
  let path = "";
  let drawing = false;

  days.forEach((day, index) => {
    if (day.rollingAverage === null) {
      drawing = false;
      return;
    }

    const x = index + 0.5;
    const y = 100 - (day.rollingAverage / top) * 100;

    path += `${drawing ? "L" : "M"}${x} ${y}`;
    drawing = true;
  });

  return path;
};

/** One day's mark: a bar, a quiet stub, or — before history — nothing. */
function DayMark({
  day,
  top,
}: {
  day: IncidentOccurrenceDayResponse;
  top: number;
}) {
  if (!day.tracked) return null;

  // Most of the column, so a single incident has presence; capped, so a
  // wide chart does not turn its days into blocks.
  const width = "w-[66%] max-w-[1.125rem] min-w-[3px]";

  if (day.declared === 0) {
    // A counted day with nothing on it: a stub, neutral, on the baseline.
    return day.complete ? (
      <span className={cx(width, "h-0.75 rounded-t-xs bg-line-strong")} />
    ) : null;
  }

  return (
    <span
      className={cx(
        width,
        "rounded-t-xs",
        day.complete
          ? "bg-trend-bar"
          : "border border-b-0 border-trend-bar bg-trend-bar/30",
      )}
      style={{ height: `${(day.declared / top) * 100}%` }}
    />
  );
}

/**
 * What the day under the pointer or the focus comes to. Visual only: the
 * same words are each day's own text for assistive technology.
 */
function DayTooltip({
  day,
  index,
  count,
}: {
  day: IncidentOccurrenceDayResponse;
  index: number;
  count: number;
}) {
  const centre = ((index + 0.5) / count) * 100;
  // Held inside the chart at its ends rather than overhanging them.
  const placement =
    index < count * 0.2
      ? { left: `${(index / count) * 100}%` }
      : index >= count * 0.8
        ? { right: `${100 - ((index + 1) / count) * 100}%` }
        : { left: `${centre}%`, transform: "translateX(-50%)" };

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute bottom-[calc(100%+0.5rem)] z-10 flex w-max max-w-56 flex-col gap-0.5 rounded-md border border-line bg-ink-inset px-2.5 py-1.5 text-xs shadow-overlay"
      style={placement}
    >
      <p className="font-medium text-fg">
        {tooltipDay(day.date)}
        {!day.complete && day.tracked && (
          <span className="font-normal text-fg-muted"> · today</span>
        )}
      </p>
      {day.tracked ? (
        <>
          <p className="text-fg">{declaredPhrase(day)}</p>
          {day.rollingAverage !== null && (
            <p className="text-fg-muted">
              7-day average{" "}
              <span className="numeric text-fg">
                {formatAverage(day.rollingAverage)}
              </span>
            </p>
          )}
        </>
      ) : (
        <p className="text-fg-muted">Before this organization&apos;s history</p>
      )}
    </div>
  );
}

/** Where the three dates sit under the chart: its ends, and its middle. */
function Axis({ days }: { days: readonly IncidentOccurrenceDayResponse[] }) {
  const last = days.length - 1;
  const middle = Math.floor(last / 2);
  const lastDay = days[last];

  return (
    <div
      aria-hidden="true"
      className="relative h-4 text-2xs leading-4 text-fg-subtle"
    >
      <span className="absolute left-0">{shortDay(days[0].date)}</span>
      <span
        className="absolute -translate-x-1/2"
        style={{ left: `${((middle + 0.5) / days.length) * 100}%` }}
      >
        {shortDay(days[middle].date)}
      </span>
      <span className="absolute right-0">
        {lastDay.complete ? shortDay(lastDay.date) : "Today"}
      </span>
    </div>
  );
}

/**
 * The chart itself. Each day is a column the full height of the plot — the
 * hover and focus target, far larger than its bar — in a list that takes
 * one Tab stop: the arrow keys, Home, and End move between days, and the
 * focused day shows the same tooltip the pointer does. Each column carries
 * its day in words, so a screen reader reads the chart as a list of days.
 */
function TrendChart({ days }: { days: readonly IncidentOccurrenceDayResponse[] }) {
  const top = chartTop(days);
  const [focusIndex, setFocusIndex] = useState(days.length - 1);
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const columns = useRef<(HTMLLIElement | null)[]>([]);
  const shown = hovered ?? focused;
  const path = averagePath(days, top);

  const move = (event: KeyboardEvent<HTMLOListElement>) => {
    const next = {
      ArrowRight: Math.min(focusIndex + 1, days.length - 1),
      ArrowLeft: Math.max(focusIndex - 1, 0),
      Home: 0,
      End: days.length - 1,
    }[event.key];

    if (next === undefined) return;

    event.preventDefault();
    setFocusIndex(next);
    columns.current[next]?.focus();
  };

  return (
    <div className="flex gap-2">
      {/* The scale: its top and its floor, and nothing between. */}
      <div
        aria-hidden="true"
        className="flex h-24 w-4 shrink-0 flex-col justify-between text-right text-2xs leading-none text-fg-subtle sm:h-28"
      >
        <span className="numeric -translate-y-1/2">{top}</span>
        <span className="numeric translate-y-1/2">0</span>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="relative h-24 sm:h-28">
          {/* The one guide: where the top of the scale is. */}
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-0 border-t border-line-subtle"
          />

          <ol
            aria-label="Incidents declared per day"
            onKeyDown={move}
            className="absolute inset-0 grid"
            style={{
              gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`,
            }}
          >
            {days.map((day, index) => (
              <li
                key={day.date}
                ref={(element) => {
                  columns.current[index] = element;
                }}
                tabIndex={index === focusIndex ? 0 : -1}
                data-date={day.date}
                data-active={shown === index || undefined}
                onPointerEnter={() => setHovered(index)}
                onPointerLeave={() =>
                  setHovered((current) => (current === index ? null : current))
                }
                onFocus={() => {
                  setFocusIndex(index);
                  setFocused(index);
                }}
                onBlur={() =>
                  setFocused((current) => (current === index ? null : current))
                }
                className={cx(
                  "relative flex h-full items-end justify-center rounded-t-xs transition-colors duration-(--duration-fast) focus-visible:-outline-offset-2 data-active:bg-hover",
                  // The baseline, under every counted day and no other.
                  day.tracked && "border-b border-line",
                )}
              >
                <span className="sr-only">{describeDay(day)}</span>
                <DayMark day={day} top={top} />
              </li>
            ))}
          </ol>

          {path && (
            <svg
              aria-hidden="true"
              viewBox={`0 0 ${days.length} 100`}
              preserveAspectRatio="none"
              className="pointer-events-none absolute inset-0 size-full overflow-visible"
            >
              {/* A ring of the ink panel first, so the line stays whole
                  where it crosses a bar. */}
              <path
                d={path}
                fill="none"
                strokeWidth={5.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                className="stroke-ink"
              />
              <path
                d={path}
                fill="none"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeLinejoin="round"
                vectorEffect="non-scaling-stroke"
                className="stroke-trend-line"
              />
            </svg>
          )}

          {shown !== null && days[shown] && (
            <DayTooltip day={days[shown]} index={shown} count={days.length} />
          )}
        </div>

        <Axis days={days} />
      </div>
    </div>
  );
}

export function IncidentTrend({
  occurrence,
}: {
  occurrence: IncidentOccurrenceResponse;
}) {
  const { days, declared, trackedFrom } = occurrence;
  const tracked = days.filter((day) => day.tracked);
  const untracked = days.length - tracked.length;
  const partialToday = days.some((day) => day.tracked && !day.complete);

  let content;

  if (trackedFrom === null || tracked.length === 0) {
    content = (
      <EmptyNote title="Not enough history yet">
        The trend appears once this organization has incidents on record.
      </EmptyNote>
    );
  } else if (declared === 0) {
    const comparison = describeComparison(occurrence);

    content = (
      <EmptyNote title={`No incidents declared in the last ${days.length} days`}>
        {comparison.text}.
      </EmptyNote>
    );
  } else {
    content = (
      <>
        {/* The chart on its ink panel, level with the services' beside it. */}
        <div className={cx(INSTRUMENT, "px-3 pt-4 pb-2.5")}>
          <TrendChart days={days} />
        </div>
        {/* Its caption: the key, and where the record begins. */}
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1.5">
          <Legend partialToday={partialToday} />
          {untracked > 0 && (
            <p className="text-xs text-fg-subtle">
              History begins {shortDay(trackedFrom)}. Earlier days have no
              record.
            </p>
          )}
        </div>
      </>
    );
  }

  const drawn = trackedFrom !== null && tracked.length > 0 && declared > 0;

  return (
    <div className={VIEW}>
      <ViewHeader
        id="incident-trend-title"
        title="Incident trend"
        definition="Incidents declared per UTC day"
        Icon={ChartColumn}
        family="[--family:var(--color-trend-bar)]"
        aside={drawn && <TrendFigures occurrence={occurrence} />}
      />
      {content}
    </div>
  );
}
