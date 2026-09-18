import Link from "next/link";

/**
 * The mark: a viewfinder's corners around a lit point — something watched.
 * Drawn for the ink strip, where it always sits.
 */
function Mark() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 16 16"
      fill="none"
      className="size-4 shrink-0"
    >
      <path
        d="M1.75 5V2.75a1 1 0 0 1 1-1H5M11 1.75h2.25a1 1 0 0 1 1 1V5M14.25 11v2.25a1 1 0 0 1-1 1H11M5 14.25H2.75a1 1 0 0 1-1-1V11"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <rect
        x="5.75"
        y="5.75"
        width="4.5"
        height="4.5"
        rx="1"
        className="fill-ink-accent"
      />
    </svg>
  );
}

export function Wordmark() {
  return (
    <Link
      href="/"
      className="flex items-center gap-2 rounded-sm text-ink-fg outline-offset-4"
    >
      <Mark />
      <span className="text-[0.9375rem] leading-none font-semibold tracking-[-0.015em]">
        Sentinel<span className="font-normal text-ink-muted">Ops</span>
      </span>
    </Link>
  );
}
