/**
 * The API's wire contract, as this client relies on it.
 *
 * Hand-written copies of the declarations in `apps/api/src/**\/*.contract.ts`
 * and `api-error.contract.ts`. Kept in this one file so that drift has one
 * place to be found; a shared package is deliberately not introduced yet.
 */

export interface UserResponse {
  id: string;
  email: string;
  name: string;
  createdAt: string;
  /**
   * True while the account is on a one-time password an admin chose. The API
   * refuses every organization route until it is replaced.
   */
  passwordChangeRequired: boolean;
}

export interface OrganizationResponse {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

export interface MembershipResponse {
  id: string;
  role: string;
  organization: OrganizationResponse;
}

/** `POST /auth/register`, `POST /auth/login`. */
export interface AuthenticatedResponse {
  accessToken: string;
  expiresIn: number;
  tokenType: "Bearer";
  user: UserResponse;
}

/** `POST /auth/refresh`. */
export interface RefreshedResponse {
  accessToken: string;
  expiresIn: number;
  tokenType: "Bearer";
}

/** `GET /auth/me`. */
export interface CurrentUserResponse extends UserResponse {
  memberships: MembershipResponse[];
}

/** `GET /organizations/:organizationId`. */
export interface OrganizationDetailResponse extends OrganizationResponse {
  membership: {
    id: string;
    role: string;
    /**
     * What the caller's role permits, as reported by the API. The UI uses it
     * only to decide what to offer; the API enforces every route regardless.
     */
    permissions: string[];
  };
}

/** One item of `GET /organizations/:organizationId/memberships`. */
export interface OrganizationMembershipResponse {
  id: string;
  role: string;
  createdAt: string;
  user: {
    id: string;
    name: string;
    email: string;
    /** True until they replace the one-time password they were given. */
    passwordChangeRequired: boolean;
  };
  /** Every team in this organization they are on, by name; empty for none. */
  teams: { id: string; name: string; slug: string }[];
}

/** `POST /organizations/:organizationId/memberships`. */
export interface CreateMemberRequest {
  name: string;
  email: string;
  temporaryPassword: string;
  /** Teams to place them on, all in this organization. Optional. */
  teamIds?: string[];
}

/** `POST /auth/password`. */
export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
  organizationName: string;
  organizationSlug?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface UpdateOrganizationRequest {
  name: string;
}

/** One open invitation, as `GET /organizations/:organizationId/invitations` lists it. */
export interface InvitationResponse {
  id: string;
  email: string;
  role: string;
  status: "pending" | "expired";
  expiresAt: string;
  createdAt: string;
  invitedBy: { id: string; name: string };
}

/**
 * `POST /organizations/:organizationId/invitations`. The only response that
 * carries an invitation token; it is shown once and kept nowhere.
 */
export interface CreatedInvitationResponse {
  invitation: InvitationResponse;
  token: string;
  replacedExisting: boolean;
}

/** `POST /invitations/lookup`. */
export interface InvitationLookupResponse {
  organization: { id: string; name: string; slug: string };
  email: string;
  role: string;
  expiresAt: string;
  invitedBy: { name: string };
}

/** Roles an invitation may offer. */
export type InvitableRole = "ADMIN" | "MEMBER";

export interface CreateInvitationRequest {
  email: string;
  role: InvitableRole;
}

export interface RegisterWithInvitationRequest {
  token: string;
  name: string;
  password: string;
}

/**
 * One team, as `GET /organizations/:organizationId/teams` lists it. `slug`
 * is derived by the API and used only to build URLs.
 */
export interface TeamResponse {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  memberCount: number;
  /** Services this team owns. While above zero the team cannot be deleted. */
  serviceCount: number;
  createdAt: string;
  updatedAt: string;
}

/** One member of a team, keyed by their organization membership id. */
export interface TeamMemberResponse {
  membershipId: string;
  addedAt: string;
  user: {
    id: string;
    name: string;
    email: string;
  };
}

/** No slug: the API derives it from the name. */
export interface CreateTeamRequest {
  name: string;
  description?: string | null;
}

export interface UpdateTeamRequest {
  name?: string;
  description?: string | null;
}

/**
 * How much the organization depends on a service. A classification people
 * choose, shown as words — never sorted or computed by, and not health.
 */
export type ServiceCriticality = "CRITICAL" | "HIGH" | "NORMAL" | "LOW";

/**
 * One service, as `GET /organizations/:organizationId/services` lists it.
 * `slug` is derived by the API and used only to build URLs.
 */
export interface ServiceResponse {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  criticality: ServiceCriticality;
  ownerTeam: { id: string; name: string; slug: string };
  /**
   * When the service was retired, or null while in use. An archived service
   * keeps its incidents but cannot have new ones declared against it.
   */
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** No slug: the API derives it from the name. Criticality defaults to NORMAL. */
export interface CreateServiceRequest {
  name: string;
  description?: string | null;
  ownerTeamId: string;
  criticality?: ServiceCriticality;
}

/** Ownership moves; it is never cleared. `archived` retires or restores it. */
export interface UpdateServiceRequest {
  name?: string;
  description?: string | null;
  ownerTeamId?: string;
  criticality?: ServiceCriticality;
  archived?: boolean;
}

/** How serious one incident is, SEV1 the most severe. Not criticality. */
export type IncidentSeverity = "SEV1" | "SEV2" | "SEV3" | "SEV4";

/**
 * DECLARED → INVESTIGATING → RESOLVED, forward only. The first two are
 * active; RESOLVED is terminal.
 */
export type IncidentStatus = "DECLARED" | "INVESTIGATING" | "RESOLVED";

/**
 * One incident. `number` is the organization's own sequence, shown as
 * INC-{number} and used to address it. The responsible `team` is the
 * service's owner when the incident was declared, unless reassigned since.
 * Its members are who may start investigating it.
 */
export interface IncidentResponse {
  id: string;
  number: number;
  title: string;
  summary: string | null;
  severity: IncidentSeverity;
  status: IncidentStatus;
  service: {
    id: string;
    name: string;
    slug: string;
    criticality: ServiceCriticality;
    archivedAt: string | null;
  };
  team: { id: string; name: string; slug: string };
  createdBy: { id: string; name: string };
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

/**
 * An incident as a list gives it: where its response stands, in counts, and
 * when the last update was posted — null before any. The responders
 * themselves are the incident's own route.
 */
export interface IncidentListItemResponse extends IncidentResponse {
  response: { investigating: number; completed: number };
  lastUpdateAt: string | null;
}

/**
 * Where one responder's own part of the response stands. Someone who has not
 * started investigating is not a responder, and has no entry.
 */
export type IncidentResponderStatus = "INVESTIGATING" | "COMPLETED";

/** A member who started investigating, by membership id. Never an email. */
export interface IncidentResponderResponse {
  membershipId: string;
  name: string;
  status: IncidentResponderStatus;
  startedAt: string;
  completedAt: string | null;
}

/**
 * One incident with its responders — what every single-incident route
 * returns; list items carry no responders. The responders are the current
 * state of the response, in the order they started; the timeline is its
 * history.
 *
 * `resolution` is how a resolved incident ended, in the Admin's words: null
 * while it is active, and on incidents resolved before a note was required.
 */
export interface IncidentDetailResponse extends IncidentResponse {
  resolution: string | null;
  responders: IncidentResponderResponse[];
}

/**
 * What a timeline entry records. UPDATE is posted by a member; the others the
 * server records with the change. Starting the investigation is
 * STATUS_CHANGED from DECLARED to INVESTIGATING; resolution is STATUS_CHANGED
 * to RESOLVED. A status change recorded before the lifecycle was simplified
 * can name a retired status, IDENTIFIED or MONITORING. TEAM_CHANGED is a
 * reassignment of the responsible team. RESPONSE_STARTED and
 * RESPONSE_COMPLETED are a responder starting and completing their own
 * response; the actor is the responder. The first response to start moves a
 * DECLARED incident, recorded as a STATUS_CHANGED by the same responder.
 */
export type IncidentActivityType =
  | "DECLARED"
  | "UPDATE"
  | "SEVERITY_CHANGED"
  | "STATUS_CHANGED"
  | "TEAM_CHANGED"
  | "RESPONSE_STARTED"
  | "RESPONSE_COMPLETED";

/**
 * One entry on an incident's timeline. `message` is set for UPDATE, and on
 * the resolution (STATUS_CHANGED to RESOLVED) as its note — null on
 * resolutions recorded before notes were required;
 * `fromValue`/`toValue` are severities or statuses (DECLARED carries only the
 * declared severity in `toValue`), or for TEAM_CHANGED the two teams' names
 * as they were then. The actor is identity only.
 */
export interface IncidentActivityResponse {
  id: string;
  type: IncidentActivityType;
  message: string | null;
  fromValue: string | null;
  toValue: string | null;
  actor: { id: string; name: string };
  createdAt: string;
}

export interface PostIncidentUpdateRequest {
  message: string;
}

/**
 * An incident analysis is written once the incident is resolved: a DRAFT
 * its owner writes, then PUBLISHED — final, and never reopened.
 */
export type IncidentAnalysisStatus = "DRAFT" | "PUBLISHED";

/** The written sections of an analysis, in the order they are read. */
export const ANALYSIS_SECTIONS = [
  "summary",
  "impact",
  "cause",
  "lessons",
] as const;

export type AnalysisSection = (typeof ANALYSIS_SECTIONS)[number];

/** The most characters one section holds, as the API enforces. */
export const ANALYSIS_SECTION_MAX_LENGTH = 4000;

/**
 * What SentinelOps already knew about the incident, derived by the API on
 * every read: instants and counts, never durations — the client measures
 * between them. `firstResponseAt` is null when nobody's start was recorded.
 */
export interface IncidentAnalysisFactsResponse {
  declaredAt: string;
  resolvedAt: string;
  firstResponseAt: string | null;
  responderCount: number;
  updateCount: number;
  severity: {
    declared: IncidentSeverity;
    highest: IncidentSeverity;
    final: IncidentSeverity;
  };
  reassignmentCount: number;
}

export type IncidentKeyMomentKind =
  | "DECLARED"
  | "FIRST_RESPONSE"
  | "SEVERITY_CHANGED"
  | "TEAM_CHANGED"
  | "LAST_RESPONSE_COMPLETED"
  | "RESOLVED";

/**
 * A timeline entry that shaped the incident — a selection, not the
 * timeline. `activityId` names the entry; `fromValue` and `toValue` are as
 * it recorded them: two severities, or two team names as they were then.
 */
export interface IncidentKeyMomentResponse {
  kind: IncidentKeyMomentKind;
  activityId: string;
  at: string;
  actor: { id: string; name: string };
  fromValue: string | null;
  toValue: string | null;
}

/**
 * `.../incidents/:number/analysis`: one incident's analysis. It has no id of
 * its own — it is addressed through its incident.
 *
 * `version` identifies this state of it, and every write names the version
 * it was based on: a write based on any other is refused, and changes
 * nothing. Every accepted write — an edit, a new owner, publishing — makes
 * the next version.
 *
 * A section is null until written. `owner` is a membership, accountable for
 * writing it now; `createdBy` and `publishedBy` are attribution.
 */
export interface IncidentAnalysisResponse {
  status: IncidentAnalysisStatus;
  version: number;
  owner: { membershipId: string; name: string };
  summary: string | null;
  impact: string | null;
  cause: string | null;
  lessons: string | null;
  createdBy: { id: string; name: string };
  createdAt: string;
  publishedBy: { id: string; name: string } | null;
  publishedAt: string | null;
  updatedAt: string;
  facts: IncidentAnalysisFactsResponse;
  keyMoments: IncidentKeyMomentResponse[];
}

/** Starting an analysis. The owner is the caller unless another is named. */
export interface StartIncidentAnalysisRequest {
  ownerMembershipId?: string;
}

/**
 * Editing a draft's sections, based on `version`. A section left out is
 * unchanged; blank or null clears it. At least one must be named.
 */
export type EditIncidentAnalysisRequest = {
  version: number;
} & Partial<Record<AnalysisSection, string | null>>;

/** Handing a draft to another member, based on `version`. */
export interface ReassignIncidentAnalysisOwnerRequest {
  ownerMembershipId: string;
  version: number;
}

/** Publishing a draft exactly as it stands at `version`. */
export interface PublishIncidentAnalysisRequest {
  version: number;
}

/** A count for each severity level; a level with none is 0. */
export type SeverityCounts = Record<IncidentSeverity, number>;

/** A service with at least one active incident, and the worst of them. */
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
 * One incident in a period's history, with which of its two lifecycle
 * moments happened inside the period. At least one is true, and an incident
 * declared and resolved in the same period is one item with both set.
 */
export interface IncidentHistoryItemResponse {
  incident: IncidentResponse;
  declaredInPeriod: boolean;
  resolvedInPeriod: boolean;
}

/** How many active incidents stand at each active status. */
export type ActiveStatusCounts = Record<"DECLARED" | "INVESTIGATING", number>;

/**
 * How long incidents of each severity have typically taken to resolve: the
 * median from declaration to resolution, over the incidents at that
 * severity resolved in the whole UTC days `from` to `to` — the last ninety,
 * today included. `medianMs` is null while fewer than `minimumSample` were
 * resolved: a middle value of three describes those three, not what is
 * typical.
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

/**
 * `GET /organizations/:organizationId/incidents/summary`. `current` is every
 * unresolved incident now, whatever the period. `period` covers whole UTC
 * days `from` to `to`, both included; `declaredBySeverity` counts each
 * incident at its severity now.
 * `history` is what happened in the period: every incident declared
 * or resolved in it, most recent first, with `total` counting them all and
 * `items` previewing the most recent few.
 */
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
    /** Investigating, and no one still is: the Admin may resolve them. */
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
     * resolved in the period, whenever declared; null when none was.
     */
    resolutionMedianMs: number | null;
    history: {
      total: number;
      items: IncidentHistoryItemResponse[];
    };
  };
}

/**
 * `GET .../incidents/history`: one page of a period's history, most recent
 * first, each incident at its resolution when that fell in the period and
 * its declaration otherwise. `total` counts every incident the filters
 * match, on every page.
 */
export interface IncidentHistoryPage {
  items: IncidentHistoryItemResponse[];
  total: number;
  page: { cursor: string | null; hasMore: boolean };
}

/**
 * One incident in a response flow. `waitMs` runs from its declaration to its
 * first responder's start — or, unstarted, to its resolution or now.
 * `yourUpdates` are the caller's own, never anyone else's.
 */
export interface IncidentFlowItemResponse {
  number: number;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  service: { id: string; name: string; slug: string };
  createdAt: string;
  startedAt: string | null;
  resolvedAt: string | null;
  waitMs: number;
  responders: number;
  yourUpdates: string[];
}

/** Team-level figures over a flow's incidents; never anyone's own. */
export interface IncidentFlowFiguresResponse {
  typicalWaitMs: number | null;
  started: number;
  mostAtOnce: { count: number; at: string } | null;
  longestWait: { ms: number; number: number; waiting: boolean } | null;
  waitingNow: number;
}

/**
 * `GET .../incidents/flow`: how teams' incidents ran over the last `days`
 * whole UTC days, counting stopped at `asOf`. `scope` is `teams` — the
 * caller's own — or `organization`, every team, for whoever oversees.
 */
export interface IncidentFlowResponse {
  from: string;
  to: string;
  asOf: string;
  days: 7 | 14;
  scope: "teams" | "organization";
  figures: IncidentFlowFiguresResponse;
  teams: {
    id: string;
    name: string;
    slug: string;
    figures: IncidentFlowFiguresResponse;
    incidents: IncidentFlowItemResponse[];
  }[];
}

/** Which of a period's incidents: still open, or resolved in it. */
export type IncidentHistoryShow = "open" | "resolved";

export interface IncidentHistoryFilters {
  severity?: IncidentSeverity;
  show?: IncidentHistoryShow;
  q?: string;
}

/**
 * `GET /organizations/:organizationId/incidents/attention`: the active
 * incidents waiting on the caller now. Current state, not a feed — nothing
 * is read or unread. Each part is null without its permission:
 * `readyToResolve` with `incidents:manage`; `needsYourTeam` (their teams'
 * incidents nobody on the team has responded to) and `yourResponses` (their
 * own still investigating) with `incidents:respond`. One incident can be in
 * more than one list. Each list is most severe first, then longest-running.
 */
export interface IncidentAttentionResponse {
  manage: { readyToResolve: IncidentDetailResponse[] } | null;
  respond: {
    needsYourTeam: IncidentDetailResponse[];
    yourResponses: IncidentDetailResponse[];
  } | null;
}

/**
 * What kind of operational event a timeline entry is. The status change a
 * response start causes is not one: it and the start are a single act.
 */
export type OperationalActivityCategory =
  | "declared"
  | "responseStarted"
  | "update"
  | "responseCompleted"
  | "resolved"
  | "changed";

/** How busy a day was: 0 is quiet, 4 the busiest band. */
export type ActivityLevel = 0 | 1 | 2 | 3 | 4;

/**
 * An incident something happened to on one day: enough to recognise and
 * open it, and how many of that day's events were about it. Never its prose.
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
 * What one member did, as their activity counts it: responses they started,
 * updates they posted, and responses they finished.
 */
export type MemberActivityCategory =
  | "responseStarted"
  | "update"
  | "responseCompleted";

/** One day of one member's response activity, every category zero-filled. */
export interface MemberActivityDayResponse {
  date: string;
  total: number;
  level: ActivityLevel;
  counts: Record<MemberActivityCategory, number>;
  incidents: ActivityIncidentResponse[];
  moreIncidents: number;
}

/**
 * `GET .../memberships/:membershipId/activity`: one member's response
 * activity over whole UTC days `from` to `to`, every day present, oldest
 * first — their own, or oversight's to read.
 */
export interface MemberActivityResponse {
  from: string;
  to: string;
  days: MemberActivityDayResponse[];
  total: number;
  activeDays: number;
  thresholds: [number, number, number, number];
}

/** One day of operational activity, with every category zero-filled. */
export interface OperationalActivityDayResponse {
  date: string;
  total: number;
  level: ActivityLevel;
  counts: Record<OperationalActivityCategory, number>;
  incidents: ActivityIncidentResponse[];
  moreIncidents: number;
}

/**
 * `GET /organizations/:organizationId/incidents/activity`: when the
 * organization was operationally active, over whole UTC days `from` to `to`.
 *
 * `days` holds every day of the period, oldest first — a quiet day has a
 * total of 0 rather than being missing — so a calendar is drawn without
 * filling gaps. `thresholds` is the lowest total each level above 0 begins
 * at, fixed rather than derived from the period.
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
 * `complete` is false for a day not yet over — today — which is counted but
 * never incident-free and has no average. `tracked` is false before the
 * organization had any history: such a day is not quiet, it is unknown.
 * `rollingAverage` is the mean of the day and the six before it, to two
 * decimal places, and null where the API could not honestly give one.
 */
export interface IncidentOccurrenceDayResponse {
  date: string;
  declared: number;
  complete: boolean;
  tracked: boolean;
  rollingAverage: number | null;
}

/**
 * A service incidents were declared against in the period. Each incident
 * has exactly one service, so `share` — of the period's incidents, 0 to 1 —
 * sums to 1 across all of them. Archived services are included: history.
 */
export interface ServiceOccurrenceResponse {
  id: string;
  name: string;
  slug: string;
  criticality: ServiceCriticality;
  archivedAt: string | null;
  declared: number;
  share: number;
}

/**
 * `GET /organizations/:organizationId/incidents/occurrence`: how often
 * incidents were declared over whole UTC days `from` to `to`, and against
 * which services, compared with the same elapsed time just before.
 *
 * The API decides every figure; a client reads them and never recomputes
 * them. Counting stops at `asOf`. `incidentFreeDays` is of `completeDays`
 * — complete, tracked days — and `trackedFrom` is where history begins.
 *
 * `previous.changePercent` is a whole-number change, or null when it cannot
 * honestly be given: the previous period was not wholly tracked
 * (`comparable` false) or held fewer than `minimumSample` incidents. The
 * counts are always there, to say the difference in words instead.
 *
 * `services.top` names the busiest few, ties by name; `services.others`
 * sums the rest, so the two together are the whole period.
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

/** A period of whole UTC days, both included, as `YYYY-MM-DD`. */
export interface IncidentPeriod {
  from: string;
  to: string;
}

/** A page of a collection. `cursor` asks for the next page. */
export interface Page<T> {
  items: T[];
  page: { cursor: string | null; hasMore: boolean };
}

/**
 * What a notification tells its recipient. The API sends the type and the
 * data; the words are this client's (see describe-notification.ts).
 */
export type NotificationType =
  | "INCIDENT_DECLARED"
  | "INCIDENT_REASSIGNED"
  | "INCIDENT_SEVERITY_CHANGED"
  | "INCIDENT_RESOLVED"
  | "INCIDENT_READY_TO_RESOLVE"
  | "TEAM_MEMBERSHIP_ADDED"
  | "TEAM_MEMBERSHIP_REMOVED";

/**
 * One of the caller's notifications. Two kinds of state, apart:
 * `incident` is the incident as it stands now; `change` is what the
 * notification reports, as it was recorded at the time. Identity only — the
 * actor is a name — and no resolution note.
 */
export interface NotificationResponse {
  id: string;
  type: NotificationType;
  createdAt: string;
  /** Null while unread. */
  readAt: string | null;
  actor: { id: string; name: string };
  /** Set for INCIDENT_ types; null for TEAM_ types. */
  incident: {
    number: number;
    title: string;
    severity: IncidentSeverity;
    status: IncidentStatus;
    service: { name: string; slug: string };
  } | null;
  /**
   * DECLARED: to the severity it was declared at. SEVERITY_CHANGED: from one
   * severity to another. REASSIGNED: from one team's name to another's, as
   * they were then. Null for the others.
   */
  change: { from: string | null; to: string | null } | null;
  /** Set for TEAM_ types only. */
  team: { id: string; name: string } | null;
}

/** How many of the caller's notifications are unread. */
export interface NotificationUnreadCountResponse {
  count: number;
}

export type IncidentState = "active" | "resolved";

/**
 * One of a member's responses: an incident they started investigating, as
 * the lists give it, and where their own part of it stands. Only actual
 * participation — being on the incident's team is not a response.
 */
export interface MemberResponseResponse {
  incident: IncidentResponse;
  status: IncidentResponderStatus;
  startedAt: string;
  completedAt: string | null;
}

/**
 * What narrows either incident list, combined: one severity, one affected
 * service, one responsible team, and `q` — words from the title, or an
 * incident's number (`42`, `INC-42`). A service or team the organization
 * lacks matches nothing; it is not an error.
 */
/**
 * Where the response stands, as a list can be narrowed by it: `unclaimed`,
 * no one has started; `ready`, investigating, and no one still is.
 */
export type IncidentResponseFilter = "unclaimed" | "ready";

export interface IncidentFilters {
  severity?: IncidentSeverity;
  serviceId?: string;
  teamId?: string;
  response?: IncidentResponseFilter;
  q?: string;
}

/**
 * No status (every incident starts DECLARED) and no team (the service's
 * owner is responsible). Severity is required.
 */
export interface CreateIncidentRequest {
  title: string;
  summary?: string | null;
  serviceId: string;
  severity: IncidentSeverity;
}

/**
 * `status: "RESOLVED"` resolves an INVESTIGATING incident once no responder
 * is still investigating (409 RESPONDERS_STILL_INVESTIGATING otherwise), and
 * must carry a `resolution` note — which is refused on any other change. An
 * incident becomes INVESTIGATING only when a responder starts investigating.
 * The service never changes; the responsible team is reassigned, never
 * cleared.
 */
export interface UpdateIncidentRequest {
  title?: string;
  summary?: string | null;
  severity?: IncidentSeverity;
  status?: "RESOLVED";
  resolution?: string;
  teamId?: string;
}

/**
 * Permission names the UI checks. Names only: which role holds which is the
 * API's decision, and is never reproduced here.
 */
export const Permission = {
  ORGANIZATION_READ: "organization:read",
  ORGANIZATION_UPDATE: "organization:update",
  MEMBERSHIPS_READ: "memberships:read",
  MEMBERS_MANAGE: "members:manage",
  INVITATIONS_READ: "invitations:read",
  INVITATIONS_MANAGE: "invitations:manage",
  TEAMS_READ: "teams:read",
  TEAMS_MANAGE: "teams:manage",
  SERVICES_READ: "services:read",
  SERVICES_MANAGE: "services:manage",
  INCIDENTS_READ: "incidents:read",
  /**
   * Oversight of every incident in the organization. What the Overview and
   * Incident history are offered on: both read figures counted across every
   * incident, which the API answers only to a caller holding this.
   */
  INCIDENTS_READ_ALL: "incidents:read-all",
  INCIDENTS_MANAGE: "incidents:manage",
  INCIDENTS_RESPOND: "incidents:respond",
  INCIDENT_ANALYSES_WRITE: "incident-analyses:write",
  NOTIFICATIONS_READ: "notifications:read",
} as const;

/** Machine-readable error codes this client branches on. */
export const ApiErrorCode = {
  EMAIL_ALREADY_REGISTERED: "EMAIL_ALREADY_REGISTERED",
  ORGANIZATION_SLUG_TAKEN: "ORGANIZATION_SLUG_TAKEN",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  INVALID_REFRESH_TOKEN: "INVALID_REFRESH_TOKEN",
  REFRESH_TOKEN_EXPIRED: "REFRESH_TOKEN_EXPIRED",
  REFRESH_TOKEN_REUSED: "REFRESH_TOKEN_REUSED",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  INVALID_CURRENT_PASSWORD: "INVALID_CURRENT_PASSWORD",
  PASSWORD_UNCHANGED: "PASSWORD_UNCHANGED",
  PASSWORD_CHANGE_REQUIRED: "PASSWORD_CHANGE_REQUIRED",
  ORGANIZATION_NOT_FOUND: "ORGANIZATION_NOT_FOUND",
  MEMBERSHIP_NOT_FOUND: "MEMBERSHIP_NOT_FOUND",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  INVITATION_NOT_FOUND: "INVITATION_NOT_FOUND",
  INVITATION_NOT_PENDING: "INVITATION_NOT_PENDING",
  INVITATION_ALREADY_PENDING: "INVITATION_ALREADY_PENDING",
  INVITATION_EMAIL_MISMATCH: "INVITATION_EMAIL_MISMATCH",
  ALREADY_A_MEMBER: "ALREADY_A_MEMBER",
  TEAM_NOT_FOUND: "TEAM_NOT_FOUND",
  TEAM_NAME_TAKEN: "TEAM_NAME_TAKEN",
  TEAM_MEMBER_NOT_FOUND: "TEAM_MEMBER_NOT_FOUND",
  ALREADY_A_TEAM_MEMBER: "ALREADY_A_TEAM_MEMBER",
  TEAM_OWNS_SERVICES: "TEAM_OWNS_SERVICES",
  TEAM_HAS_INCIDENTS: "TEAM_HAS_INCIDENTS",
  SERVICE_NOT_FOUND: "SERVICE_NOT_FOUND",
  SERVICE_NAME_TAKEN: "SERVICE_NAME_TAKEN",
  SERVICE_HAS_INCIDENTS: "SERVICE_HAS_INCIDENTS",
  SERVICE_ARCHIVED: "SERVICE_ARCHIVED",
  INCIDENT_NOT_FOUND: "INCIDENT_NOT_FOUND",
  INCIDENT_RESOLVED: "INCIDENT_RESOLVED",
  INVALID_STATUS_TRANSITION: "INVALID_STATUS_TRANSITION",
  NOT_ON_RESPONSIBLE_TEAM: "NOT_ON_RESPONSIBLE_TEAM",
  START_INVESTIGATING_FIRST: "START_INVESTIGATING_FIRST",
  RESPONSE_ALREADY_COMPLETED: "RESPONSE_ALREADY_COMPLETED",
  NOT_INVESTIGATING: "NOT_INVESTIGATING",
  RESPONDERS_STILL_INVESTIGATING: "RESPONDERS_STILL_INVESTIGATING",
  NOTIFICATION_NOT_FOUND: "NOTIFICATION_NOT_FOUND",
  ANALYSIS_NOT_STARTED: "ANALYSIS_NOT_STARTED",
  INCIDENT_NOT_RESOLVED: "INCIDENT_NOT_RESOLVED",
  ANALYSIS_ALREADY_STARTED: "ANALYSIS_ALREADY_STARTED",
  NOT_ANALYSIS_OWNER: "NOT_ANALYSIS_OWNER",
  ANALYSIS_PUBLISHED: "ANALYSIS_PUBLISHED",
  ANALYSIS_CHANGED: "ANALYSIS_CHANGED",
  ANALYSIS_SUMMARY_REQUIRED: "ANALYSIS_SUMMARY_REQUIRED",
} as const;

export interface ValidationErrorDetail {
  field: string;
  message: string;
}
