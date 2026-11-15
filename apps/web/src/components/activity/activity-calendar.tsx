"use client";

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import type { ActivityTone } from "@/components/activity/activity-panes";
import { cx } from "@/components/ui/cx";
import type { ActivityDay, CalendarCell } from "@/lib/activity/calendar";
import {
  monthLabels,
  moveFocus,
  toWeeks,
  WEEKDAYS,
} from "@/lib/activity/calendar";
import { startOfUtcDay } from "@/lib/period/period";

/**
 * The activity calendar: a run of UTC days as Sunday-to-Saturday columns,
 * each day a square whose size and colour say how much happened on it.
 *
 * A presentation primitive, and only that. It is given days that already
 * carry their level and draws them; it never looks at what the activity was,
 * counts anything, or decides a threshold. Both features that will use it —
 * the organization's operational activity and one member's response
 * activity — bring their own meaning, their own words, and their own
 * selected-day detail, and share the grid, the keys, and the accessibility
 * here.
 *
 * Two channels carry intensity, never colour alone: a quiet day is a small
 * dot and a busy one a filled square, growing step by step, and each day's
 * accessible name says its total in words. The ramps are the `activity`
 * token family (globals.css) — blue to cyan for an organization, ice for
 * a person — and neither is a signal colour: this is how much happened, never
 * how bad it was.
 */

export type ActivityVariant = "operational" | "personal";

/**
 * How a day nothing happened on is filled.
 *
 * Every day is the same square now, so intensity is the ramp's alone — and
 * a quiet day must not read as a faint amount of something. It is given no
 * blue at all: a neutral fill inside a hairline, so it reads as an empty
 * slot. Between `activity-empty` and the ramp's first step there is barely
 * a fifth of a stop of lightness, which was enough while the two were also
 * different sizes and is not enough now. The edge is what carries it.
 */
/**
 * The materials the calendar itself is drawn on. The panes know a third —
 * the navy inset a chosen day is written on — but the grid is never on it:
 * the ground is one surface, and what is picked out of it is the other.
 */
type CalendarTone = Extract<ActivityTone, "surface" | "ink">;

const QUIET: Record<CalendarTone, string> = {
  surface: "border border-line bg-activity-empty",
  ink: "border border-ink-line bg-activity-ink-empty",
};

/**
 * How each day is filled, by the material under it and then by level: the
 * quiet slot, then the four steps of the variant's ramp. Nothing here
 * changes size — a busier day is a stronger blue and never a bigger mark.
 *
 * Two ramps per variant because the panel has two materials. The workspace
 * ramp darkens in light and lightens in dark; the ink one moves off its
 * panel — lightening off the dark one, darkening off the white one.
 */
const FILLS: Record<CalendarTone, Record<ActivityVariant, readonly string[]>> =
  {
    surface: {
      operational: [
        QUIET.surface,
        "bg-activity-operational-1",
        "bg-activity-operational-2",
        "bg-activity-operational-3",
        "bg-activity-operational-4",
      ],
      personal: [
        QUIET.surface,
        "bg-activity-personal-1",
        "bg-activity-personal-2",
        "bg-activity-personal-3",
        "bg-activity-personal-4",
      ],
    },
    ink: {
      operational: [
        QUIET.ink,
        "bg-activity-ink-operational-1",
        "bg-activity-ink-operational-2",
        "bg-activity-ink-operational-3",
        "bg-activity-ink-operational-4",
      ],
      personal: [
        QUIET.ink,
        "bg-activity-ink-personal-1",
        "bg-activity-ink-personal-2",
        "bg-activity-ink-personal-3",
        "bg-activity-ink-personal-4",
      ],
    },
  };

/**
 * Everything drawn around the squares, by the material under it. The ink
 * panel cannot borrow the workspace's own lines and marks: `fg` and
 * `accent-mark` are near-black in the light theme and would vanish on it,
 * so the ink column names its own.
 */
const MARKS: Record<
  CalendarTone,
  {
    /** The weekday and month names, and the rules beside them. */
    label: string;
    current: string;
    rule: string;
    /** A day of the year still to come. */
    future: string;
    /** The hint that a square can be chosen. */
    hint: string;
    today: string;
    selected: string;
    /** Empty where the workspace's own focus ring already reads. */
    focus: string;
  }
