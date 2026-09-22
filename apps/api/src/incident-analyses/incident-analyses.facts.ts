/**
 * What SentinelOps already knows about a resolved incident, for its
 * analysis: a few facts, and the moments that shaped it.
 *
 * Derived, never stored. A resolved incident is final and its timeline is
 * never changed, so deriving this on every read always gives the same
 * answer, and nothing a person would otherwise retype is kept twice.
 *
 * Everything comes from the incident and its timeline alone. The timeline
 * records exactly what the facts need: each responder's start is one
 * RESPONSE_STARTED entry, written with their response row and at its start
 * time, and the declaration and the resolution are entries at the incident's
 * own createdAt and resolvedAt.
 *
 * Instants, not durations: the client measures between them, as it measures
 * how long an incident lasted.
 *
 * Pure: rows are structural rather than Prisma types.
 */

import type {
  IncidentActivityType,
  IncidentSeverity,
} from '../incidents/incidents.contract.js';

/** The resolved incident: an analysis is only ever written for one. */
interface FactsIncident {
  createdAt: Date;
  resolvedAt: Date;
  severity: IncidentSeverity;
}

/** One timeline entry, without its message: no fact reads one. */
export interface FactsEntry {
  id: string;
  type: IncidentActivityType;
  fromValue: string | null;
  toValue: string | null;
  createdAt: Date;
  actor: { id: string; name: string };
}

export interface IncidentFacts {
  declaredAt: Date;
  resolvedAt: Date;
  /** When the first responder started; null when nobody's start is recorded. */
  firstResponseAt: Date | null;
  /** Everyone who started a response. */
  responderCount: number;
  /** Operational updates posted, by responders and the Admin alike. */
  updateCount: number;
  severity: {
    /** Before the first recorded change; the final severity if none. */
    declared: IncidentSeverity;
    /** The most severe it was ever set to. */
    highest: IncidentSeverity;
    final: IncidentSeverity;
  };
  /** How many times the responsible team was changed. */
  reassignmentCount: number;
}

export type IncidentKeyMomentKind =
  | 'DECLARED'
  | 'FIRST_RESPONSE'
  | 'SEVERITY_CHANGED'
  | 'TEAM_CHANGED'
  | 'LAST_RESPONSE_COMPLETED'
  | 'RESOLVED';

/**
 * A timeline entry that shaped the incident, named for what it meant. It
 * keeps the entry's id, time, actor, and values as recorded: a severity
 * change's two levels, a team change's two names as they were then.
 */
export interface IncidentKeyMoment {
  kind: IncidentKeyMomentKind;
  activityId: string;
  at: Date;
  actor: { id: string; name: string };
  fromValue: string | null;
  toValue: string | null;
}

/** Most severe first — the order the database enum declares them in. */
const SEVERITY_ORDER: readonly IncidentSeverity[] = [
  'SEV1',
  'SEV2',
  'SEV3',
  'SEV4',
];

const moreSevere = (a: IncidentSeverity, b: IncidentSeverity) =>
  SEVERITY_ORDER.indexOf(a) <= SEVERITY_ORDER.indexOf(b) ? a : b;

/**
 * The timeline's own order: by time, and by id between the entries of one
 * change, which share a time.
 */
const byTimeline = (a: FactsEntry, b: FactsEntry): number =>
  a.createdAt.getTime() - b.createdAt.getTime() ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const isResolution = (entry: FactsEntry) =>
  entry.type === 'STATUS_CHANGED' && entry.toValue === 'RESOLVED';

/**
 * The incident's facts, and its key moments in timeline order:
 *
 *   DECLARED                 the declaration
 *   FIRST_RESPONSE           the first RESPONSE_STARTED
 *   SEVERITY_CHANGED         every severity change
 *   TEAM_CHANGED             every reassignment
 *   LAST_RESPONSE_COMPLETED  the last RESPONSE_COMPLETED
 *   RESOLVED                 the status change to RESOLVED
 *
 * Operational updates are not moments; the full timeline keeps them. Nor is
 * the move to INVESTIGATING, which is the first response itself. A moment
 * whose entry is not on the timeline is simply absent.
 */
export const deriveIncidentFacts = (
  incident: FactsIncident,
  entries: readonly FactsEntry[],
): { facts: IncidentFacts; keyMoments: IncidentKeyMoment[] } => {
  const timeline = [...entries].sort(byTimeline);
  const ofType = (type: IncidentActivityType) =>
    timeline.filter((entry) => entry.type === type);

  const starts = ofType('RESPONSE_STARTED');
  const completions = ofType('RESPONSE_COMPLETED');
  const severityChanges = ofType('SEVERITY_CHANGED');

  const declared =
    (severityChanges[0]?.fromValue as IncidentSeverity | undefined) ??
    incident.severity;
  const highest = severityChanges
    .map((change) => change.toValue as IncidentSeverity)
    .reduce(moreSevere, declared);

  const firstStart = starts[0];
  const lastCompletion = completions.at(-1);

  const kindOf = (entry: FactsEntry): IncidentKeyMomentKind | undefined => {
    if (entry.type === 'DECLARED') return 'DECLARED';
    if (entry === firstStart) return 'FIRST_RESPONSE';
    if (entry.type === 'SEVERITY_CHANGED') return 'SEVERITY_CHANGED';
    if (entry.type === 'TEAM_CHANGED') return 'TEAM_CHANGED';
    if (entry === lastCompletion) return 'LAST_RESPONSE_COMPLETED';
    if (isResolution(entry)) return 'RESOLVED';

    return undefined;
  };

  const keyMoments = timeline.flatMap((entry) => {
    const kind = kindOf(entry);

    return kind
      ? [
          {
            kind,
            activityId: entry.id,
            at: entry.createdAt,
            actor: entry.actor,
            fromValue: entry.fromValue,
            toValue: entry.toValue,
          },
        ]
      : [];
  });

  return {
    facts: {
      declaredAt: incident.createdAt,
      resolvedAt: incident.resolvedAt,
      firstResponseAt: firstStart?.createdAt ?? null,
      responderCount: starts.length,
      updateCount: ofType('UPDATE').length,
      severity: { declared, highest, final: incident.severity },
      reassignmentCount: ofType('TEAM_CHANGED').length,
    },
    keyMoments,
  };
};
