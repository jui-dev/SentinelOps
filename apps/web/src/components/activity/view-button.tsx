import { ChevronRight, PanelRightOpen } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * A row's Details: opens the entry's details window. Blue, as everything
 * that only looks is.
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
    <Button
      variant="view"
      size="sm"
      icon={PanelRightOpen}
      trailingIcon={ChevronRight}
      aria-label={label}
      onClick={onClick}
      // Centred on a row's first line: 28px tall on a 24px line.
      className="-my-0.5"
    >
      Details
    </Button>
  );
}