> = {
  surface: {
    label: "text-fg-subtle",
    current: "text-fg-muted",
    rule: "border-line-subtle",
    future: "border-line-subtle",
    hint: "hover:before:border-line-strong",
    today: "after:border-accent-mark",
    selected: "after:border-fg",
    focus: "",
  },
  ink: {
    label: "text-ink-muted",
    current: "text-ink-fg",
    rule: "border-ink-line",
    future: "border-ink-line",
    hint: "hover:before:border-ink-hover",
    today: "after:border-ink-accent",
    selected: "after:border-ink-fg",
    focus: "focus-visible:outline-ink-accent",
  },
};

/**
 * The grid's geometry. The cell never changes size — marks grow inside it —
 * so a column's pitch is one number the month labels can be placed against.
 */
const CELL_PX = 15;
const GAP_PX = 2;
const COLUMN_PX = CELL_PX + GAP_PX;
const CELL = "size-[15px]";

const DATE = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

/**
 * What a day is worth, in words, for its accessible name. Domain-free by
 * design: a feature counting something more particular than "events" passes
 * its own wording.
 */
export const describeActivity = (day: ActivityDay): string =>
  day.total === 0
    ? "no activity"
    : `${day.total} ${day.total === 1 ? "event" : "events"}, level ${day.level} of 4`;

export interface ActivityCalendarProps {
  /**
   * The days to draw, oldest first — every day of the period, quiet ones
   * included, exactly as the activity routes answer. Whole weeks are filled
   * out around them.
   */
  days: readonly ActivityDay[];
  /** Names the grid for assistive technology: "Operational activity". */
  label: string;
  variant: ActivityVariant;
  /** The selected day, held by the parent. Null is nothing selected. */
  selected: string | null;
  /** A day was chosen, or the selection was cleared with Escape. */
  onSelect: (date: string | null) => void;
  /**
   * How a day's activity is said in its accessible name. The date is added
   * here; this supplies the rest.
   */
  describeDay?: (day: ActivityDay) => string;
  /**
   * Today, UTC. Days after it are drawn as still to come rather than as
   * quiet ones, and it is marked. Defaults to the last day given.
   */
  today?: string;
  /**
   * The stretch of days the calendar covers, whatever the API answered for
   * — a whole year, say, where only the days so far have rows. Defaults to
   * the span of `days`.
   */
  range?: { from: string; to: string };
  /**
   * The material the calendar is drawn on, which has to match the surface
   * it is placed in (activity-panes.tsx). Ink is the instrument panel.
   */
  tone?: CalendarTone;
}

/** One square: a real day, or a gap where no day belongs. */
function Cell({
  cell,
  variant,
  tone,
  selected,
  focused,
  describeDay,
  onSelect,
  onFocus,
  register,
}: {
  cell: CalendarCell;
  variant: ActivityVariant;
  tone: CalendarTone;
  selected: boolean;
  focused: boolean;
  describeDay: (day: ActivityDay) => string;
  onSelect: (date: string) => void;
  onFocus: (date: string) => void;
  register: (date: string, element: HTMLButtonElement | null) => void;
}) {
  if (cell.kind !== "day") {
    return (
      <div role="gridcell" className={cx(CELL, "shrink-0")}>
        {/*
          A day of the year still to come keeps its place in the year's
          shape, drawn as an open outline so it can never read as a quiet
          day. A day of the neighbouring year is not drawn at all.
        */}
        {cell.kind === "future" && (
          <span
            aria-hidden="true"
            data-future="true"
            className={cx(
              "block size-full rounded-xs border border-dashed opacity-70",
              MARKS[tone].future,
            )}
          />
        )}
      </div>
    );
  }

  const { day } = cell;

  return (
    <div
      role="gridcell"
      aria-selected={selected}
      className={cx(CELL, "shrink-0")}
    >
      <button
        ref={(element) => register(cell.date, element)}
        type="button"
        // One tab stop for the whole grid; the arrows move within it.
        tabIndex={focused ? 0 : -1}
        aria-label={`${DATE.format(startOfUtcDay(cell.date))}${
          cell.today ? " (today)" : ""
        } — ${describeDay(day)}`}
        data-date={cell.date}
        data-level={day.level}
        data-today={cell.today ? "true" : undefined}
        onFocus={() => onFocus(cell.date)}
        onClick={() => onSelect(cell.date)}
        className={cx(
          "relative block size-full rounded-xs",
          // The workspace's own focus ring is too dark to read on ink, so
          // the ink panel names a ring of its own.
          MARKS[tone].focus,
          // Hover is a hint that a square can be chosen, and nothing more.
          // Its own edge, so it never competes with the two below for the
          // one `after` each cell has.
          !selected &&
            !cell.today &&
            cx(
              "hover:before:absolute hover:before:-inset-px hover:before:rounded-sm hover:before:border hover:before:content-['']",
              MARKS[tone].hint,
            ),
          // Today: the accent's quiet edge, the same mark the rail puts on
          // the current place. Weaker than a selection, and always there.
          cell.today &&
            !selected &&
            cx(
              "after:absolute after:-inset-[2px] after:rounded-sm after:border after:content-['']",
              MARKS[tone].today,
            ),
          // Selection is an edge drawn around the square, so it reads
          // beside the focus outline — which sits further out, in the
          // panel's own focus colour — rather than instead of it.
          selected &&
            cx(
              "after:absolute after:-inset-[2px] after:rounded-sm after:border-[1.5px] after:content-[''] forced-colors:after:border-[Highlight]",
              MARKS[tone].selected,
            ),
        )}
      >
        <span
          aria-hidden="true"
          className={cx(
            "block size-full rounded-xs",
            FILLS[tone][variant][day.level],
            // The ramp collapses to one colour in a forced-colours theme,
            // where an outline is all that is left to tell a day apart.
            "forced-color-adjust-none",
            day.level === 0
              ? "forced-colors:bg-[Canvas]"
              : "forced-colors:bg-[CanvasText]",
          )}
        />
      </button>
    </div>
  );
}

