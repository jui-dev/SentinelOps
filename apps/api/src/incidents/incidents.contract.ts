/**
 * The wire contract for incidents.
 *
 * Declared rather than inferred from Prisma models, for the reason
 * auth.contract.ts gives: an inferred type grows a field with every migration.
 */

import type { ServiceCriticality } from '../services/services.contract.js';

/**
 * How serious one incident is, SEV1 the most severe. Chosen for the
 * incident, never derived from its service's criticality. See
 * IncidentSeverity in schema.prisma for what each level means.
 */
export type IncidentSeverity = 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4';

/**
 * Where the incident as a whole stands: DECLARED → INVESTIGATING → RESOLVED,
 * forward only. DECLARED and INVESTIGATING are active; RESOLVED is terminal.
 * See IncidentStatus in schema.prisma for what each means.
 */
export type IncidentStatus = 'DECLARED' | 'INVESTIGATING' | 'RESOLVED';

/**
 * One incident. `number` is the organization's own sequence — the client
 * shows it as INC-{number}, and the API addresses the incident by it.
 *
 * The service, the responsible team, and the declarer are embedded, identity
 * only, so a list needs no second request to name them. Their names are
 * current, not snapshots: renaming a team shows on its past incidents. The
 * responsible team itself is a snapshot — which team it is does not follow
 * the service's owner.
 *
 * `createdBy` names the declarer even if their account was since deleted:
 * attribution is history, not access. It never carries an email.
 *
 * The responsible team's members are who may start investigating it. Who
 * did is `IncidentDetailResponse.responders`, on the single-incident routes.
 */
