import { z } from 'zod';

import { incidentSeveritySchema } from '../incidents/incidents.schemas.js';
import { resourceIdSchema } from '../tenancy/tenancy.schemas.js';

/**
 * Request schemas for known issues. Strict, like every tenant write: an
 * unknown key is a 400. A known issue's service is chosen when it is made and
 * never changes — its incidents are that service's.
 */

/** As long as an incident title may be: a new one is named by its title. */
export const knownIssueNameSchema = z.string().trim().min(1).max(200);

/**
 * Optional prose. Blank means none, stored as null; explicit null clears it.
 */
export const knownIssueDescriptionSchema = z
  .string()
  .trim()
  .max(2000)
  .transform((value) => (value === '' ? null : value))
  .nullable();

/**
 * The list: every service's, or one's. Archived ones only when asked, since
 * declaring never offers them.
 */
export const listKnownIssuesQuerySchema = z.strictObject({
  serviceId: resourceIdSchema.optional(),
  archived: z.enum(['include', 'exclude']).optional(),
});

export const createKnownIssueSchema = z.strictObject({
  serviceId: resourceIdSchema,
  name: knownIssueNameSchema,
  description: knownIssueDescriptionSchema.optional(),
  usualSeverity: incidentSeveritySchema,
});

/**
 * Renaming, describing, changing the usual severity, archiving (true) or
 * restoring (false). Any change counts as the Admin having looked at it, so
 * it is no longer pending review; `reviewed: true` says so with no other
 * change — keeping one saved while declaring as it is.
 */
export const updateKnownIssueSchema = z
  .strictObject({
    name: knownIssueNameSchema.optional(),
    description: knownIssueDescriptionSchema.optional(),
    usualSeverity: incidentSeveritySchema.optional(),
    archived: z.boolean().optional(),
    reviewed: z.literal(true).optional(),
  })
  .refine(
    (body) => Object.values(body).some((value) => value !== undefined),
    'Provide a name, description, usual severity, archived, or reviewed',
  );

/** Moves every incident of this known issue to `intoId`, then removes it. */
export const mergeKnownIssueSchema = z.strictObject({
  intoId: resourceIdSchema,
});

export type ListKnownIssuesQuery = z.infer<typeof listKnownIssuesQuerySchema>;
export type CreateKnownIssueRequest = z.infer<typeof createKnownIssueSchema>;
export type UpdateKnownIssueRequest = z.infer<typeof updateKnownIssueSchema>;
export type MergeKnownIssueRequest = z.infer<typeof mergeKnownIssueSchema>;
