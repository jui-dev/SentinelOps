/**
 * The organization's operational activity: how much happened on each day, and
 * to which incidents.
 *
 * History, not state. Every entry an incident's timeline carries is an
 * operational event — a declaration, an update someone wrote, a response
 * starting or finishing, a resolution — and this counts them by the UTC day
 * they were recorded on. Nothing new is stored: the timeline the application
 * already writes is the whole source.
 *
 * What counts, and why, is decided here and nowhere else — `categoryOf` is
 * the one rule, so the service reads a period's entries plainly and never
 * repeats the judgement in a query. Six categories:
 *
 *   declared           DECLARED
 *   responseStarted    RESPONSE_STARTED
 *   update             UPDATE
 *   responseCompleted  RESPONSE_COMPLETED
 *   resolved           STATUS_CHANGED to RESOLVED
 *   changed            SEVERITY_CHANGED, TEAM_CHANGED
 *
 * One kind of entry is deliberately not counted: STATUS_CHANGED to
 * INVESTIGATING. The server writes it a millisecond after the
 * RESPONSE_STARTED that caused it, with the same actor (see
 * IncidentsService.startResponse) — the two are one act, and counting both
 * would make every pickup look like two events.
 *
 * Intensity is the day's counted total, in fixed bands (see LEVELS). Fixed
 * rather than derived from the period, so a level means the same thing on
 * every organization and every range asked for.
 *
 * This is the whole organization's history, by act rather than by author: an
 * entry counts here whoever wrote it. What one person did is a different
 * question, asked and answered separately in member-activity.ts. The two
 * share the day-and-level mechanics in incidents.calendar.ts and nothing
 * else.
 */

import { buildCalendar } from './incidents.calendar.js';
import type {
  Calendar,
  CalendarEntry,
  CalendarIncident,
  LevelThresholds,
} from './incidents.calendar.js';
import type { IncidentActivityType } from './incidents.contract.js';

/** Which kind of operational event an entry is. */
export type OperationalActivityCategory =
  | 'declared'
  | 'responseStarted'
  | 'update'
  | 'responseCompleted'
  | 'resolved'
  | 'changed';

/** The categories in the order a day's breakdown reads. */
export const ACTIVITY_CATEGORIES: readonly OperationalActivityCategory[] = [
  'declared',
  'responseStarted',
  'update',
  'responseCompleted',
  'resolved',
  'changed',
];

/**
 * The lowest total each level above 0 begins at: 1–2, 3–5, 6–10, 11 and up.
 * Chosen against the demo history, whose active days spread evenly across
 * them; a day with nothing is level 0 and belongs to no band.
 */
export const LEVELS: LevelThresholds = [1, 3, 6, 11];

/** One timeline entry, as this module needs to read it. */
export interface ActivityRow<
  Incident extends CalendarIncident,
> extends CalendarEntry<Incident> {
  type: IncidentActivityType;
  toValue: string | null;
}

/**
 * Which category an entry counts as, or undefined when it is not an
 * operational event of its own: the status change a response start causes,
 * and any status change to a value neither this nor a resolution (history is
 * never rewritten, so a retired status recorded long ago still reads).
 */
export const categoryOf = (row: {
  type: IncidentActivityType;
  toValue: string | null;
}): OperationalActivityCategory | undefined => {
  switch (row.type) {
    case 'DECLARED':
      return 'declared';
    case 'RESPONSE_STARTED':
      return 'responseStarted';
    case 'UPDATE':
      return 'update';
    case 'RESPONSE_COMPLETED':
      return 'responseCompleted';
    case 'SEVERITY_CHANGED':
    case 'TEAM_CHANGED':
      return 'changed';
    case 'STATUS_CHANGED':
      return row.toValue === 'RESOLVED' ? 'resolved' : undefined;
    default:
      return undefined;
  }
};

/** The organization's calendar for the period. */
export const buildActivityCalendar = <Incident extends CalendarIncident>(
  rows: readonly ActivityRow<Incident>[],
  period: { from: string; to: string },
): Calendar<OperationalActivityCategory, Incident> =>
  buildCalendar(rows, period, {
    categories: ACTIVITY_CATEGORIES,
    categoryOf,
    thresholds: LEVELS,
  });
