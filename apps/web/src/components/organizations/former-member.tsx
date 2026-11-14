import { cx } from "@/components/ui/cx";

/**
 * Beside the name of someone the Admin has removed from the organization,
 * wherever their past work is shown: grey, in place of a role's colour, so
 * the record stays theirs and reads as history.
 */
export function FormerMember({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex shrink-0 items-center rounded-sm border border-line-strong bg-hover px-1.5 text-2xs font-medium whitespace-nowrap text-fg-muted",
        className,
      )}
    >
      Former member
    </span>
  );
}
