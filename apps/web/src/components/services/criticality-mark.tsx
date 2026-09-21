import { cx } from "@/components/ui/cx";
import type { ServiceCriticality } from "@/lib/api/contracts";

import { criticalityOf } from "./criticality";

/** How many of the gauge's four segments each level fills. */
const STEPS: Record<ServiceCriticality, number> = {
  CRITICAL: 4,
  HIGH: 3,
  NORMAL: 2,
  LOW: 1,
};

/**
 * How strongly each level is drawn. One chip for all four — the same edge,
 * the same gauge, the same word — whose intensity rises with the level, so
 * Low and Critical are plainly the same kind of thing at two strengths.
 *
 * Neutrals only, from the faintest edge to the strongest ink turned solid:
 * criticality is a classification people choose, not an observed state, so
 * it never takes a hue. That is what keeps it apart from severity (the warm
 * signal band) and from lifecycle (the cool one) — a Critical service is
 * never mistaken for a SEV1, nor High for a Declared incident.
 */
const LEVELS: Record<ServiceCriticality, string> = {
  // Solid: the strongest ink as the ground, the canvas as the ink.
  CRITICAL: "border-fg bg-fg text-canvas",
  HIGH: "border-line-control bg-sunken text-fg",
  NORMAL: "border-line-strong text-fg-muted",
  LOW: "border-line text-fg-subtle",
};

/**
 * A criticality as a chip: a four-segment gauge and its word — `▮▮▮▪ High`
 * — so a column of services scans by shape and strength, not colour.
 *
 * Empty steps are short stubs, unmistakably unfilled by shape as well as
 * tone. The word carries the level; the gauge is decoration for assistive
 * technology. Not a control: no hover, no pointer. `className` is for
 * layout only — each level sets its own colours.
 */
export function CriticalityMark({
  criticality,
  className,
}: {
  criticality: ServiceCriticality;
  className?: string;
}) {
  const { label } = criticalityOf(criticality);
  const filled = STEPS[criticality];

  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-px text-xs leading-4 font-medium whitespace-nowrap",
        LEVELS[criticality] ?? LEVELS.NORMAL,
        className,
      )}
    >
      {filled && (
        <svg aria-hidden="true" viewBox="0 0 15 10" className="h-2 w-3 shrink-0">
          {[0, 1, 2, 3].map((step) =>
            step < filled ? (
              <rect
                key={step}
                x={step * 4}
                y="0"
                width="3"
                height="10"
                rx="0.5"
                className="fill-current"
              />
            ) : (
              <rect
                key={step}
                x={step * 4}
                y="3.5"
                width="3"
                height="3"
                rx="0.5"
                className="fill-current opacity-40 forced-colors:fill-[GrayText] forced-colors:opacity-100"
              />
            ),
          )}
        </svg>
      )}
      {label}
    </span>
  );
}
