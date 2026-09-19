import { Circle, CircleCheck, CircleDashed } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cx } from "@/components/ui/cx";
import type { IncidentSeverity, IncidentStatus } from "@/lib/api/contracts";

/**
 * The incident vocabulary: severity levels and statuses, as words with the
 * definitions that make them mean the same thing to everyone.
 *
 * Severity is the first thing in SentinelOps drawn with the reserved signal
 * colours: it is an operational judgement about something happening now,
 * which is what that family is for. Each level has its own glyph shape as
 * well as its own colour, and the code and word are always written out, so
 * nothing depends on colour alone. Criticality, a classification of a
 * service, stays plain words.
 */
export const SEVERITY_LEVELS: readonly {
  value: IncidentSeverity;
  label: string;
  definition: string;
}[] = [
  {
    value: "SEV1",
    label: "Critical",
    definition:
      "Core functionality is unavailable, or customers or the business are seriously affected.",
  },
  {
    value: "SEV2",
    label: "Major",
    definition:
      "Serious degradation or substantial impact, short of a complete critical outage.",
  },
  {
    value: "SEV3",
    label: "Moderate",
    definition:
      "Limited or contained impact. Normal operations can largely continue.",
  },
  {
    value: "SEV4",
    label: "Minor",
    definition: "A small operational issue with little immediate impact.",
  },
];

export const severityOf = (value: IncidentSeverity) =>
  SEVERITY_LEVELS.find((level) => level.value === value) ??
  // A level this client does not know yet: show the API's word as is.
  { value, label: value, definition: "" };

/**
 * The statuses in the only order an incident moves through them: DECLARED,
 * then INVESTIGATING, then RESOLVED — forward, one step at a time.
 */
export const STATUS_LEVELS: readonly {
  value: IncidentStatus;
  label: string;
  definition: string;
}[] = [
  {
    value: "DECLARED",
    label: "Declared",
    definition:
      "Reported and visible to the responsible team. Investigation has not started yet.",
  },
  {
    value: "INVESTIGATING",
    label: "Investigating",
    definition:
      "Investigation, diagnosis, mitigation, or repair is under way.",
  },
  {
    value: "RESOLVED",
    label: "Resolved",
    definition: "The incident has been closed.",
  },
];

/**
 * Statuses the lifecycle no longer has, which older timeline entries can
 * still name. History only: nothing is ever moved to one.
 */
export type RetiredIncidentStatus = "IDENTIFIED" | "MONITORING";

const RETIRED_STATUS_LABELS: Record<RetiredIncidentStatus, string> = {
  IDENTIFIED: "Identified",
  MONITORING: "Monitoring",
};

export const statusOf = (value: IncidentStatus | RetiredIncidentStatus) =>
  STATUS_LEVELS.find((level) => level.value === value) ?? {
    value,
    // A retired status, or one this client does not know yet: its word.
    label: RETIRED_STATUS_LABELS[value as RetiredIncidentStatus] ?? value,
    definition: "",
  };

/** An incident's human identifier: INC-42. */
export const incidentKey = (number: number) => `INC-${number}`;

/** One glyph per level: shape and colour both change with severity. */
const marks: Record<IncidentSeverity, { path: ReactNode; colour: string }> = {
  // Diamond: the most severe.
  SEV1: {
    path: <path d="M5 .5 9.5 5 5 9.5.5 5Z" fill="currentColor" />,
    colour: "text-signal-critical",
  },
  // Triangle.
  SEV2: {
    path: <path d="M5 1 9.5 9h-9Z" fill="currentColor" />,
    colour: "text-signal-high",
  },
  // Square.
  SEV3: {
    path: <rect x="1.5" y="1.5" width="7" height="7" fill="currentColor" />,
    colour: "text-signal-caution",
  },
  // Ring: the least severe.
  SEV4: {
    path: (
      <circle
        cx="5"
        cy="5"
        r="3.25"
        fill="none"
        strokeWidth="1.5"
        stroke="currentColor"
      />
    ),
    colour: "text-signal-advisory",
  },
};

/**
 * A severity as text with its mark: `◆ SEV1`, and with `label`, `◆ SEV1
 * Critical`. Without the visible word, the word is still read out.
 * `emphasis`, for lists scanned under pressure, sets the mark a touch larger
 * and the most severe level heavier — weight, not more colour.
 */
export function SeverityMark({
  severity,
  label = false,
  emphasis = false,
  className,
}: {
  severity: IncidentSeverity;
  label?: boolean;
  emphasis?: boolean;
  className?: string;
}) {
  const mark = marks[severity];
  const { label: word } = severityOf(severity);
  const strongest = emphasis && severity === "SEV1";

  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap",
        className,
      )}
    >
      {mark && (
        <svg
          aria-hidden="true"
          viewBox="0 0 10 10"
          className={cx(
            "shrink-0",
            emphasis ? "size-[11px]" : "size-2.5",
            mark.colour,
          )}
        >
          {mark.path}
        </svg>
      )}
      <span
        className={cx(
          "data text-fg",
          strongest ? "font-semibold" : "font-medium",
        )}
      >
        {severity}
      </span>
      {label ? (
        <span className="text-fg-muted">{word}</span>
      ) : (
        <span className="sr-only">{word}</span>
      )}
    </span>
  );
}

/**
 * One outline icon per status. Outlines, where severity marks are filled
 * solids, so the two never read as one scale. Neutral ink for the active
 * statuses — severity is the signal — and the nominal green only once
 * resolved. A retired status has no icon: its word carries it.
 */
const statusIcons: Record<IncidentStatus, { Icon: LucideIcon; colour: string }> = {
  // Reported; nobody has started on it.
  DECLARED: { Icon: Circle, colour: "text-fg-muted" },
  // An open question being worked.
  INVESTIGATING: { Icon: CircleDashed, colour: "text-fg-muted" },
  RESOLVED: { Icon: CircleCheck, colour: "text-signal-nominal" },
};

/** A status as its word with its icon: `◌ Investigating`. The word carries it. */
export function StatusMark({
  status,
  className,
}: {
  status: IncidentStatus | RetiredIncidentStatus;
  className?: string;
}) {
  const icon = statusIcons[status as IncidentStatus];

  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 whitespace-nowrap",
        className,
      )}
    >
      {icon && (
        <icon.Icon
          aria-hidden="true"
          strokeWidth={2}
          className={cx("size-3.5 shrink-0", icon.colour)}
        />
      )}
      {statusOf(status).label}
    </span>
  );
}