/**
 * What the colours mean, said once, quiet to busy. The only place the scale
 * is spelled out — the grid itself carries no numbers.
 */
function Legend({
  variant,
  tone,
}: {
  variant: ActivityVariant;
  tone: CalendarTone;
}) {
  return (
    <p className={cx("flex items-center gap-2 text-xs", MARKS[tone].label)}>
      <span>Quiet</span>
      <span aria-hidden="true" className="flex items-center gap-[2px]">
        {[0, 1, 2, 3, 4].map((level) => (
          <span
            key={level}
            className={cx(CELL, "block rounded-xs", FILLS[tone][variant][level])}
          />
        ))}
      </span>
      <span>Busy</span>
    </p>
  );
}

export function ActivityCalendar({
  days,
  label,
  variant,
  selected,
  onSelect,
  describeDay = describeActivity,
  today,
  range,
  tone = "surface",
}: ActivityCalendarProps) {
  const weeks = toWeeks(days, { today, range });
  const months = monthLabels(weeks);
  const currentMonth = today?.slice(0, 7);

  // The focusable days in order, which are the real ones: a placeholder is
  // never focused, so the arrows never land on a day that has not happened.
  const dates = weeks
    .flat()
    .filter((cell) => cell.kind === "day")
    .map((cell) => cell.date);

  /** Which column each day sits in, for keeping a chosen one in view. */
  const columnOf = new Map(
    weeks.flatMap((week, column) => week.map((cell) => [cell.date, column])),
  );

  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const scroller = useRef<HTMLDivElement>(null);
  const [focusedDate, setFocusedDate] = useState<string | null>(null);

  // The one tab stop: the day focus last left, else the selected one, else
  // the most recent — so tabbing in lands where the eye already is.
  const remembered = [focusedDate, selected].find(
    (date) => date !== null && dates.includes(date),
  );
  const roving = remembered ?? dates[dates.length - 1];

  // The recent end is the one worth seeing first, and where the grid is
  // wider than the space it has, it is the far end. Not animated: this is
  // where the calendar starts, not a journey across it.
  useEffect(() => {
    const element = scroller.current;

    if (element) element.scrollLeft = element.scrollWidth;
  }, [weeks.length]);

  // A chosen day stays in view when the calendar narrows to make room for
  // whatever is shown beside it. Only the scroller moves; the page does not.
  useEffect(() => {
    const element = scroller.current;
    const column = selected ? columnOf.get(selected) : undefined;

    if (!element || column === undefined) return;

    const left = column * COLUMN_PX;
    const right = left + CELL_PX;

    if (left < element.scrollLeft) {
      element.scrollLeft = left;
    } else if (right > element.scrollLeft + element.clientWidth) {
      element.scrollLeft = right - element.clientWidth;
    }
    // `columnOf` is rebuilt every render; the chosen day is what moves it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      if (selected !== null) {
        event.preventDefault();
        onSelect(null);
      }

      return;
    }

    const from =
      (event.target as HTMLElement | null)?.closest<HTMLButtonElement>(
        "button[data-date]",
      )?.dataset.date ?? roving;
    const next = moveFocus(dates, from, event.key);

    if (next === undefined) return;

    event.preventDefault();
    setFocusedDate(next);
    buttons.current.get(next)?.focus();
  };

  if (weeks.length === 0) return null;

  return (
    // Centred in its surface rather than pinned to one edge: the block is
    // as wide as the year it draws, up to the width it has, so a year that
    // fits sits in the middle of the panel and one that does not fills it
    // and scrolls. `w-fit` and not `justify-center`, which clips the near
    // edge of content that overflows a scroller.
    <div className="mx-auto flex w-fit max-w-full flex-col gap-3">
      <div className="flex gap-2">
        {/*
          The weekday column stays put while the grid scrolls, so the rows
          can still be read on a narrow screen. Decorative: each row carries
          its own name for assistive technology, and every day says its own
          full date.
        */}
        <div
          aria-hidden="true"
          // A column of its own width, so the names sit inside it rather
          // than spilling into the surface's padding. Small spaced
          // capitals: a row's name is a mark on the instrument, not a word
          // to be read, and at this size the capitals hold their shape
          // where lowercase does not.
          className={cx(
            "flex w-9 shrink-0 flex-col gap-[2px] border-r pt-[18px] pr-2 text-[10px] leading-none font-semibold tracking-[0.08em] uppercase",
            MARKS[tone].rule,
            MARKS[tone].label,
          )}
        >
          {WEEKDAYS.map((weekday) => (
            <span
              key={weekday}
              className="flex h-[15px] items-center justify-end"
            >
              {weekday.slice(0, 3)}
            </span>
          ))}
        </div>
        <div
          ref={scroller}
          // Horizontal scroll rather than squeezing 26 weeks onto a phone:
          // the squares stay a size an eye and a finger can use, and the
          // most recent week is the one in view to begin with.
          className="scrollbar-thin min-w-0 flex-1 overflow-x-auto overscroll-x-contain pb-1"
        >
          <div className="w-fit">
            {/* Roughly where you are in time, without labelling a square. */}
            <div
              aria-hidden="true"
              className="relative mb-[2px] h-[15px] text-2xs font-semibold tracking-[0.07em] uppercase"
            >
              {months.map(({ week, label: name, month }) => (
                <span
                  key={month}
                  // A hairline at each month's first column: where one month
                  // gives way to the next, without ruling the grid itself.
                  className={cx(
                    "absolute top-0 border-l pl-1 leading-[15px] whitespace-nowrap",
                    MARKS[tone].rule,
                    // Every label is set the same now, so where you are in
                    // the year is said by colour alone.
                    month === currentMonth
                      ? MARKS[tone].current
                      : MARKS[tone].label,
                  )}
                  style={{ left: `${week * COLUMN_PX}px` }}
                >
                  {name}
                </span>
              ))}
            </div>
            <div
              role="grid"
              aria-label={label}
              aria-readonly="true"
              onKeyDown={onKeyDown}
              className="flex flex-col gap-[2px]"
            >
              {WEEKDAYS.map((weekday, row) => (
                <div
                  key={weekday}
                  role="row"
                  className="flex items-center gap-[2px]"
                >
                  {/*
                    Named for assistive technology; shown in the column
                    beside the grid, which does not scroll away.
                  */}
                  <span role="rowheader" className="sr-only">
                    {weekday}
                  </span>
                  {weeks.map((week) => (
                    <Cell
                      key={week[row].date}
                      cell={week[row]}
                      variant={variant}
                      tone={tone}
                      selected={week[row].date === selected}
                      focused={week[row].date === roving}
                      describeDay={describeDay}
                      onSelect={onSelect}
                      onFocus={setFocusedDate}
                      register={(date, element) => {
                        if (element) buttons.current.set(date, element);
                        else buttons.current.delete(date);
                      }}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <Legend variant={variant} tone={tone} />
    </div>
  );
}
