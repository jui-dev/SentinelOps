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

/** Three active statuses, which move freely, then RESOLVED — terminal. */
export type IncidentStatus =
  | "INVESTIGATING"
  | "IDENTIFIED"
  | "MONITORING"
  | "RESOLVED";

/**
 * One incident. `number` is the organization's own sequence, shown as
 * INC-{number} and used to address it. The responsible `team` is the
 * service's owner when the incident was declared, unless reassigned since.
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

/** A member assigned to an incident, by membership id. Never an email. */
export interface IncidentMemberResponse {
  membershipId: string;
  name: string;
}

/**
 * One incident with the people responding to it — what every single-incident
 * route returns. List items carry neither field.
 */
export interface IncidentDetailResponse extends IncidentResponse {
  lead: IncidentMemberResponse | null;
  responders: IncidentMemberResponse[];
}

/**
 * What a timeline entry records. UPDATE is posted by a member; the others the
 * server records with the change. Resolution is STATUS_CHANGED to RESOLVED.
 */
export type IncidentActivityType =
  | "DECLARED"
  | "UPDATE"
  | "SEVERITY_CHANGED"
  | "STATUS_CHANGED";

/**
 * One entry on an incident's timeline. `message` is set for UPDATE only;
 * `fromValue`/`toValue` are severities or statuses (DECLARED carries only the
 * declared severity in `toValue`). The actor is identity only.
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
  };
  period: {
    from: string;
    to: string;
    declared: number;
    declaredBySeverity: SeverityCounts;
    resolved: number;
    stillOpen: number;
    history: {
      total: number;
      items: IncidentHistoryItemResponse[];
    };
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

export type IncidentState = "active" | "resolved";

/**
 * No status (every incident starts INVESTIGATING) and no team (the service's
 * owner is responsible). Severity is required.
 */
export interface CreateIncidentRequest {
  title: string;
  summary?: string | null;
  serviceId: string;
  severity: IncidentSeverity;
}

/**
 * `status: "RESOLVED"` resolves. The service never changes. The lead is a
 * membership id, or null to clear it.
 */
export interface UpdateIncidentRequest {
  title?: string;
  summary?: string | null;
  severity?: IncidentSeverity;
  status?: IncidentStatus;
  teamId?: string;
  leadMembershipId?: string | null;
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
  INCIDENTS_MANAGE: "incidents:manage",
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
  ALREADY_A_RESPONDER: "ALREADY_A_RESPONDER",
  RESPONDER_NOT_FOUND: "RESPONDER_NOT_FOUND",
} as const;

export interface ValidationErrorDetail {
  field: string;
  message: string;
}
