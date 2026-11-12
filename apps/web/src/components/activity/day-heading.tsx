import { CalendarDays } from "lucide-react";

import { dayParts } from "./activity-meta";

/**
 * The band that opens each day in an activity log table: a calendar icon,
 * the day in bold capitals (Today, Yesterday, or its weekday), its date,
 * and how many rows the day holds on the right. In the table-header shade
 * with a stronger edge above, so the day breaks are seen at a glance.
 */
export function DayHeading({
  at,
  now,
  count,
  noun,
  columns,
}: {
  /** Any moment in the day. */
  at: string;
  now: Date;
  /** The day's rows, as loaded. */
  count: number;
  /** What a row is: "change", "event". */
  noun: string;
  columns: number;
}) {
  const { word, date } = dayParts(at, now);

  return (
    <tr>
      <th
        scope="colgroup"
        colSpan={columns}
        className="border-t border-b border-t-line-strong border-b-line bg-thead px-3 py-2.5 text-left font-normal sm:px-4"
      >
        <span className="flex items-center gap-2.5">
          <CalendarDays aria-hidden="true" className="size-4 shrink-0 text-fg-muted" />
          <span className="text-xs font-bold tracking-[0.08em] text-fg uppercase">
            {word}
          </span>
          <span className="text-sm font-medium text-fg-muted">{date}</span>
          <span className="numeric ml-auto text-xs font-medium text-fg-subtle">
            {count} {count === 1 ? noun : `${noun}s`}
          </span>
        </span>
      </th>
    </tr>
  );
}
