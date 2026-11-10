import {
  authenticatedRequest,
  authenticatedSessionRequest,
  publicRequest,
  sessionRequest,
} from "./client";
import type {
  AuthenticatedResponse,
  ChangePasswordRequest,
  CreateInvitationRequest,
  CreateMemberRequest,
  CreateServiceRequest,
  CreateTeamRequest,
  CreatedInvitationResponse,
  CreateIncidentRequest,
  CurrentUserResponse,
  EditIncidentAnalysisRequest,
  IncidentActivityResponse,
  IncidentAnalysisResponse,
  IncidentAttentionResponse,
  IncidentPartsResponse,
  IncidentDetailResponse,
  IncidentFilters,
  IncidentOccurrenceResponse,
  IncidentPeriod,
  IncidentListItemResponse,
  IncidentState,
  MemberResponseResponse,
  NotificationResponse,
  NotificationUnreadCountResponse,
  IncidentFlowResponse,
  MemberActivityResponse,
  IncidentHistoryFilters,
  IncidentHistoryPage,
  IncidentSummaryResponse,
  InvitationLookupResponse,
  InvitationResponse,
  LoginRequest,
  MembershipResponse,
  OperationalActivityResponse,
  OrganizationDetailResponse,
  OrganizationMembershipResponse,
  OrganizationResponse,
  Page,
  PostIncidentUpdateRequest,
  PublishIncidentAnalysisRequest,
  ReassignIncidentAnalysisOwnerRequest,
  RegisterRequest,
  RegisterWithInvitationRequest,
  ServiceResponse,
  StartIncidentAnalysisRequest,
  TeamMemberResponse,
  TeamResponse,
  UpdateIncidentRequest,
  UpdateOrganizationRequest,
  UpdateServiceRequest,
  UpdateTeamRequest,
} from "./contracts";

/**
 * One function per endpoint. Which request kind each uses is its auth policy,
 * stated here and nowhere else. Refresh is not listed: only `lib/auth/refresh`
 * may call it.
 */

// Session endpoints: cookie in, cookie out, no bearer, no refresh on 401.

export const register = (body: RegisterRequest) =>
  sessionRequest<AuthenticatedResponse>("/auth/register", {
    method: "POST",
    body,
  });

export const login = (body: LoginRequest) =>
  sessionRequest<AuthenticatedResponse>("/auth/login", {
    method: "POST",
    body,
  });

export const registerWithInvitation = (body: RegisterWithInvitationRequest) =>
  sessionRequest<AuthenticatedResponse>("/auth/register/invitation", {
    method: "POST",
    body,
  });

export const logout = () =>
  sessionRequest<void>("/auth/logout", { method: "POST" });

// Authenticated endpoints: bearer token, one refresh-and-retry on 401.

export const getCurrentUser = () =>
  authenticatedRequest<CurrentUserResponse>("/auth/me");

/** Answers with a new session: the response replaces the refresh cookie. */
export const changePassword = (body: ChangePasswordRequest) =>
  authenticatedSessionRequest<AuthenticatedResponse>("/auth/password", {
    method: "POST",
    body,
  });

const organizationPath = (organizationId: string) =>
  `/organizations/${encodeURIComponent(organizationId)}`;

export const getOrganization = (organizationId: string) =>
  authenticatedRequest<OrganizationDetailResponse>(
    organizationPath(organizationId),
  );

export const updateOrganization = (
  organizationId: string,
  body: UpdateOrganizationRequest,
) =>
  authenticatedRequest<OrganizationResponse>(organizationPath(organizationId), {
    method: "PATCH",
    body,
  });

export const listMemberships = (organizationId: string) =>
  authenticatedRequest<OrganizationMembershipResponse[]>(
    `${organizationPath(organizationId)}/memberships`,
  );

/** One membership record, with the teams the member is on. */
export const getMembership = (organizationId: string, membershipId: string) =>
  authenticatedRequest<OrganizationMembershipResponse>(
    `${organizationPath(organizationId)}/memberships/${encodeURIComponent(membershipId)}`,
  );

/** Adds a person with a one-time password; answers with their membership. */
export const createMember = (
  organizationId: string,
  body: CreateMemberRequest,
) =>
  authenticatedRequest<OrganizationMembershipResponse>(
    `${organizationPath(organizationId)}/memberships`,
    { method: "POST", body },
  );

const invitationsPath = (organizationId: string) =>
  `${organizationPath(organizationId)}/invitations`;

