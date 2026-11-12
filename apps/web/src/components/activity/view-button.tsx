import { Eye } from "lucide-react";

/**
 * A row's View button: opens the entry's details window. Tinted in the
 * accent, so the one thing to do on a row reads as a button among the
 * row's text, without the weight of a solid primary button on every line.
 */
export function ViewButton({
  label,
  onClick,
}: {
  /** The accessible name: what is viewed, not just "View". */
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-accent-rim bg-accent-subtle px-2.5 text-sm font-medium text-accent-text transition-colors duration-(--duration-fast) hover:bg-selected focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
    >
      <Eye aria-hidden="true" className="size-3.5 shrink-0" />
      View
    </button>
  );
}
