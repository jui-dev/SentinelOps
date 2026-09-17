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

/**
 * Permission names the UI checks. Names only: which role holds which is the
 * API's decision, and is never reproduced here.
 */
export const Permission = {
  ORGANIZATION_READ: "organization:read",
  ORGANIZATION_UPDATE: "organization:update",
  MEMBERSHIPS_READ: "memberships:read",
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
} as const;

export interface ValidationErrorDetail {
  field: string;
  message: string;
}
