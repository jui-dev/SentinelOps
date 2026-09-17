import { authenticatedRequest, sessionRequest } from "./client";
import type {
  AuthenticatedResponse,
  CurrentUserResponse,
  LoginRequest,
  OrganizationDetailResponse,
  OrganizationMembershipResponse,
  OrganizationResponse,
  RegisterRequest,
  UpdateOrganizationRequest,
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
