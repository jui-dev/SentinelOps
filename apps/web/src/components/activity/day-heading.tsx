import { dayLabel } from "./activity-meta";

/**
 * The row that opens each day in an activity log table, drawn as the
 * incident history draws its days: a sunken band, the UTC date in bold, and
 * beside it how many rows the day holds.
 */
export function DayHeading({
  at,
  count,
  noun,
  columns,
}: {
  /** Any moment in the day. */
  at: string;
  /** The day's rows, as loaded. */
  count: number;
  /** What a row is: "change", "event". */
  noun: string;
  columns: number;
}) {
  return (
    <tr>
      <th
        scope="colgroup"
        colSpan={columns}
        className="h-9 border-b border-line-subtle bg-sunken px-3 text-left text-xs font-semibold tracking-wide text-fg sm:px-4"
      >
        {dayLabel(at)}
        <span className="ml-2 font-normal tracking-normal text-fg-subtle">
          {count} {count === 1 ? noun : `${noun}s`}
        </span>
      </th>
    </tr>
  );
}
