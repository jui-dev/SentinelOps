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

/**
 * The status a change can move an incident to: RESOLVED, and nothing else.
 * An incident is DECLARED only by being declared, and becomes INVESTIGATING
 * only when a responder starts investigating it. Whether resolving is allowed
 * from where the incident stands is the service's judgement, which needs the
 * current status and its responders.
 */
export const incidentStatusTargetSchema = z.enum(['RESOLVED']);

/**
 * Declaring an incident. No status — every incident starts DECLARED —
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
 * How an incident ended, in a few sentences: what fixed it, or why it no
 * longer needs a response. Required by every resolution, and never blank.
 */
export const incidentResolutionSchema = z.string().trim().min(1).max(2000);

/**
 * Changing an active incident. `status: 'RESOLVED'` resolves an
 * INVESTIGATING one, and must say how it ended in `resolution` — which is
 * refused on any other change, since only a resolution records one. The
 * service cannot be changed; the responsible team can be reassigned, never
 * cleared.
 */
export const updateIncidentSchema = z
  .strictObject({
    title: incidentTitleSchema.optional(),
    summary: incidentSummarySchema.optional(),
    severity: incidentSeveritySchema.optional(),
    status: incidentStatusTargetSchema.optional(),
    resolution: incidentResolutionSchema.optional(),
    teamId: resourceIdSchema.optional(),
  })
  .refine(
    (body) =>
      body.title !== undefined ||
      body.summary !== undefined ||
      body.severity !== undefined ||
      body.status !== undefined ||
      body.teamId !== undefined,
    'Provide a title, summary, severity, status, or team to change',
  )
  .refine(
    (body) => body.status !== 'RESOLVED' || body.resolution !== undefined,
    { message: 'Say how the incident was resolved', path: ['resolution'] },
  )
  .refine(
    (body) => body.resolution === undefined || body.status === 'RESOLVED',
    {
      message: 'A resolution is recorded only when resolving',
      path: ['resolution'],
    },
  );

/**
 * Posting an operational update: a short message, and nothing else. Who
 * posted it and when come from the server.
 */
export const postIncidentUpdateSchema = z.strictObject({
  message: z.string().trim().min(1).max(2000),
});

/** The longest period a summary covers, in days, both ends included. */
const MAX_SUMMARY_DAYS = 366;

const DAY_MS = 86_400_000;

/** Midnight UTC at the start of a `YYYY-MM-DD` date. */
export const startOfUtcDay = (date: string): Date =>
  new Date(`${date}T00:00:00.000Z`);

/** How many days a period covers, both ends included. */
const periodDays = ({ from, to }: { from: string; to: string }): number =>
  (startOfUtcDay(to).getTime() - startOfUtcDay(from).getTime()) / DAY_MS + 1;

/**
 * Which incidents to list. `state` is required: active and resolved
 * incidents are different questions, ordered differently. The cursor is
 * opaque here and decoded by the service, which knows each state's shape.
 *
 * `from` and `to` narrow the list to one period of whole UTC days, by the
 * moment that defines each state: when an active incident was declared, and
 * when a resolved one was resolved. Both ends or neither, and the same
 * limits a summary's period has.
 *
 * The filters narrow either list further, and combine: one severity, one
 * affected service, one responsible team, and `q` — words from the title, or
 * an incident's number, as `42` or `INC-42`. A blank `q` is no search. A
 * service or team this organization lacks is a filter nothing matches, not
 * an error. A cursor belongs to the filters it was issued under; the client
 * sends the same ones with it.
 */
export const listIncidentsQuerySchema = z
  .object({
    state: z.enum(['active', 'resolved']),
    cursor: z.string().min(1).max(64).optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    severity: incidentSeveritySchema.optional(),
    serviceId: resourceIdSchema.optional(),
    teamId: resourceIdSchema.optional(),
    q: z
      .string()
      .trim()
      .max(200)
      .transform((value) => (value === '' ? undefined : value))
      .optional(),
  })
  .refine(({ from, to }) => (from === undefined) === (to === undefined), {
    message: 'Give both ends of a period, or neither',
    path: ['to'],
  })
  .refine(
    ({ from, to }) => from === undefined || to === undefined || from <= to,
    {
      message: 'The period must not end before it starts',
      path: ['to'],
    },
  )
  .refine(
    ({ from, to }) =>
      from === undefined ||
      to === undefined ||
      periodDays({ from, to }) <= MAX_SUMMARY_DAYS,
    {
      message: `The period may cover at most ${MAX_SUMMARY_DAYS} days`,
      path: ['to'],
    },
  );

/**
 * The period an overview summarises: whole UTC days, `from` to `to`, both
 * included. UTC because every SentinelOps time is read against it. A calendar
 * date only — never a time — so a period is always whole days.
 */
export const incidentSummaryQuerySchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
  })
  .refine(({ from, to }) => from <= to, {
    message: 'The period must not end before it starts',
    path: ['to'],
  })
  .refine(({ from, to }) => periodDays({ from, to }) <= MAX_SUMMARY_DAYS, {
    message: `The period may cover at most ${MAX_SUMMARY_DAYS} days`,
    path: ['to'],
  });

/** A summary period as instants: from its first midnight to the one after it. */
export const summaryBounds = ({
  from,
  to,
}: IncidentSummaryQuery): { gte: Date; lt: Date } => ({
  gte: startOfUtcDay(from),
  lt: new Date(startOfUtcDay(to).getTime() + DAY_MS),
});

/**
 * A page of a member's responses: only the cursor, which is opaque here and
 * decoded by the service.
 */
export const memberResponsesQuerySchema = z.object({
  cursor: z.string().min(1).max(100).optional(),
});

export type CreateIncidentRequest = z.infer<typeof createIncidentSchema>;
export type UpdateIncidentRequest = z.infer<typeof updateIncidentSchema>;
export type PostIncidentUpdateRequest = z.infer<
  typeof postIncidentUpdateSchema
>;
export type ListIncidentsQuery = z.infer<typeof listIncidentsQuerySchema>;
export type IncidentSummaryQuery = z.infer<typeof incidentSummaryQuerySchema>;
export type MemberResponsesQuery = z.infer<typeof memberResponsesQuerySchema>;

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

/**
 * The incident number a search names, if it names one: `42`, or its key,
 * `INC-42` in any case. Anything else — words, a number out of range — is
 * undefined, and searched as title text only.
 */
export const searchedIncidentNumber = (q: string): number | undefined => {
  const match = /^(?:inc-)?([0-9]+)$/i.exec(q);

  return match?.[1] === undefined ? undefined : parseIncidentNumber(match[1]);
};