export const listInvitations = (organizationId: string) =>
  authenticatedRequest<InvitationResponse[]>(invitationsPath(organizationId));

export const createInvitation = (
  organizationId: string,
  body: CreateInvitationRequest,
) =>
  authenticatedRequest<CreatedInvitationResponse>(
    invitationsPath(organizationId),
    { method: "POST", body },
  );

export const revokeInvitation = (
  organizationId: string,
  invitationId: string,
) =>
  authenticatedRequest<void>(
    `${invitationsPath(organizationId)}/${encodeURIComponent(invitationId)}`,
    { method: "DELETE" },
  );

const teamsPath = (organizationId: string) =>
  `${organizationPath(organizationId)}/teams`;

const teamPath = (organizationId: string, teamId: string) =>
  `${teamsPath(organizationId)}/${encodeURIComponent(teamId)}`;

export const listTeams = (organizationId: string) =>
  authenticatedRequest<TeamResponse[]>(teamsPath(organizationId));

export const createTeam = (organizationId: string, body: CreateTeamRequest) =>
  authenticatedRequest<TeamResponse>(teamsPath(organizationId), {
    method: "POST",
    body,
  });

export const updateTeam = (
  organizationId: string,
  teamId: string,
  body: UpdateTeamRequest,
) =>
  authenticatedRequest<TeamResponse>(teamPath(organizationId, teamId), {
    method: "PATCH",
    body,
  });

export const deleteTeam = (organizationId: string, teamId: string) =>
  authenticatedRequest<void>(teamPath(organizationId, teamId), {
    method: "DELETE",
  });

export const listTeamMembers = (organizationId: string, teamId: string) =>
  authenticatedRequest<TeamMemberResponse[]>(
    `${teamPath(organizationId, teamId)}/members`,
  );

export const addTeamMember = (
  organizationId: string,
  teamId: string,
  membershipId: string,
) =>
  authenticatedRequest<TeamMemberResponse>(
    `${teamPath(organizationId, teamId)}/members`,
    { method: "POST", body: { membershipId } },
  );

export const removeTeamMember = (
  organizationId: string,
  teamId: string,
  membershipId: string,
) =>
  authenticatedRequest<void>(
    `${teamPath(organizationId, teamId)}/members/${encodeURIComponent(membershipId)}`,
    { method: "DELETE" },
  );

const servicesPath = (organizationId: string) =>
  `${organizationPath(organizationId)}/services`;

const servicePath = (organizationId: string, serviceId: string) =>
  `${servicesPath(organizationId)}/${encodeURIComponent(serviceId)}`;

export const listServices = (organizationId: string) =>
  authenticatedRequest<ServiceResponse[]>(servicesPath(organizationId));

export const createService = (
  organizationId: string,
  body: CreateServiceRequest,
) =>
  authenticatedRequest<ServiceResponse>(servicesPath(organizationId), {
    method: "POST",
    body,
  });

export const updateService = (
  organizationId: string,
  serviceId: string,
  body: UpdateServiceRequest,
) =>
  authenticatedRequest<ServiceResponse>(servicePath(organizationId, serviceId), {
    method: "PATCH",
    body,
  });

export const deleteService = (organizationId: string, serviceId: string) =>
  authenticatedRequest<void>(servicePath(organizationId, serviceId), {
    method: "DELETE",
  });

const incidentsPath = (organizationId: string) =>
  `${organizationPath(organizationId)}/incidents`;

const incidentPath = (organizationId: string, number: number) =>
  `${incidentsPath(organizationId)}/${number}`;

/**
 * One page of a state's incidents, optionally narrowed to a period — by
 * when an active incident was declared, and when a resolved one was
 * resolved, as the API defines it.
 */
export const listIncidents = (
  organizationId: string,
  state: IncidentState,
  cursor?: string,
  period?: IncidentPeriod,
  filters: IncidentFilters = {},
) => {
  const query = new URLSearchParams({ state });

  if (period) {
    query.set("from", period.from);
    query.set("to", period.to);
  }
  if (filters.severity) query.set("severity", filters.severity);
  if (filters.serviceId) query.set("serviceId", filters.serviceId);
  if (filters.teamId) query.set("teamId", filters.teamId);
  if (filters.response) query.set("response", filters.response);
  if (filters.part) query.set("part", filters.part);
  if (filters.q) query.set("q", filters.q);
  // Last, so a page request reads as the list's own query plus where it starts.
  if (cursor) query.set("cursor", cursor);

  return authenticatedRequest<Page<IncidentListItemResponse>>(
    `${incidentsPath(organizationId)}?${query}`,
  );
};

