import { cx } from "./cx";

/**
 * A table row's own action — View, Edit, Add to team, Remove: small, in a
 * quiet fill of one of the system's tones, so a row's actions read as
 * actions without competing with the page's primary button. Each tone
 * keeps an action told apart from its neighbours.
 */
export type RowActionTone = "primary" | "accent" | "info" | "danger";

const TONES: Record<RowActionTone, string> = {
  // The one row action that is the row's point: solid, as a primary button.
  primary:
    "border-accent-rim bg-accent text-on-accent hover:bg-accent-hover",
  accent:
    "border-accent-line bg-accent-subtle text-accent-text hover:border-accent-rim",
  info: "border-info-line bg-info-subtle text-info-text hover:border-info-solid",
  danger:
    "border-danger-line bg-danger-subtle text-danger-text hover:border-danger-solid",
};

export const rowActionClasses = (tone: RowActionTone) =>
  cx(
    "inline-flex h-7 items-center gap-1 rounded-md border px-2.5 text-sm font-medium whitespace-nowrap transition-colors duration-(--duration-fast) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
    "disabled:cursor-not-allowed disabled:border-line disabled:bg-sunken disabled:text-fg-disabled",
    TONES[tone],
  );
