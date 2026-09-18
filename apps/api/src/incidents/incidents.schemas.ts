import { z } from 'zod';

import { resourceIdSchema } from '../tenancy/tenancy.schemas.js';

/**
 * Request schemas for incidents. Bodies are strict, like every tenant write:
 * an unknown key is a 400, so `organizationId`, `number`, `createdById`,
 * `resolvedAt`, or `id` cannot ride along. Who declared an incident comes
 * from the admitted membership, its number from the organization's counter,
 * and its resolution time from the server — never from a client.
 */

export const incidentTitleSchema = z.string().trim().min(1).max(200);

/**
 * Optional prose. Blank means none: an empty or whitespace-only value is
 * stored as null. Explicit null clears it.
 */
export const incidentSummarySchema = z
  .string()
  .trim()
  .max(2000)
  .transform((value) => (value === '' ? null : value))
  .nullable();

/** The four levels, spelled as the database enum spells them. */
export const incidentSeveritySchema = z.enum(['SEV1', 'SEV2', 'SEV3', 'SEV4']);

export const incidentStatusSchema = z.enum([
  'INVESTIGATING',
  'IDENTIFIED',
  'MONITORING',
  'RESOLVED',
]);

/**
 * Declaring an incident. No status — every incident starts INVESTIGATING —
 * and no team: the responsible team is the service's owner at the moment of
 * declaration, and is reassigned explicitly afterwards if needed. Severity
 * has no default: declaring one is a judgement the declarer makes.
 */
export const createIncidentSchema = z.strictObject({
  title: incidentTitleSchema,
  summary: incidentSummarySchema.optional(),
  serviceId: resourceIdSchema,
  severity: incidentSeveritySchema,
});

/**
 * Changing an active incident. `status: 'RESOLVED'` resolves it. The service
 * cannot be changed; the responsible team can be reassigned, never cleared.
 * The lead is a membership id, or null to clear it.
 */
export const updateIncidentSchema = z
  .strictObject({
    title: incidentTitleSchema.optional(),
    summary: incidentSummarySchema.optional(),
    severity: incidentSeveritySchema.optional(),
    status: incidentStatusSchema.optional(),
    teamId: resourceIdSchema.optional(),
    leadMembershipId: resourceIdSchema.nullable().optional(),
  })
  .refine(
    (body) =>
      body.title !== undefined ||
      body.summary !== undefined ||
      body.severity !== undefined ||
      body.status !== undefined ||
      body.teamId !== undefined ||
      body.leadMembershipId !== undefined,
    'Provide a title, summary, severity, status, team, or lead to change',
  );

/** Adding a responder: any member of the organization, by membership id. */
export const addResponderSchema = z.strictObject({
  membershipId: resourceIdSchema,
});

/**
 * Which incidents to list. `state` is required: active and resolved
 * incidents are different questions, ordered differently. The cursor is
 * opaque here and decoded by the service, which knows each state's shape.
 */
export const listIncidentsQuerySchema = z.object({
  state: z.enum(['active', 'resolved']),
  cursor: z.string().min(1).max(64).optional(),
});

export type CreateIncidentRequest = z.infer<typeof createIncidentSchema>;
export type UpdateIncidentRequest = z.infer<typeof updateIncidentSchema>;
export type AddResponderRequest = z.infer<typeof addResponderSchema>;
export type ListIncidentsQuery = z.infer<typeof listIncidentsQuerySchema>;

/** The largest value a Postgres `integer` column holds. */
const MAX_INCIDENT_NUMBER = 2_147_483_647;

/**
 * An incident number from a URL, or undefined when the segment cannot be
 * one. Checked before a query, as isResourceId is for ids: Postgres would
 * refuse an out-of-range integer with a 500 where the honest answer is that
 * no such incident exists. Digits only — no sign, exponent, or leading zero.
 */
export const parseIncidentNumber = (value: string): number | undefined => {
  if (!/^[1-9][0-9]{0,9}$/.test(value)) {
    return undefined;
  }

  const number = Number(value);

  return number <= MAX_INCIDENT_NUMBER ? number : undefined;
};
