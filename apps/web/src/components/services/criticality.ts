import type { ServiceCriticality } from "@/lib/api/contracts";

/**
 * The four criticality levels, as words people read and the definition that
 * makes each one mean the same thing in any organization.
 *
 * Criticality is a classification people choose, not an observed state, so it
 * is shown as plain words — never with the signal colours or `Status` glyphs,
 * which are reserved for what SentinelOps observes. The order here is the
 * order a picker offers them in; nothing sorts services by it.
 */
export const CRITICALITY_LEVELS: readonly {
  value: ServiceCriticality;
  label: string;
  definition: string;
}[] = [
  {
    value: "CRITICAL",
    label: "Critical",
    definition:
      "Failure stops the organization's core work or directly harms its customers.",
  },
  {
    value: "HIGH",
    label: "High",
    definition:
      "Failure seriously degrades important work, and workarounds are limited.",
  },
  {
    value: "NORMAL",
    label: "Normal",
    definition: "Failure is disruptive but contained.",
  },
  {
    value: "LOW",
    label: "Low",
    definition: "Internal or peripheral. Failure has little impact.",
  },
];

export const DEFAULT_CRITICALITY: ServiceCriticality = "NORMAL";

export const criticalityOf = (value: ServiceCriticality) =>
  CRITICALITY_LEVELS.find((level) => level.value === value) ??
  // A level this client does not know yet: show the API's word as is.
  { value, label: value, definition: "" };
