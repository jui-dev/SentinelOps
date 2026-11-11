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

/**
 * The version a write was based on — the one the caller last read. The
 * write applies only if the analysis is still at it.
 */
const versionSchema = z.number().int().min(1).max(MAX_VERSION);

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

/** Some of the sections, by name, each at most once. */
const sectionNamesSchema = z
  .array(z.enum(ANALYSIS_SECTIONS))
  .max(ANALYSIS_SECTIONS.length)
  .refine(
    (names) => new Set(names).size === names.length,
    'Name each section once',
  );

/**
 * Editing a draft analysis: the text of the sections it names — a section
 * left out is unchanged — and which of them are finished: `markDone` says a
 * section is, `reopen` that it is not. Something must be named. `version`
 * is the version the edit was based on — the one the caller last read — and
 * the edit applies only if the analysis is still at it.
 */
export const editIncidentAnalysisSchema = z
  .strictObject({
    version: versionSchema,
    summary: analysisSectionSchema.optional(),
    impact: analysisSectionSchema.optional(),
    cause: analysisSectionSchema.optional(),
    lessons: analysisSectionSchema.optional(),
    markDone: sectionNamesSchema.optional(),
    reopen: sectionNamesSchema.optional(),
  })
  .refine(
    (body) =>
      ANALYSIS_SECTIONS.some((section) => body[section] !== undefined) ||
      (body.markDone?.length ?? 0) > 0 ||
      (body.reopen?.length ?? 0) > 0,
    'Provide a summary, impact, cause, or lessons to change, or a section to mark',
  )
  .refine(
    (body) => !body.markDone?.some((section) => body.reopen?.includes(section)),
    { message: 'A section cannot be both done and reopened', path: ['reopen'] },
  );

export type EditIncidentAnalysisRequest = z.infer<
  typeof editIncidentAnalysisSchema
>;

/**
 * Handing a draft analysis to another member of the admitted organization,
 * if it is still at `version`.
 */
export const reassignIncidentAnalysisOwnerSchema = z.strictObject({
  ownerMembershipId: resourceIdSchema,
  version: versionSchema,
});

export type ReassignIncidentAnalysisOwnerRequest = z.infer<
  typeof reassignIncidentAnalysisOwnerSchema
>;

/**
 * Publishing a draft analysis as it stands at `version`: the sections the
 * caller last read, as saved. Nothing else is said — a publication changes
 * no text.
 */
export const publishIncidentAnalysisSchema = z.strictObject({
  version: versionSchema,
});

export type PublishIncidentAnalysisRequest = z.infer<
  typeof publishIncidentAnalysisSchema
>;