/**
 * One page of everything declared or resolved in `period`, most recent
 * first, narrowed by `filters`.
 */
export const listIncidentHistory = (
  organizationId: string,
  { from, to }: IncidentPeriod,
  cursor?: string,
  filters: IncidentHistoryFilters = {},
) => {
  const query = new URLSearchParams({ from, to });

  if (filters.severity) query.set("severity", filters.severity);
  if (filters.show) query.set("show", filters.show);
  if (filters.q) query.set("q", filters.q);
  if (cursor) query.set("cursor", cursor);

  return authenticatedRequest<IncidentHistoryPage>(
    `${incidentsPath(organizationId)}/history?${query}`,
  );
};

/** One member's response activity on each day of `period`. */
export const getMemberActivity = (
  organizationId: string,
  membershipId: string,
  { from, to }: IncidentPeriod,
) =>
  authenticatedRequest<MemberActivityResponse>(
    `${organizationPath(organizationId)}/memberships/${encodeURIComponent(membershipId)}/activity?${new URLSearchParams({ from, to })}`,
  );

/** How teams' incidents ran over the last `days` whole UTC days. */
export const getIncidentFlow = (organizationId: string, days: 7 | 14) =>
  authenticatedRequest<IncidentFlowResponse>(
    `${incidentsPath(organizationId)}/flow?${new URLSearchParams({ days: String(days) })}`,
  );

/** Incidents active now, and those declared and resolved in `period`. */
export const getIncidentSummary = (
  organizationId: string,
  { from, to }: IncidentPeriod,
) =>
  authenticatedRequest<IncidentSummaryResponse>(
    `${incidentsPath(organizationId)}/summary?${new URLSearchParams({ from, to })}`,
  );

/** How much happened on each day of `period`, and to which incidents. */
export const getIncidentActivity = (
  organizationId: string,
  { from, to }: IncidentPeriod,
) =>
  authenticatedRequest<OperationalActivityResponse>(
    `${incidentsPath(organizationId)}/activity?${new URLSearchParams({ from, to })}`,
  );

/**
 * How often incidents were declared in `period`, day by day and by service,
 * against the same elapsed time before it.
 */
export const getIncidentOccurrence = (
  organizationId: string,
  { from, to }: IncidentPeriod,
) =>
  authenticatedRequest<IncidentOccurrenceResponse>(
    `${incidentsPath(organizationId)}/occurrence?${new URLSearchParams({ from, to })}`,
  );

/** The active incidents waiting on the caller now, by what they may do. */
export const getIncidentAttention = (organizationId: string) =>
  authenticatedRequest<IncidentAttentionResponse>(
    `${incidentsPath(organizationId)}/attention`,
  );

/** The caller's active incidents counted by their own part in each. */
export const getIncidentParts = (organizationId: string) =>
  authenticatedRequest<IncidentPartsResponse>(
    `${incidentsPath(organizationId)}/parts`,
  );

export const getIncident = (organizationId: string, number: number) =>
  authenticatedRequest<IncidentDetailResponse>(
    incidentPath(organizationId, number),
  );

export const createIncident = (
  organizationId: string,
  body: CreateIncidentRequest,
) =>
  authenticatedRequest<IncidentDetailResponse>(incidentsPath(organizationId), {
    method: "POST",
    body,
  });

export const updateIncident = (
  organizationId: string,
  number: number,
  body: UpdateIncidentRequest,
) =>
  authenticatedRequest<IncidentDetailResponse>(
    incidentPath(organizationId, number),
    { method: "PATCH", body },
  );

/**
 * The caller starts investigating the incident — only on its responsible
 * team. Starting again while investigating changes nothing.
 */
export const startIncidentResponse = (organizationId: string, number: number) =>
  authenticatedRequest<IncidentDetailResponse>(
    `${incidentPath(organizationId, number)}/responders/me`,
    { method: "POST" },
  );

/** The caller marks their own response complete. It resolves nothing. */
export const completeIncidentResponse = (
  organizationId: string,
  number: number,
) =>
  authenticatedRequest<IncidentDetailResponse>(
    `${incidentPath(organizationId, number)}/responders/me/complete`,
    { method: "POST" },
  );

/**
 * One page of a member's responses, the most recently started first. The
 * cursor is the API's, from the page before.
 */
export const listMemberResponses = (
  organizationId: string,
  membershipId: string,
  cursor?: string,
) =>
  authenticatedRequest<Page<MemberResponseResponse>>(
    `${organizationPath(organizationId)}/memberships/${encodeURIComponent(membershipId)}/responses${
      cursor ? `?${new URLSearchParams({ cursor })}` : ""
    }`,
  );

