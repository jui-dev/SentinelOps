import { ArrowRight } from "lucide-react";

import { cx } from "./cx";

/**
 * The arrow between a before and an after — SEV3 → SEV2, declared →
 * resolved — drawn as the icon every other arrow is, never a typed
 * character. Decorative: say "to" beside it for assistive technology.
 */
export function ChangeArrow({ className }: { className?: string }) {
  return (
    <ArrowRight
      aria-hidden="true"
      strokeWidth={2}
      className={cx("inline-block size-3.5 shrink-0 align-[-0.125em] text-fg-subtle", className)}
    />
  );
}
