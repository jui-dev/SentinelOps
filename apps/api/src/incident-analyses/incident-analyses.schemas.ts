import { z } from 'zod';

import { resourceIdSchema } from '../tenancy/tenancy.schemas.js';

/**
 * Request schemas for incident analyses. Bodies are strict, like every tenant
 * write: an unknown key is a 400, so `organizationId`, `incidentId`,
 * `status`, or `createdById` cannot ride along. Who started an analysis comes
 * from the admitted membership, and the incident from the path — never from
 * a body.
 */

/**
 * Starting an incident's analysis. The owner is a membership of the admitted
 * organization, and is the caller when none is named. The body itself may
 * be absent: starting one's own analysis needs nothing said.
 */
export const startIncidentAnalysisSchema = z
  .strictObject({
    ownerMembershipId: resourceIdSchema.optional(),
  })
  .optional();

export type StartIncidentAnalysisRequest = z.infer<
  typeof startIncidentAnalysisSchema
>;

/** The largest value a Postgres `integer` column holds. */
const MAX_VERSION = 2_147_483_647;

/** The written sections, each of which an edit may name. */
export const ANALYSIS_SECTIONS = [
  'summary',
  'impact',
  'cause',
  'lessons',
] as const;

export type AnalysisSection = (typeof ANALYSIS_SECTIONS)[number];

/**
 * One written section. Blank means not written: an empty or whitespace-only
 * value is stored as null. Explicit null clears it.
 */
export const analysisSectionSchema = z
  .string()
  .trim()
  .max(4000)
  .transform((value) => (value === '' ? null : value))
  .nullable();

/**
 * Editing a draft analysis's sections. A section left out is unchanged; at
 * least one must be named. `version` is the version the edit was based on —
 * the one the caller last read — and the edit applies only if the analysis
 * is still at it.
 */
export const editIncidentAnalysisSchema = z
  .strictObject({
    version: z.number().int().min(1).max(MAX_VERSION),
    summary: analysisSectionSchema.optional(),
    impact: analysisSectionSchema.optional(),
    cause: analysisSectionSchema.optional(),
    lessons: analysisSectionSchema.optional(),
  })
  .refine(
    (body) => ANALYSIS_SECTIONS.some((section) => body[section] !== undefined),
    'Provide a summary, impact, cause, or lessons to change',
  );

export type EditIncidentAnalysisRequest = z.infer<
  typeof editIncidentAnalysisSchema
>;
