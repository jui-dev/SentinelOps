"use client";

import { useEffect, useState } from "react";

import { cx } from "@/components/ui/cx";

/** "just now", "40s ago", "3m ago", "2h ago": how fresh, at a glance. */
export const formatAge = (milliseconds: number): string => {
  const seconds = Math.floor(Math.max(0, milliseconds) / 1000);

  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;

  return `${Math.floor(seconds / 3600)}h ago`;
};

/** The time now, re-read every few seconds: enough for an age in seconds. */
const useTicker = (every: number) => {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), every);

    return () => clearInterval(timer);
  }, [every]);

  return now;
};

/**
 * That a page is refreshing itself, and how fresh what it shows is: a green
 * dot and "Live · updated 12s ago". When the last refresh failed, amber,
 * and how old what is shown is — the page stays as it was. Not a live
 * region: it changes every few seconds, which would be read out each time.
 */
export function LiveStatus({
  updatedAt,
  failed,
}: {
  /** When what is shown was fetched, in milliseconds; 0 before it was. */
  updatedAt: number;
  failed: boolean;
}) {
  const now = useTicker(5_000);

  if (!updatedAt) return null;

  const age = formatAge(now - updatedAt);

  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 text-xs whitespace-nowrap",
        failed ? "text-warning-text" : "text-status-resolved-text",
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          "size-1.5 rounded-full",
          failed ? "bg-warning-text" : "bg-status-resolved-text",
        )}
      />
      {failed ? `Can't refresh · updated ${age}` : `Live · updated ${age}`}
    </span>
  );
}
