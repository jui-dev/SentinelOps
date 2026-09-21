import { z } from 'zod';

import { resourceIdSchema } from '../tenancy/tenancy.schemas.js';

/**
 * Request schemas for notifications. There is no recipient anywhere in them:
 * whose notifications these are is the admitted membership, never input.
 */

/**
 * A page of the caller's notifications: only the cursor, which is opaque
 * here and decoded by the service. The page size is not a client parameter.
 */
export const listNotificationsQuerySchema = z.object({
  cursor: z.string().min(1).max(100).optional(),
});

/**
 * Acknowledges everything up to and including the newest notification the
 * caller has actually seen, named by its id. A bound rather than "all", so a
 * notification that arrives while they read is not acknowledged unseen.
 * Strict, like every write: an unknown key is a 400.
 */
export const markNotificationsReadSchema = z.strictObject({
  through: resourceIdSchema,
});

export type ListNotificationsQuery = z.infer<
  typeof listNotificationsQuerySchema
>;
export type MarkNotificationsReadRequest = z.infer<
  typeof markNotificationsReadSchema
>;
