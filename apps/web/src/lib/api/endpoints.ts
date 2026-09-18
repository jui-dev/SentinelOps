import { authenticatedRequest, publicRequest, sessionRequest } from "./client";
import type {
  AuthenticatedResponse,
  CreateInvitationRequest,
  CreateServiceRequest,
  CreateTeamRequest,
  CreatedInvitationResponse,
  CreateIncidentRequest,
  CurrentUserResponse,
  IncidentResponse,
  IncidentState,
  InvitationLookupResponse,
  InvitationResponse,
  LoginRequest,
  MembershipResponse,
  OrganizationDetailResponse,
  OrganizationMembershipResponse,
  OrganizationResponse,
  Page,
  RegisterRequest,
  RegisterWithInvitationRequest,
  ServiceResponse,
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

export const listIncidents = (
  organizationId: string,
  state: IncidentState,
  cursor?: string,
) => {
  const query = new URLSearchParams({ state });

  if (cursor) query.set("cursor", cursor);

  return authenticatedRequest<Page<IncidentResponse>>(
    `${incidentsPath(organizationId)}?${query}`,
  );
};

export const getIncident = (organizationId: string, number: number) =>
  authenticatedRequest<IncidentResponse>(incidentPath(organizationId, number));

export const createIncident = (
  organizationId: string,
  body: CreateIncidentRequest,
) =>
  authenticatedRequest<IncidentResponse>(incidentsPath(organizationId), {
    method: "POST",
    body,
  });

export const updateIncident = (
  organizationId: string,
  number: number,
  body: UpdateIncidentRequest,
) =>
  authenticatedRequest<IncidentResponse>(incidentPath(organizationId, number), {
    method: "PATCH",
    body,
  });

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
