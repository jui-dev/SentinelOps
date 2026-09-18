import { z } from 'zod';

import { resourceIdSchema } from '../tenancy/tenancy.schemas.js';

/**
 * Request schemas for services. Strict, like every tenant write: an unknown
 * key is a 400, so `organizationId`, `slug`, or `id` cannot ride along. The
 * slug in particular is never accepted — it is derived from the name when the
 * service is created and never changes.
 */

export const serviceNameSchema = z.string().trim().min(1).max(100);

/**
 * Optional prose. Blank means none: an empty or whitespace-only value is
 * stored as null, so there is one way to say "no description". Explicit null
 * clears it.
 */
export const serviceDescriptionSchema = z
  .string()
  .trim()
  .max(500)
  .transform((value) => (value === '' ? null : value))
  .nullable();

/** The four levels, spelled as the database enum spells them. */
export const serviceCriticalitySchema = z.enum([
  'CRITICAL',
  'HIGH',
  'NORMAL',
  'LOW',
]);

/**
 * The owning team, named by id. Malformed is a 400 here, unlike in a path: a
 * body field that is not a uuid is a malformed request, not a lookup.
 */
export const ownerTeamIdSchema = resourceIdSchema;

/** Every service has an owner; criticality defaults to NORMAL when omitted. */
export const createServiceSchema = z.strictObject({
  name: serviceNameSchema,
  description: serviceDescriptionSchema.optional(),
  ownerTeamId: ownerTeamIdSchema,
  criticality: serviceCriticalitySchema.optional(),
});

/**
 * Ownership cannot be cleared, only moved: `ownerTeamId` is never null.
 *
 * `archived` retires the service (true) or returns it to use (false). The
 * client says which state it wants; the server records when. The timestamp
 * itself is never accepted.
 */
export const updateServiceSchema = z
  .strictObject({
    name: serviceNameSchema.optional(),
    description: serviceDescriptionSchema.optional(),
    ownerTeamId: ownerTeamIdSchema.optional(),
    criticality: serviceCriticalitySchema.optional(),
    archived: z.boolean().optional(),
  })
  .refine(
    (body) =>
      body.name !== undefined ||
      body.description !== undefined ||
      body.ownerTeamId !== undefined ||
      body.criticality !== undefined ||
      body.archived !== undefined,
    'Provide a name, description, owner team, criticality, or archived state to change',
  );

export type CreateServiceRequest = z.infer<typeof createServiceSchema>;
export type UpdateServiceRequest = z.infer<typeof updateServiceSchema>;
