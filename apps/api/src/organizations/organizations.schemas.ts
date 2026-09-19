import { z } from 'zod';

import {
  emailSchema,
  organizationNameSchema,
  passwordSchema,
  personNameSchema,
} from '../auth/auth.schemas.js';
import { resourceIdSchema } from '../tenancy/tenancy.schemas.js';

/**
 * Request schemas for organization-scoped writes.
 *
 * Strict, unlike the auth schemas: an unknown key is a 400 rather than
 * silently dropped. A tenant write body is where a client might try to set
 * what it has no business setting — `slug`, `role`, `organizationId`,
 * `deletedAt` — and refusing loudly makes that attempt visible instead of
 * leaving the caller to wonder why it had no effect. The organization a write
 * applies to is the one in the path, never a body field.
 */
export const updateOrganizationSchema = z.strictObject({
  name: organizationNameSchema,
});

export type UpdateOrganizationRequest = z.infer<
  typeof updateOrganizationSchema
>;

/** The most teams a member can be placed on in the request that adds them. */
export const MAX_INITIAL_TEAMS = 50;

/**
 * Teams to place a new member on. Optional, and empty is the same as absent:
 * a member may exist before they have any operational responsibility.
 *
 * Normalised to lowercase and de-duplicated here, so naming a team twice —
 * even in different letter case, which Postgres reads as the same uuid — asks
 * for one placement, never a duplicate. Whether each team exists in this
 * organization is the service's question.
 */
export const initialTeamIdsSchema = z
  .array(resourceIdSchema)
  .max(MAX_INITIAL_TEAMS)
  .transform((ids) => [...new Set(ids.map((id) => id.toLowerCase()))]);

/**
 * Adding a person to the organization: who they are, a one-time password the
 * Admin hands them, and optionally the teams they start on. The same rules as
 * registration's — a normalised email, a person's name, a password of at least
 * 12 characters — because this creates an account just as registration does.
 *
 * No role. Everyone the Admin adds is a MEMBER; the organization's one Admin
 * is whoever created it. Strict, so a body that tries to name a role is
 * refused rather than silently ignored.
 */
export const createMemberSchema = z.strictObject({
  name: personNameSchema,
  email: emailSchema,
  temporaryPassword: passwordSchema,
  teamIds: initialTeamIdsSchema.optional(),
});

export type CreateMemberRequest = z.infer<typeof createMemberSchema>;
