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
  };
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

/** Ownership moves; it is never cleared. */
export interface UpdateServiceRequest {
  name?: string;
  description?: string | null;
  ownerTeamId?: string;
  criticality?: ServiceCriticality;
}

/**
 * Permission names the UI checks. Names only: which role holds which is the
 * API's decision, and is never reproduced here.
 */
export const Permission = {
  ORGANIZATION_READ: "organization:read",
  ORGANIZATION_UPDATE: "organization:update",
  MEMBERSHIPS_READ: "memberships:read",
  INVITATIONS_READ: "invitations:read",
  INVITATIONS_MANAGE: "invitations:manage",
  TEAMS_READ: "teams:read",
  TEAMS_MANAGE: "teams:manage",
  SERVICES_READ: "services:read",
  SERVICES_MANAGE: "services:manage",
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
  SERVICE_NOT_FOUND: "SERVICE_NOT_FOUND",
  SERVICE_NAME_TAKEN: "SERVICE_NAME_TAKEN",
} as const;

export interface ValidationErrorDetail {
  field: string;
  message: string;
}
