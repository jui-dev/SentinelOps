import { z } from 'zod';

import { organizationNameSchema } from '../auth/auth.schemas.js';

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
