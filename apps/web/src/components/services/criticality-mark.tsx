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
 * A criticality as a four-segment gauge and its word — `▮▮▮▪ High` — so a
 * column of services scans by shape, not colour.
 *
 * Criticality is a classification people choose, not an observed state, so
 * it never takes the signal colours or `Status` glyphs, which are reserved
 * for what SentinelOps observes. Neutral throughout: filled segments in the
 * text's ink, the most critical level in the strongest neutral, and empty
 * steps as short stubs in the control-edge tone — plainly there, and
 * unmistakably unfilled by shape as well as tone. The word carries the
 * level; the gauge is decoration for assistive technology.
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
  const strongest = criticality === "CRITICAL";

  return (
    <span
      className={cx(
        "inline-flex items-center gap-2 whitespace-nowrap",
        strongest ? "text-fg" : "text-fg-muted",
        className,
      )}
    >
      {filled && (
        <svg aria-hidden="true" viewBox="0 0 15 10" className="h-2.5 w-3.75 shrink-0">
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
              // An empty step: a short stub, so the count reads by shape,
              // not only by a tone close to the filled one.
              <rect
                key={step}
                x={step * 4}
                y="3.5"
                width="3"
                height="3"
                rx="0.5"
                className="fill-line-control forced-colors:fill-[GrayText]"
              />
            ),
          )}
        </svg>
      )}
      {label}
    </span>
  );
}
