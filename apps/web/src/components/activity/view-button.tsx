import { ChevronRight } from "lucide-react";

import { rowActionClasses } from "@/components/ui/row-action";

/**
 * A row's View: opens the entry's details window. The app's own row action,
 * in the accent, as View is on the incident history.
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
      className={rowActionClasses("accent")}
    >
      View
      <ChevronRight aria-hidden="true" strokeWidth={2} className="size-3.5" />
    </button>
  );
}
