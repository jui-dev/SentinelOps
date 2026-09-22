import { z } from 'zod';

import { resourceIdSchema } from '../tenancy/tenancy.schemas.js';

/**
 * Request schemas for incident analyses. Bodies are strict, like every tenant
 * write: an unknown key is a 400, so `organizationId`, `incidentId`,
 * `status`, `version`, or `createdById` cannot ride along. Who started an
 * analysis comes from the admitted membership, and the incident from the
 * path — never from a body.
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
