/**
 * One member's response activity: when they personally took part in incident
 * response, and what they did.
 *
 * Only what they themselves wrote. An entry counts when its actor is this
 * membership and it is one of the three acts of responding:
 *
 *   responseStarted    RESPONSE_STARTED
 *   update             UPDATE
 *   responseCompleted  RESPONSE_COMPLETED
 *
 * Nothing else does. Declaring, resolving, reassigning a team, and changing a
 * severity are the Admin's authority over an incident rather than
 * participation in its response, so DECLARED, STATUS_CHANGED, SEVERITY_CHANGED
 * and TEAM_CHANGED are never counted — including the STATUS_CHANGED to
 * INVESTIGATING the server writes a millisecond after a start, which would
 * otherwise count the same person's pickup twice.
 *
 * An Admin is a member like any other here: an update they wrote is real
 * participation and counts, while the incidents they declared and resolved do
 * not. Whoever holds whatever permission, what is counted is what they wrote.
 *
 * Being on a team is not activity. Neither is an incident a member could have
 * picked up and did not, nor anything a teammate did on an incident they
 * share. Only authorship.
 *
 * This is descriptive history, not a measure of a person: no score, no rank,
 * no comparison with anyone else. Its bands (see MEMBER_LEVELS) are its own
 * and are far lower than the organization's — one person's busy day is a
 * quiet day for a whole organization — so the two are never read against
 * each other.
 *
 * Pure, and separate from incidents.activity.ts by design: the two share the
 * day-and-level mechanics in incidents.calendar.ts and no judgement at all.
 */

import { buildCalendar } from './incidents.calendar.js';
import type {
  Calendar,
  CalendarEntry,
  CalendarIncident,
  LevelThresholds,
} from './incidents.calendar.js';
import type { IncidentActivityType } from './incidents.contract.js';

/** Which of the three acts of responding an entry is. */
export type MemberActivityCategory =
  'responseStarted' | 'update' | 'responseCompleted';

/** The categories in the order a day's breakdown reads. */
export const MEMBER_ACTIVITY_CATEGORIES: readonly MemberActivityCategory[] = [
  'responseStarted',
  'update',
  'responseCompleted',
];

/**
 * The lowest total each level above 0 begins at: 1, 2–3, 4–5, 6 and up.
 * One person writes an order of magnitude less than a whole organization, so
 * these are the organization's bands brought down to a person's scale —
 * chosen against the demo history, where each persona reaches the upper
 * bands on their genuinely busy days without living there.
 */
export const MEMBER_LEVELS: LevelThresholds = [1, 2, 4, 6];

/** One timeline entry by this member, as this module needs to read it. */
export interface MemberActivityRow<
  Incident extends CalendarIncident,
> extends CalendarEntry<Incident> {
  type: IncidentActivityType;
}

/**
 * Which act of responding an entry is, or undefined when it is not one.
 *
 * The entries are already the member's own — the service reads them by
 * actor — so this judges the act alone and never the author.
 */
export const memberCategoryOf = (row: {
  type: IncidentActivityType;
}): MemberActivityCategory | undefined => {
  switch (row.type) {
    case 'RESPONSE_STARTED':
      return 'responseStarted';
    case 'UPDATE':
      return 'update';
    case 'RESPONSE_COMPLETED':
      return 'responseCompleted';
    default:
      return undefined;
  }
};

/** The member's calendar for the period. */
export const buildMemberActivityCalendar = <Incident extends CalendarIncident>(
  rows: readonly MemberActivityRow<Incident>[],
  period: { from: string; to: string },
): Calendar<MemberActivityCategory, Incident> =>
  buildCalendar(rows, period, {
    categories: MEMBER_ACTIVITY_CATEGORIES,
    categoryOf: memberCategoryOf,
    thresholds: MEMBER_LEVELS,
  });
