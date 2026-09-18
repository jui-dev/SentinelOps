"use client";

import { useEffect, useState } from "react";

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

/** A moment in prose: the local date and time, machine-readable. */
export function LocalDateTime({ value }: { value: string }) {
  return <time dateTime={value}>{formatLocalDateTime(value)}</time>;
}

/**
 * The current time, re-read on every minute boundary. One schedule for
 * everything that counts minutes — the strip's clock and how long an
 * incident has been running — so they tick together.
 */
export const useMinuteClock = (): Date => {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const current = new Date();

      setNow(current);
      timer = setTimeout(schedule, 60_000 - (current.getTime() % 60_000) + 50);
    };

    timer = setTimeout(schedule, 60_000 - (Date.now() % 60_000) + 50);

    return () => clearTimeout(timer);
  }, []);

  return now;
};

/**
 * A span of time as an operator reads it at a glance: "14m", "3h 12m",
 * "2d 4h". Under a minute is "<1m". Never negative: a clock slightly behind
 * the server's reads as just started.
 */
export const formatDuration = (milliseconds: number): string => {
  const minutes = Math.floor(Math.max(0, milliseconds) / 60_000);

  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);

  if (hours < 24) {
    return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`;
  }

  const days = Math.floor(hours / 24);

  return hours % 24 === 0 ? `${days}d` : `${days}d ${hours % 24}h`;
};

/**
 * How long something has lasted: from `from` to `to`, or to now — ticking
 * each minute — while it has not ended. The start is on hover.
 */
export function Duration({ from, to }: { from: string; to?: string | null }) {
  const now = useMinuteClock();
  const end = to ? new Date(to) : now;

  return (
    <time
      dateTime={`PT${Math.max(0, Math.floor((end.getTime() - Date.parse(from)) / 60_000))}M`}
      title={`Since ${formatLocalDateTime(from)} (local time)`}
    >
      {formatDuration(end.getTime() - Date.parse(from))}
    </time>
  );
}
