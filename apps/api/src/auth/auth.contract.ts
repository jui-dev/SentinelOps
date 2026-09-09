/**
 * The wire contract for authentication, and the shapes that cross the boundary
 * between the guard and a handler.
 *
 * Response types live here rather than being inferred from Prisma models on
 * purpose: an inferred type grows a field every time a migration adds a column,
 * and the first time that column is a secret the leak is already shipped. These
 * are declared, and `auth.responses.ts` builds them field by field.
 */

/**
 * The verified claims of an access token.
 *
 * Identity only. No email, which would go stale the moment one is changed; no
 * organization or role, because membership is resolved per request so that
 * revoking one takes effect immediately rather than at the next expiry.
 */
export interface AccessTokenPayload {
  /** The user's id. `sub` rather than `userId`, as RFC 7519 names it. */
  sub: string;
  iss: string;
  iat: number;
  exp: number;
}

/** A user, as any authenticated response renders one. */
export interface UserResponse {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

/** An organization, as any authenticated response renders one. */
export interface OrganizationResponse {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

/** One membership, with the organization it grants access to. */
export interface MembershipResponse {
  id: string;
  role: string;
  organization: OrganizationResponse;
}

/**
 * What register and login return.
 *
 * The refresh token is deliberately absent: it travels in a Set-Cookie header
 * and reaches no JavaScript, no log, and no response body.
 */
export interface AuthenticatedResponse {
  accessToken: string;
  /** Access token lifetime in seconds, so a client can schedule a refresh. */
  expiresIn: number;
  tokenType: 'Bearer';
  user: UserResponse;
}

/** What refresh returns: a new access token, nothing about identity. */
export interface RefreshedResponse {
  accessToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

/** What `GET /auth/me` returns. */
export interface CurrentUserResponse extends UserResponse {
  memberships: MembershipResponse[];
}
