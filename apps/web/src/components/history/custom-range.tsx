"use client";

import {
  Check,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import { DayPicker } from "react-day-picker";
import type { ClassNames, DateRange } from "react-day-picker";

import { ChangeArrow } from "@/components/ui/change-arrow";
import { Button } from "@/components/ui/button";
import { MODAL_BACKDROP } from "@/components/ui/modal";
import type { IncidentPeriod } from "@/lib/api/contracts";
import {
  MAX_PERIOD_DAYS,
  periodDays,
  startOfUtcDay,
  utcDay,
} from "@/lib/period/period";

import { formatDays } from "./period";

/**
 * The calendar in the workspace's own terms: no library stylesheet, only
 * tokens. The range is the accent's quiet fill with its mark at either end —
 * selection, never the signal colours, which are for incidents.
 */
const classNames: Partial<ClassNames> = {
  root: "relative w-fit",
  months: "flex flex-wrap gap-x-8 gap-y-5",
  month: "flex flex-col gap-2",
  month_caption: "flex h-8 items-center px-1",
  caption_label: "text-sm font-semibold text-fg",
  nav: "absolute top-0 right-0 flex h-8 items-center gap-1",
  button_previous:
    "grid size-7 place-items-center rounded-md text-fg-muted hover:bg-hover hover:text-fg disabled:text-fg-disabled disabled:hover:bg-transparent",
  button_next:
    "grid size-7 place-items-center rounded-md text-fg-muted hover:bg-hover hover:text-fg disabled:text-fg-disabled disabled:hover:bg-transparent",
  month_grid: "border-collapse",
  weekdays: "",
  weekday: "size-9 text-xs font-medium text-fg-subtle",
  week: "",
  day: "size-9 p-0 text-center text-sm text-fg",
  day_button:
    "numeric size-9 rounded-md hover:bg-hover disabled:cursor-not-allowed disabled:hover:bg-transparent",
  today: "font-semibold text-accent-text",
  disabled: "text-fg-disabled",
  selected: "bg-accent-subtle",
  range_start:
    "rounded-l-md [&>button]:bg-accent-mark [&>button]:text-on-accent [&>button]:hover:bg-accent-mark",
  range_end:
    "rounded-r-md [&>button]:bg-accent-mark [&>button]:text-on-accent [&>button]:hover:bg-accent-mark",
  range_middle: "[&>button]:rounded-none",
  hidden: "invisible",
};

function Chevron({ orientation }: { orientation?: string }) {
  const Icon = orientation === "left" ? ChevronLeft : ChevronRight;

  return <Icon aria-hidden="true" className="size-4" />;
}

/**
 * Wide enough for two months side by side. Narrower, the calendar shows
 * one, so it never runs off a phone's screen.
 */
const TWO_MONTHS = "(min-width: 40rem)";

const subscribe = (onChange: () => void) => {
  const query = window.matchMedia?.(TWO_MONTHS);

  query?.addEventListener("change", onChange);

  return () => query?.removeEventListener("change", onChange);
};

/** Two months, unless the viewport says otherwise (or cannot say). */
const useMonthCount = () =>
  useSyncExternalStore(
    subscribe,
    () => (window.matchMedia?.(TWO_MONTHS).matches === false ? 1 : 2),
    () => 2,
  );

/**
 * Where focus goes when the dialog closes: back to what opened it. A tab
 * that is no longer the selected one — Custom, after a first range was
 * abandoned — hands focus to the tab that is, as its tab list expects.
 */
const restoreFocus = (opener: Element | null) => {
  if (!(opener instanceof HTMLElement) || !opener.isConnected) return;

  const target =
    opener.getAttribute("role") === "tab" &&
    opener.getAttribute("aria-selected") !== "true"
      ? opener
          .closest('[role="tablist"]')
          ?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      : opener;

  target?.focus();
};

/**
 * Choosing a custom period: a range calendar of UTC days in a compact modal
 * dialog, applied or abandoned as a whole. Two clicks make a range; one day
 * applies as a single day. Nothing after today can be chosen, and a range
 * longer than the API allows is explained rather than sent.
 *
 * A native <dialog> opened with showModal(), as the navigation drawer is:
 * the page is inert behind it and focus stays inside. Escape, a click on the
 * backdrop, and Cancel all abandon the draft; only Apply commits it. Focus
 * returns to what opened it. Mounted only while open.
 */
export function CustomRangeDialog({
  initial,
  today,
  onApply,
  onCancel,
}: {
  /** Where the calendar starts: the period applied before, or on show. */
  initial: IncidentPeriod;
  /** Today, UTC, as `YYYY-MM-DD`: the last day that can be chosen. */
  today: string;
  onApply: (period: IncidentPeriod) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const months = useMonthCount();

  useEffect(() => {
    const dialog = ref.current;
    const opener = document.activeElement;

    if (!dialog) return;
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");

    return () => {
      if (dialog.open && typeof dialog.close === "function") dialog.close();
      restoreFocus(opener);
    };
  }, []);

  // Escape abandons the draft. Handled here rather than left to the native
  // cancel, so it is one path everywhere; the native close request (a
  // phone's back gesture, say) is routed to it too.
  const onKeyDown = (event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
    }
  };

  // A click on the backdrop lands on the dialog element itself.
  const onClick = (event: MouseEvent<HTMLDialogElement>) => {
    if (event.target === event.currentTarget) onCancel();
  };

  const [range, setRange] = useState<DateRange | undefined>({
    from: startOfUtcDay(initial.from),
    to: startOfUtcDay(initial.to),
  });

  const draft: IncidentPeriod | undefined = range?.from
    ? { from: utcDay(range.from), to: utcDay(range.to ?? range.from) }
    : undefined;
  const days = draft ? periodDays(draft) : 0;
  const tooLong = days > MAX_PERIOD_DAYS;

  return (
    <dialog
      ref={ref}
      aria-labelledby={headingId}
      onKeyDown={onKeyDown}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onClick={onClick}
      // Centred by the browser, over the same dimmed, blurred page as every
      // other modal.
      className={`m-auto max-h-[calc(100dvh-2rem)] w-fit max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-line bg-surface p-0 text-fg shadow-overlay ${MODAL_BACKDROP}`}
    >
      <div className="flex flex-col gap-4 p-4 sm:p-5">
        <h2 id={headingId} className="text-sm font-semibold text-fg">
          Choose dates <span className="font-normal text-fg-muted">(UTC)</span>
        </h2>
        <DayPicker
          mode="range"
          timeZone="UTC"
          numberOfMonths={months}
          resetOnSelect
          selected={range}
          onSelect={setRange}
          defaultMonth={startOfUtcDay(`${initial.to.slice(0, 7)}-01`)}
          endMonth={startOfUtcDay(today)}
          disabled={{ after: startOfUtcDay(today) }}
          classNames={classNames}
          components={{ Chevron }}
        />
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-t border-line-subtle pt-4">
          <p aria-live="polite" className="text-sm text-fg-muted">
            {draft ? (
              <>
                <span className="data text-fg">
                  {draft.from} <ChangeArrow /> <span className="sr-only">to</span>{" "}
                  {draft.to}
                </span>{" "}
                · {formatDays(days)}
                {tooLong && (
                  <span className="block text-danger-text">
                    A period can cover at most {MAX_PERIOD_DAYS} days.
                  </span>
                )}
              </>
            ) : (
              "Choose a start date."
            )}
          </p>
          <div className="flex items-center gap-2">
            <Button icon={X} variant="secondary" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button icon={Check}
              size="sm"
              disabled={!draft || tooLong}
              onClick={() => draft && onApply(draft)}
            >
              Apply
            </Button>
          </div>
        </div>
      </div>
    </dialog>
  );
}
