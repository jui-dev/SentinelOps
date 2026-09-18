import { z } from 'zod';

import { resourceIdSchema } from '../tenancy/tenancy.schemas.js';

/**
 * Request schemas for teams. Strict, like every tenant write: an unknown key
 * is a 400, so `organizationId`, `slug`, or `id` cannot ride along. The slug in
 * particular is never accepted — it is derived from the name when the team is
 * created and never changes.
 */

export const teamNameSchema = z.string().trim().min(1).max(100);

/**
 * Optional prose. Blank means none: an empty or whitespace-only value is
 * stored as null, so there is one way to say "no description". Explicit null
 * clears it.
 */
export const teamDescriptionSchema = z
  .string()
  .trim()
  .max(500)
  .transform((value) => (value === '' ? null : value))
  .nullable();

export const createTeamSchema = z.strictObject({
  name: teamNameSchema,
  description: teamDescriptionSchema.optional(),
});

export const updateTeamSchema = z
  .strictObject({
    name: teamNameSchema.optional(),
    description: teamDescriptionSchema.optional(),
  })
  .refine(
    (body) => body.name !== undefined || body.description !== undefined,
    'Provide a name or a description to change',
  );

/**
 * Adds an existing organization member to a team, named by their membership
 * id — the id `GET /memberships` lists. Malformed is a 400 here, unlike in a
 * path: a body field that is not a uuid is a malformed request, not a lookup.
 */
export const addTeamMemberSchema = z.strictObject({
  membershipId: resourceIdSchema,
});

export type CreateTeamRequest = z.infer<typeof createTeamSchema>;
export type UpdateTeamRequest = z.infer<typeof updateTeamSchema>;
export type AddTeamMemberRequest = z.infer<typeof addTeamMemberSchema>;
