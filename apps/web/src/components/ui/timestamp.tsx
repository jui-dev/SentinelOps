/**
 * An ISO calendar date in UTC, for dense tables: "2026-09-18". UTC, like the
 * clock in the situation strip, so every table reads against one reference.
 * Prose uses a localized long form instead.
 */
export const formatIsoDate = (iso: string): string =>
  new Date(iso).toISOString().slice(0, 10);

const formatLocalDateTime = (iso: string): string =>
  new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });

/**
 * A date as a table shows it: ISO, UTC, mono (from the cell). Machine-
 * readable through `dateTime`; the local date and time on hover.
 */
export function IsoDate({ value }: { value: string }) {
  return (
    <time dateTime={value} title={`${formatLocalDateTime(value)} (local time)`}>
      {formatIsoDate(value)}
    </time>
  );
}