/** The incident's timeline, oldest first. Unpaged. */
export const getIncidentTimeline = (organizationId: string, number: number) =>
  authenticatedRequest<IncidentActivityResponse[]>(
    `${incidentPath(organizationId, number)}/timeline`,
  );

export const postIncidentUpdate = (
  organizationId: string,
  number: number,
  body: PostIncidentUpdateRequest,
) =>
  authenticatedRequest<IncidentActivityResponse>(
    `${incidentPath(organizationId, number)}/updates`,
    { method: "POST", body },
  );

const analysisPath = (organizationId: string, number: number) =>
  `${incidentPath(organizationId, number)}/analysis`;

/**
 * The incident's analysis. 404 ANALYSIS_NOT_STARTED when it has none — an
 * ordinary answer, given only once the incident itself has been found.
 */
export const getIncidentAnalysis = (organizationId: string, number: number) =>
  authenticatedRequest<IncidentAnalysisResponse>(
    analysisPath(organizationId, number),
  );

/** Starts a resolved incident's analysis, as a draft. */
export const startIncidentAnalysis = (
  organizationId: string,
  number: number,
  body?: StartIncidentAnalysisRequest,
) =>
  authenticatedRequest<IncidentAnalysisResponse>(
    analysisPath(organizationId, number),
    { method: "POST", body },
  );

/** Edits the named sections of a draft, if it is still at `version`. */
export const editIncidentAnalysis = (
  organizationId: string,
  number: number,
  body: EditIncidentAnalysisRequest,
) =>
  authenticatedRequest<IncidentAnalysisResponse>(
    analysisPath(organizationId, number),
    { method: "PATCH", body },
  );

/** Hands a draft to another member, if it is still at `version`. */
export const reassignIncidentAnalysisOwner = (
  organizationId: string,
  number: number,
  body: ReassignIncidentAnalysisOwnerRequest,
) =>
  authenticatedRequest<IncidentAnalysisResponse>(
    `${analysisPath(organizationId, number)}/owner`,
    { method: "PUT", body },
  );

/** Publishes a draft exactly as it stands at `version`. */
export const publishIncidentAnalysis = (
  organizationId: string,
  number: number,
  body: PublishIncidentAnalysisRequest,
) =>
  authenticatedRequest<IncidentAnalysisResponse>(
    `${analysisPath(organizationId, number)}/publish`,
    { method: "POST", body },
  );

const notificationsPath = (organizationId: string) =>
  `${organizationPath(organizationId)}/notifications`;

/**
 * One page of the caller's notifications in the organization, newest first.
 * Only ever the caller's own: the API takes the recipient from the session.
 */
export const listNotifications = (organizationId: string, cursor?: string) =>
  authenticatedRequest<Page<NotificationResponse>>(
    `${notificationsPath(organizationId)}${
      cursor ? `?${new URLSearchParams({ cursor })}` : ""
    }`,
  );

export const getUnreadNotificationCount = (organizationId: string) =>
  authenticatedRequest<NotificationUnreadCountResponse>(
    `${notificationsPath(organizationId)}/unread-count`,
  );

/** Acknowledges one notification. Again changes nothing: the first time stands. */
export const markNotificationRead = (
  organizationId: string,
  notificationId: string,
) =>
  authenticatedRequest<NotificationResponse>(
    `${notificationsPath(organizationId)}/${encodeURIComponent(notificationId)}/read`,
    { method: "POST" },
  );

/**
 * Acknowledges every notification up to and including `through`, the newest
 * the caller has seen; anything newer stays unread. Answers with the unread
 * count left.
 */
export const markNotificationsReadThrough = (
  organizationId: string,
  through: string,
) =>
  authenticatedRequest<NotificationUnreadCountResponse>(
    `${notificationsPath(organizationId)}/read`,
    { method: "POST", body: { through } },
  );

// Invitation tokens always travel in a request body: never in a path or a
// query string, which servers log.

export const acceptInvitation = (token: string) =>
  authenticatedRequest<MembershipResponse>("/invitations/accept", {
    method: "POST",
    body: { token },
  });

// Public endpoint: no cookie, no bearer, works signed out.

export const lookupInvitation = (token: string, signal?: AbortSignal) =>
  publicRequest<InvitationLookupResponse>("/invitations/lookup", {
    method: "POST",
    body: { token },
    signal,
  });
