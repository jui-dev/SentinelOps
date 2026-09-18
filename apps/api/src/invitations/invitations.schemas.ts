import { z } from 'zod';

import {
  emailSchema,
  passwordSchema,
  personNameSchema,
} from '../auth/auth.schemas.js';
import { Role } from '../generated/prisma/enums.js';

/**
 * Request schemas for invitations. Strict, like every tenant write: an unknown
 * key is a 400, so `organizationId`, `invitedById`, or `expiresAt` cannot ride
 * along.
 */

/**
 * The roles an invitation may offer. OWNER is not among them: ownership is
 * a consequence of creating an organization, and transferring it arrives with
 * the rules that govern it.
 */
export const invitableRoleSchema = z.enum([Role.ADMIN, Role.MEMBER]);

/**
 * A presented invitation token. Opaque, so the only rule is a bound on what the
 * API is asked to hash: minted tokens are 43 characters.
 */
export const invitationTokenSchema = z.string().min(1).max(128);

export const createInvitationSchema = z.strictObject({
  email: emailSchema,
  role: invitableRoleSchema,
});

/**
 * The body of the token routes. The token travels in a body rather than a path
 * or query string because paths are written to the access log.
 */
export const invitationTokenRequestSchema = z.strictObject({
  token: invitationTokenSchema,
});

/**
 * `POST /auth/register/invitation`: an account created by accepting an
 * invitation.
 *
 * No email field, and strict, so one cannot be supplied: the account's address
 * is the one the invitation was issued to. No organization fields either — the
 * account joins the inviting organization instead of creating one.
 *
 * Declared here rather than in auth.schemas.ts, which this file already
 * imports from, so the two modules do not import each other.
 */
export const registerWithInvitationSchema = z.strictObject({
  token: invitationTokenSchema,
  name: personNameSchema,
  password: passwordSchema,
});

export type CreateInvitationRequest = z.infer<typeof createInvitationSchema>;
export type RegisterWithInvitationRequest = z.infer<
  typeof registerWithInvitationSchema
>;
export type InvitationTokenRequest = z.infer<
  typeof invitationTokenRequestSchema
>;