export interface IncidentResponse {
  id: string;
  number: number;
  title: string;
  summary: string | null;
  severity: IncidentSeverity;
  /**
   * False while a Reporter's severity is a suggestion, waiting for whoever
   * decides on incidents to confirm it; true once settled, and for every
   * incident declared by someone who decides.
   */
  severityConfirmed: boolean;
  status: IncidentStatus;
  responseAccess: IncidentResponseAccess;
  /** The people assigned, in the order they were; empty unless ASSIGNED. */
  assignees: { membershipId: string; name: string }[];
  service: {
    id: string;
    name: string;
    slug: string;
    criticality: ServiceCriticality;
    archivedAt: string | null;
  };
  team: {
    id: string;
    name: string;
    slug: string;
  };
  createdBy: {
    id: string;
    name: string;
  };
  /** The known issue it is an occurrence of; null for a one-off. */
  knownIssue: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

/**
 * `GET .../incidents/:number/repeats`: the incident's known issue, and the
 * other times it has happened. `others` holds only incidents the reader may
 * see, newest first, each with whether its analysis is published; `hidden`
 * counts the rest, so a member is told there are more without being shown
 * them. A one-off has no known issue and no others.
 */
export interface IncidentRepeatsResponse {
  knownIssue: {
    id: string;
    name: string;
    usualSeverity: IncidentSeverity;
  } | null;
  others: {
    number: number;
    title: string;
    severity: IncidentSeverity;
    status: IncidentStatus;
    createdAt: string;
    resolvedAt: string | null;
    analysisPublished: boolean;
  }[];
  hidden: number;
}

/**
 * Where one responder's own part of the response stands. Someone who has not
 * started investigating is not a responder at all, and has no entry.
 */
export type IncidentResponderStatus = 'INVESTIGATING' | 'COMPLETED';

/**
 * A member who started investigating an incident, addressed by their
 * membership id. Identity only: never an email. `completedAt` is set exactly
 * when `status` is COMPLETED.
 */
/**
 * Who may start responding: nobody until the Admin chooses (PENDING), anyone
 * on the responsible team (OPEN), or only the people assigned (ASSIGNED).
 */
export type IncidentResponseAccess = 'PENDING' | 'OPEN' | 'ASSIGNED';

export interface IncidentResponderResponse {
  membershipId: string;
  name: string;
  /** Removed from the organization since: their response stays theirs. */
  former: boolean;
  status: IncidentResponderStatus;
  startedAt: string;
  completedAt: string | null;
}

/**
 * One incident with its responders — what every single-incident route
 * returns. Lists return `IncidentResponse` alone, so a page of incidents
 * stays one query without joins across responders, and without every
 * resolution's prose. `responders` are in the order they started.
 *
 * `resolution` is how a resolved incident ended, in the Admin's words. Null
 * while it is active, and on incidents resolved before a note was required.
 */
export interface IncidentDetailResponse extends IncidentResponse {
  resolution: string | null;
  responders: IncidentResponderResponse[];
}

/**
 * What a timeline entry records. UPDATE is posted by a member; the others are
 * recorded by the server with the change they describe. Starting the
 * investigation is STATUS_CHANGED from DECLARED to INVESTIGATING; resolution
 * is STATUS_CHANGED with `toValue: 'RESOLVED'`. TEAM_CHANGED is a
 * reassignment of the responsible team. RESPONSE_STARTED and
 * RESPONSE_COMPLETED are a responder starting and completing their own
 * response; the actor is the responder.
 */
export type IncidentActivityType =
  | 'DECLARED'
  | 'UPDATE'
  | 'SEVERITY_CHANGED'
  | 'STATUS_CHANGED'
  | 'TEAM_CHANGED'
  | 'RESPONSE_STARTED'
  | 'RESPONSE_COMPLETED'
  | 'RESPONSE_ACCESS_CHANGED'
  | 'SEVERITY_CONFIRMED';

/**
 * One entry on an incident's timeline. History, not state: the incident
 * itself says where it stands now. A status change recorded before the
 * lifecycle was simplified can name a retired status, IDENTIFIED or
 * MONITORING: history is not rewritten.
 *
 * `message` is set for UPDATE, and on the resolution — STATUS_CHANGED to
 * RESOLVED — where it is the resolution note (null on resolutions recorded
 * before notes were required). `fromValue` and `toValue` are severity or
 * status values: DECLARED carries the declared severity in `toValue`; the
 * severity and status changes carry both. TEAM_CHANGED carries the two teams'
 * names as they were when the change was made.
 *
 * Who took part in the response is read from these entries: an UPDATE is the
 * participation, and its actor the participant. There is no separate record
 * of it. `actor` names who posted or made the change even if
 * their account was since deleted, as `createdBy` does. Never an email.
 */
export interface IncidentActivityResponse {
  id: string;
  type: IncidentActivityType;
  message: string | null;
  fromValue: string | null;
  toValue: string | null;
  actor: {
    id: string;
    name: string;
    /**
     * Their role in this organization now — not when they acted, which is
     * not recorded. Null for someone who is no longer a member.
     */
    role: string | null;
  };
  createdAt: string;
}

/** A count for each severity level; a level with none is 0. */
export type SeverityCounts = Record<IncidentSeverity, number>;

/**
 * A service with at least one active incident: identity, its owner, how many
 * active incidents it has, and the most severe of them. Criticality is the
 * classification people chose, not health.
 */
export interface AffectedServiceResponse {
  id: string;
  name: string;
  slug: string;
  criticality: ServiceCriticality;
  archivedAt: string | null;
  ownerTeam: { id: string; name: string; slug: string };
  activeIncidents: number;
  worstSeverity: IncidentSeverity;
}

/**
 * One incident in a period's history: the incident, and which of its two
 * lifecycle moments happened inside the period. At least one is true.
 *
 * An incident declared and resolved in the same period is one item with
 * both set — never two — so the history never lists an incident twice.
 */
export interface IncidentHistoryItemResponse {
  incident: IncidentResponse;
  declaredInPeriod: boolean;
  resolvedInPeriod: boolean;
}

/**
 * `GET .../incidents/summary`: the organization's incidents in two parts.
 *
 * `current` is the state now — every unresolved incident, whenever it was
 * declared — and does not depend on the period asked for.
 *
 * `period` covers whole UTC days, `from` to `to`, both included. `declared`
 * counts incidents declared in it; `declaredBySeverity` splits them by each
 * incident's severity now, which may have changed since it was declared.
 * `resolved` counts incidents resolved in it, whenever they were declared.
 * `stillOpen` counts those declared in it that are not yet resolved.
 *
 * `history` is what happened in the period: every incident declared or
 * resolved in it, most recent first. `total` counts them all — declared
 * plus resolved, less those that were both — while `items` is a preview of
 * the most recent few.
 */
/** How many active incidents stand at each active status. */
export type ActiveStatusCounts = Record<'DECLARED' | 'INVESTIGATING', number>;

/**
 * How long incidents of each severity have typically taken to resolve: the
 * median from declaration to resolution, over the incidents at that
 * severity resolved in the whole UTC days `from` to `to` — the last
 * ninety, today included.
 *
 * `resolved` is how many that is. `medianMs` is null while it is fewer than
 * `minimumSample`: a middle value of three incidents describes those three,
 * not what is typical. Each incident counts at its severity now, as every
 * other summary figure does.
 */
export interface TypicalResolutionResponse {
  from: string;
  to: string;
  minimumSample: number;
  bySeverity: Record<
    IncidentSeverity,
    { resolved: number; medianMs: number | null }
  >;
}

export interface IncidentSummaryResponse {
  current: {
    active: number;
    activeBySeverity: SeverityCounts;
    affectedServices: AffectedServiceResponse[];
    /**
     * Who is investigating now. `active` counts the members whose own
     * response is still under way, each once however many incidents they
     * are on; `teams` counts the responsible teams of those incidents.
     *
     * Only actual participation: a member of a responsible team who has
     * not started is not a responder, and a completed response is not an
     * active one.
     */
    responders: {
      active: number;
      teams: number;
    };
    /** The active incidents by lifecycle status: declared, or investigating. */
    activeByStatus: ActiveStatusCounts;
    /**
     * Investigating incidents no one is still investigating: every response
     * has completed, and the Admin may resolve them.
     */
    readyToResolve: number;
    /** What an active incident's duration can honestly be read against. */
    typicalResolution: TypicalResolutionResponse;
  };
  period: {
    from: string;
    to: string;
    declared: number;
    declaredBySeverity: SeverityCounts;
    resolved: number;
    stillOpen: number;
    /**
     * The median time from declaration to resolution of the incidents
     * resolved in the period, whenever they were declared; null when none
     * was. Every resolution counts, however few: `resolved` says how many.
     */
    resolutionMedianMs: number | null;
    history: {
      total: number;
      items: IncidentHistoryItemResponse[];
    };
  };
}

/**
 * `GET .../incidents/attention`: the active incidents waiting on the caller
 * now. Current state, not events — an incident appears while the work
 * exists and is gone once it does not. The timeline is the history.
 *
 * Each part is present only with its permission, and null otherwise:
 *
 *   manage.needsDecision   `incidents:manage`. Nobody may respond until the
 *                          Admin opens it to its team or assigns people.
 *   manage.readyToResolve  `incidents:manage`. INVESTIGATING, and no
 *                          responder is still investigating — resolvable.
 *   respond.assignedToYou  `incidents:respond`. The caller was assigned to
 *                          it and has not started.
 *   respond.needsYourTeam  `incidents:respond`. Open to one of the caller's
 *                          teams, and nobody now on that team has responded.
 *   respond.yourResponses  `incidents:respond`. The caller's own response is
 *                          still investigating, whatever team it has now.
 *
 * An incident can be in more than one list: resolvable, and reassigned to
 * a team none of whose members has responded, are two facts about it. Each
 * list is in the active list's order — most severe, then longest-running,
 * first — and unpaged: it holds active incidents only.
 */
export interface IncidentAttentionResponse {
  manage: {
    needsDecision: IncidentDetailResponse[];
    readyToResolve: IncidentDetailResponse[];
  } | null;
  respond: {
    assignedToYou: IncidentDetailResponse[];
    needsYourTeam: IncidentDetailResponse[];
    yourResponses: IncidentDetailResponse[];
  } | null;
}

/**
 * What kind of operational event a timeline entry is, for the organization's
 * activity. See incidents.activity.ts for which entry types each covers, and
 * for the one kind that is deliberately not counted.
 */
export type OperationalActivityCategory =
  | 'declared'
  | 'responseStarted'
  | 'update'
  | 'responseCompleted'
  | 'resolved'
  | 'changed';

/** How busy a day was: 0 is quiet, 4 the busiest band. */
export type ActivityLevel = 0 | 1 | 2 | 3 | 4;

/**
 * An incident something happened to on one day: identity, where it stands
 * now, and how many of that day's events were about it. Deliberately
 * narrower than `IncidentResponse` — a calendar names incidents so they can
 * be recognised and opened, and carries none of their prose.
 *
 * The service is named, not the responsible team: which service was hit is
 * what a day's history is read by. `severity` and `status` are current, not
 * as they were on the day.
 */
export interface ActivityIncidentResponse {
  id: string;
  number: number;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  service: { name: string; slug: string };
  events: number;
}

/**
 * One day of operational activity. `counts` carries every category, zero
 * included, so a client never checks whether a key is there. `incidents`
 * names the busiest few; `moreIncidents` is how many others the day touched.
 */
export interface OperationalActivityDayResponse {
  /** The UTC calendar day, `YYYY-MM-DD`. */
  date: string;
  total: number;
  level: ActivityLevel;
  counts: Record<OperationalActivityCategory, number>;
  incidents: ActivityIncidentResponse[];
  moreIncidents: number;
}

/**
 * `GET .../incidents/activity`: when this organization was operationally
 * active, over a period of whole UTC days, `from` to `to`, both included.
 *
 * `days` holds every day of the period, oldest first — a quiet day is a day
 * whose total is 0, never a missing one — so a calendar is drawn without
 * filling gaps. `total` counts the period's events and `activeDays` the days
 * that had any.
 *
 * `thresholds` is the lowest total each level above 0 begins at, so a legend
 * can name its bands without knowing them. They are fixed, not derived from
 * the period: a level means the same thing whatever was asked for.
 *
 * Which UTC day a calendar week starts on is the client's presentation
 * choice, and nothing here depends on it: these are days, not weeks.
 */
export interface OperationalActivityResponse {
  from: string;
  to: string;
  days: OperationalActivityDayResponse[];
  total: number;
  activeDays: number;
  thresholds: [number, number, number, number];
}

/**
 * One day of incident occurrence: how many incidents were declared on it.
 *
 * `complete` is false for a day not yet over — today — and any after it;
 * such a day is counted but never incident-free and has no average.
 * `tracked` is false before the organization had any history. Neither kind
 * is a quiet day: there is nothing yet to be quiet about.
 *
 * `rollingAverage` is the mean of the day and the six before it, for a
 * complete day whose seven are all tracked, and null otherwise. To two
 * decimal places.
 */
export interface IncidentOccurrenceDayResponse {
  /** The UTC calendar day, `YYYY-MM-DD`. */
  date: string;
  declared: number;
  complete: boolean;
  tracked: boolean;
  rollingAverage: number | null;
}

/**
 * A service incidents were declared against in the period: identity, how
 * many, and what share of the period's incidents that is. Every incident
 * has exactly one service, fixed at declaration, so the shares of all the
 * period's services sum to 1. An archived service is here like any other:
 * its incidents are history.
 */
export interface ServiceOccurrenceResponse {
  id: string;
  name: string;
  slug: string;
  criticality: ServiceCriticality;
  archivedAt: string | null;
  declared: number;
  /** Of the period's incidents, 0 to 1. */
  share: number;
}

/**
 * `GET .../incidents/occurrence`: how often incidents were declared over a
 * period of whole UTC days, `from` to `to`, both included, and against
 * which services — compared with the same number of days before it.
 *
 * Occurrence only: an incident counts once, on the UTC day it was
 * declared, whatever became of it. See incidents.occurrence.ts for every
 * rule this follows.
 *
 * Counting stops at `asOf` — now, or the period's end if that came first.
 * `previous` covers the same elapsed time immediately before, so a day in
 * progress never makes the present look quieter than the past.
 *
 * `trackedFrom` is the first UTC day of the organization's history, null
 * when there is none. `incidentFreeDays` counts complete, tracked days with
 * no declaration, of `completeDays`.
 *
 * `previous.changePercent` is the whole-number change from the previous
 * period, and null when it cannot honestly be given: the previous period
 * was not wholly tracked, or held fewer than `minimumSample` incidents —
 * none, most often. The counts are always there to say it in words.
 *
 * `services.top` names the busiest few — ties by name — and
 * `services.others` sums the rest, so the named and the others together are
 * the whole period.
 */
export interface IncidentOccurrenceResponse {
  from: string;
  to: string;
  asOf: string;
  trackedFrom: string | null;
  declared: number;
  incidentFreeDays: number;
  completeDays: number;
  days: IncidentOccurrenceDayResponse[];
  previous: {
    from: string;
    to: string;
    declared: number;
    comparable: boolean;
    minimumSample: number;
    changePercent: number | null;
  };
  services: {
    top: ServiceOccurrenceResponse[];
    others: { services: number; declared: number };
  };
}

/**
 * Which of the three acts of responding a member's entry is. See
 * member-activity.ts for what is deliberately not one.
 */
export type MemberActivityCategory =
  'responseStarted' | 'update' | 'responseCompleted';

/** One day of one member's response activity. */
export interface MemberActivityDayResponse {
  /** The UTC calendar day, `YYYY-MM-DD`. */
  date: string;
  total: number;
  level: ActivityLevel;
  counts: Record<MemberActivityCategory, number>;
  incidents: ActivityIncidentResponse[];
  moreIncidents: number;
}

/**
 * `GET .../memberships/:membershipId/activity`: when this member personally
 * took part in incident response, over a period of whole UTC days.
 *
 * Only what they wrote themselves: responses they started, updates they
 * posted, responses they completed. Being on a team is not activity, nor is
 * an incident they could have picked up, nor anything a teammate did.
 *
 * Shaped like the organization's activity, and not to be read against it:
 * `thresholds` are a person's, far lower than an organization's, because one
 * person writes an order of magnitude less. Descriptive history, not a
 * measure — nothing here ranks or compares anyone.
 */
export interface MemberActivityResponse {
  from: string;
  to: string;
  days: MemberActivityDayResponse[];
  total: number;
  activeDays: number;
  thresholds: [number, number, number, number];
}

/**
 * One page of a collection. `cursor` is opaque and asks for the page after
 * this one; it is null exactly when `hasMore` is false.
 */
/**
 * An incident as a list gives it: the incident, where its response stands
 * — how many are investigating and how many have completed, counts only —
 * and when the last update was posted, or null before any. Enough to scan a
 * list by; the responders themselves are the incident's own route.
 */
export interface IncidentListItemResponse extends IncidentResponse {
  response: { investigating: number; completed: number };
  lastUpdateAt: string | null;
  /**
   * The caller's own response to it, or null if they have not started. Only
   * ever the caller's: no one else's responder row reaches a list.
   */
  yourResponse: {
    status: IncidentResponderStatus;
    startedAt: string;
    completedAt: string | null;
  } | null;
}

/** How many incidents one part holds, in all and by team and severity. */
export interface IncidentPartCount {
  total: number;
  /** Teams with at least one; the team's id, as the lists name it. */
  byTeam: { teamId: string; count: number }[];
  bySeverity: SeverityCounts;
}

/**
 * `GET /organizations/:organizationId/incidents/parts`: the caller's active
 * incidents counted by their own part in each, and all of them, within what
 * their incident list would show. The counts ignore the list's other filters
 * and its search: they size the tabs and the filter pills.
 */
export interface IncidentPartsResponse {
  'needs-you': IncidentPartCount;
  investigating: IncidentPartCount;
  completed: IncidentPartCount;
  active: IncidentPartCount;
}

/**
 * One incident in a response flow: enough to recognise and open it, when it
 * was declared, first started, and resolved, and how many responded. The
 * caller's own updates on it inside the window are carried so they can see
 * where their work fell — never anyone else's.
 */
export interface IncidentFlowItemResponse {
  number: number;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  service: { id: string; name: string; slug: string };
  createdAt: string;
  /** The first responder's start; null while nobody has started. */
  startedAt: string | null;
  resolvedAt: string | null;
  /** Declaration to first start — or to resolution or now, unstarted. */
  waitMs: number;
  responders: number;
  yourUpdates: string[];
}

/**
 * Figures over a flow's incidents, team-level only. `typicalWaitMs` is the
 * median wait of the `started` incidents someone has started, null with
 * none; `mostAtOnce` the most running at one instant in the window and when
 * that began; `longestWait` the longest wait, whose, and whether it is still
 * running; `waitingNow` the unresolved ones nobody has started.
 */
export interface IncidentFlowFiguresResponse {
  typicalWaitMs: number | null;
  started: number;
  mostAtOnce: { count: number; at: string } | null;
  longestWait: { ms: number; number: number; waiting: boolean } | null;
  waitingNow: number;
}

/**
 * `GET .../incidents/flow`: how teams' incidents ran over the last `days`
 * whole UTC days, `from` to `to`, counting stopped at `asOf`.
 *
 * `scope` says whose: `teams`, the caller's own teams now; `organization`,
 * every team, for whoever oversees every incident. Each team is listed, in
 * name order, even with nothing in the window. An incident belongs to the
 * team responsible for it now, and is here if it was running at any point
 * in the window — waiting first, then being worked, then resolved; newest
 * first in each.
 */
export interface IncidentFlowResponse {
  from: string;
  to: string;
  asOf: string;
  days: 7 | 14;
  scope: 'teams' | 'organization';
  figures: IncidentFlowFiguresResponse;
  teams: {
    id: string;
    name: string;
    slug: string;
    figures: IncidentFlowFiguresResponse;
    incidents: IncidentFlowItemResponse[];
  }[];
}

/**
 * `GET .../incidents/history`: one page of a period's history, every
 * incident declared or resolved in it, most recent first — each placed at
 * its resolution when that fell in the period, and its declaration
 * otherwise. `total` counts every incident the filters match, on every page.
 */
export interface IncidentHistoryPage {
  items: IncidentHistoryItemResponse[];
  total: number;
  page: {
    cursor: string | null;
    hasMore: boolean;
  };
}

export interface IncidentPage {
  items: IncidentListItemResponse[];
  page: {
    cursor: string | null;
    hasMore: boolean;
  };
}

/**
 * One of a member's responses: an incident they started investigating, and
 * where their own part of it stands. Only actual participation — a member
 * who never started has no response, whatever their team.
 */
export interface MemberResponseResponse {
  incident: IncidentResponse;
  status: IncidentResponderStatus;
  startedAt: string;
  completedAt: string | null;
}

/**
 * `GET .../memberships/:membershipId/responses`: a member's responses, the
 * most recently started first, one page at a time. The cursor is opaque, as
 * the incident lists' are.
 */
export interface MemberResponsePage {
  items: MemberResponseResponse[];
  page: {
    cursor: string | null;
    hasMore: boolean;
  };
}
