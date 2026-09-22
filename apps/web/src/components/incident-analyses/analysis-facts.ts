import { formatDuration } from "@/components/ui/timestamp";
import type {
  IncidentAnalysisFactsResponse,
  IncidentSeverity,
} from "@/lib/api/contracts";

/**
 * What an analysis shows of the facts the API derived. The API gives
 * instants and counts; the durations are measured here, between them.
 */

/** Milliseconds from one instant to another, never negative. */
export const between = (from: string, to: string): number =>
  Math.max(0, Date.parse(to) - Date.parse(from));

/** How long the incident lasted, declaration to resolution. */
export const lasted = (facts: IncidentAnalysisFactsResponse): number =>
  between(facts.declaredAt, facts.resolvedAt);

/** How long until the first response started; null when none was recorded. */
export const toFirstResponse = (
  facts: IncidentAnalysisFactsResponse,
): number | null =>
  facts.firstResponseAt === null
    ? null
    : between(facts.declaredAt, facts.firstResponseAt);

/**
 * A moment measured from the declaration, as responders count it: "T+0" at
 * the declaration itself, then "T+<1m", "T+6m", "T+1h 4m", "T+2d 3h".
 */
export const sinceDeclared = (declaredAt: string, at: string): string => {
  const elapsed = between(declaredAt, at);

  return elapsed === 0 ? "T+0" : `T+${formatDuration(elapsed)}`;
};

export type SeverityStep = {
  role: "Declared" | "Peak" | "Final";
  severity: IncidentSeverity;
};

/**
 * How severity moved, as few steps as say it: one when it never changed —
 * "throughout" — and otherwise the declared level, the peak when it was
 * neither of the others, and the final one. A peak that is the declared or
 * the final level is not said twice.
 */
export const severityPath = ({
  declared,
  highest,
  final,
}: IncidentAnalysisFactsResponse["severity"]):
  | { throughout: IncidentSeverity }
  | { steps: SeverityStep[] } => {
  if (declared === highest && highest === final) {
    return { throughout: final };
  }

  const steps: SeverityStep[] = [{ role: "Declared", severity: declared }];

  if (highest !== declared && highest !== final) {
    steps.push({ role: "Peak", severity: highest });
  }

  steps.push({ role: "Final", severity: final });

  return { steps };
};
