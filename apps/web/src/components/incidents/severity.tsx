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
 * The statuses in the order a response usually moves through them. The
 * three active ones may move in either direction; RESOLVED is the end.
 */
export const STATUS_LEVELS: readonly {
  value: IncidentStatus;
  label: string;
  definition: string;
}[] = [
  {
    value: "INVESTIGATING",
    label: "Investigating",
    definition: "The problem is known. Its cause and fix are not yet.",
  },
  {
    value: "IDENTIFIED",
    label: "Identified",
    definition: "The likely cause is known and remediation is under way.",
  },
  {
    value: "MONITORING",
    label: "Monitoring",
    definition:
      "A fix or mitigation is in place, and recovery is being watched.",
  },
  {
    value: "RESOLVED",
    label: "Resolved",
    definition: "The incident is over.",
  },
];

export const statusOf = (value: IncidentStatus) =>
  STATUS_LEVELS.find((level) => level.value === value) ?? {
    value,
    label: value,
    definition: "",
  };

/** The active statuses — what a responder can move an incident between. */
export const ACTIVE_STATUSES = STATUS_LEVELS.filter(
  ({ value }) => value !== "RESOLVED",
);

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
 */
export function SeverityMark({
  severity,
  label = false,
  className,
}: {
  severity: IncidentSeverity;
  label?: boolean;
  className?: string;
}) {
  const mark = marks[severity];
  const { label: word } = severityOf(severity);

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
          className={cx("size-2.5 shrink-0", mark.colour)}
        >
          {mark.path}
        </svg>
      )}
      <span className="data font-medium text-fg">{severity}</span>
      {label ? (
        <span className="text-fg-muted">{word}</span>
      ) : (
        <span className="sr-only">{word}</span>
      )}
    </span>
  );
}
