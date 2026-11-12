import { Ban, Check, CircleAlert, LockKeyhole } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cx } from "@/components/ui/cx";
import type { ActivityEntryResponse } from "@/lib/api/contracts";

import { resultOf } from "./activity-meta";

const TONES: Record<
  ReturnType<typeof resultOf>["tone"],
  { classes: string; icon: LucideIcon }
> = {
  success: {
    classes: "border-success-line bg-success-subtle text-success-text",
    icon: Check,
  },
  warning: {
    classes: "border-warning-line bg-warning-subtle text-warning-text",
    icon: CircleAlert,
  },
  danger: {
    classes: "border-danger-line bg-danger-subtle text-danger-text",
    icon: Ban,
  },
  neutral: {
    classes: "border-line bg-sunken text-fg-muted",
    icon: LockKeyhole,
  },
};

/**
 * A sign-in event's result as a pill: its icon and word in its tone, sized
 * to the word. The icon's shape differs by result too, so it does not rest
 * on colour alone.
 */
export function ResultPill({ entry }: { entry: ActivityEntryResponse }) {
  const result = resultOf(entry);
  const { classes, icon: Icon } = TONES[result.tone];

  return (
    <span
      className={cx(
        "inline-flex h-6 w-fit items-center gap-1 rounded-full border px-2 text-xs font-semibold whitespace-nowrap",
        classes,
      )}
    >
      <Icon aria-hidden="true" strokeWidth={2.25} className="size-3.5 shrink-0" />
      {result.label}
    </span>
  );
}
