import { z } from 'zod';

import {
  emailSchema,
  organizationNameSchema,
  passwordSchema,
  personNameSchema,
} from '../auth/auth.schemas.js';
import { Role } from '../generated/prisma/enums.js';

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

/**
 * Adding a person to the organization: who they are, the role they hold, and
 * a one-time password the admin hands them. The same rules as registration's
 * — a normalised email, a person's name, a password of at least 12 characters
 * — because this creates an account just as registration does.
 */
export const createMemberSchema = z.strictObject({
  name: personNameSchema,
  email: emailSchema,
  role: z.enum([Role.ADMIN, Role.MEMBER]),
  temporaryPassword: passwordSchema,
});

export type CreateMemberRequest = z.infer<typeof createMemberSchema>;
