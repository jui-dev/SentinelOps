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
 * The caller's own part in an incident, as the list's `part` filter and the
 * parts counts name it. Each is about the caller alone, never a teammate:
 *
 *   - `needs-you`: their team is responsible, they have not started on it,
 *     and it still wants someone — nobody has started, or someone is still
 *     investigating. An incident everyone has finished on is waiting for
 *     resolution, not for them.
 *   - `investigating`: they started and have not completed.
 *   - `completed`: they started and completed their part.
 *
 * Team placement as it stands now decides `needs-you`, as it decides who may
 * start (see incidents.scope.ts).
 */
export const INCIDENT_PARTS = [
  'needs-you',
  'investigating',
  'completed',
] as const;

export type IncidentPart = (typeof INCIDENT_PARTS)[number];

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
 * Words from a title, or an incident's number, as `42` or `INC-42`. Trimmed;
 * a blank search is no search.
 */
const searchSchema = z
  .string()
  .trim()
  .max(200)
  .transform((value) => (value === '' ? undefined : value))
  .optional();

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
 * an incident's number, as `42` or `INC-42`. A blank `q` is no search.
 * `response` narrows by where the response stands: `unclaimed`, no one has
 * started (DECLARED); `ready`, investigating, and no one still is. A
 * service or team this organization lacks is a filter nothing matches, not
 * an error. A cursor belongs to the filters it was issued under; the client
 * sends the same ones with it.
 *
 * `part` narrows by the caller's own part in each (see INCIDENT_PARTS).
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
    response: z.enum(['unclaimed', 'ready']).optional(),
    part: z.enum(INCIDENT_PARTS).optional(),
    q: searchSchema,
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

/**
 * The period an activity calendar covers: the same whole UTC days a summary
 * takes, and the same limits. A calendar is drawn in weeks, but which day a
 * week starts on is the client's own presentation choice — it asks for the
 * days it means to draw, and the API answers in days.
 */
export const incidentActivityQuerySchema = incidentSummaryQuerySchema;

/**
 * How many whole UTC days a response flow covers, ending today: a week, or
 * two. Only these — the reading is drawn day by day, and a longer one would
 * be a different view, not a wider one. A week when none is asked for.
 */
export const incidentFlowQuerySchema = z.object({
  days: z
    .enum(['7', '14'])
    .default('7')
    .transform((days) => Number(days) as 7 | 14),
});

/**
 * The whole UTC days a flow covers: the last `days`, ending with the one
 * `now` falls on — the same shape as every other period here.
 */
export const flowWindow = (
  days: number,
  now: Date,
): { from: string; to: string } => {
  const to = now.toISOString().slice(0, 10);
  const from = new Date(startOfUtcDay(to).getTime() - (days - 1) * DAY_MS)
    .toISOString()
    .slice(0, 10);

  return { from, to };
};

/**
 * Which part of a period's history to page through: the summary's whole UTC
 * days, both required, with the same limits.
 *
 * The filters combine: one severity, `q` as the lists take it, and `show` —
 * `open`, the incidents not yet resolved; `resolved`, those resolved in the
 * period. Without `show`, every incident something happened to in the
 * period. A cursor belongs to the period and filters it was issued under;
 * the client sends the same ones with it.
 */
export const incidentHistoryQuerySchema = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    cursor: z.string().min(1).max(64).optional(),
    severity: incidentSeveritySchema.optional(),
    show: z.enum(['open', 'resolved']).optional(),
    q: searchSchema,
  })
  .refine(({ from, to }) => from <= to, {
    message: 'The period must not end before it starts',
    path: ['to'],
  })
  .refine(({ from, to }) => periodDays({ from, to }) <= MAX_SUMMARY_DAYS, {
    message: `The period may cover at most ${MAX_SUMMARY_DAYS} days`,
    path: ['to'],
  });

/**
 * The period an occurrence covers: the same whole UTC days a summary takes,
 * and the same limits. The previous period it is compared with is derived
 * from it, never asked for.
 */
export const incidentOccurrenceQuerySchema = incidentSummaryQuerySchema;

/** A period of whole UTC days as instants: its first midnight to the one after it. */
export const summaryBounds = ({
  from,
  to,
}: {
  from: string;
  to: string;
}): { gte: Date; lt: Date } => ({
  gte: startOfUtcDay(from),
  lt: new Date(startOfUtcDay(to).getTime() + DAY_MS),
});

/** How many whole UTC days a typical resolution time is measured over. */
export const TYPICAL_RESOLUTION_DAYS = 90;

/**
 * The fewest resolutions a typical time is given for. Below it, a median
 * describes the few incidents there were rather than what is usual.
 */
export const TYPICAL_RESOLUTION_MINIMUM = 5;

/**
 * The whole UTC days a typical resolution time covers: the last
 * `TYPICAL_RESOLUTION_DAYS`, ending with the one `now` falls on — the same
 * shape as every other period here, so `summaryBounds` turns it into
 * instants.
 */
export const typicalResolutionWindow = (
  now: Date,
): { from: string; to: string } => {
  const to = now.toISOString().slice(0, 10);
  const from = new Date(
    startOfUtcDay(to).getTime() - (TYPICAL_RESOLUTION_DAYS - 1) * DAY_MS,
  )
    .toISOString()
    .slice(0, 10);

  return { from, to };
};

/**
 * A page of a member's responses: only the cursor, which is opaque here and
 * decoded by the service.
 */
export const memberResponsesQuerySchema = z.object({
  cursor: z.string().min(1).max(100).optional(),
});

/**
 * The Admin's choice of who may respond: the responsible team, or the people
 * named. Naming nobody leaves the choice to be made.
 */
export const setIncidentResponseAccessSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('OPEN') }),
  z.strictObject({
    mode: z.literal('ASSIGNED'),
    membershipIds: z
      .array(resourceIdSchema)
      .max(200)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        'Name each person once',
      ),
  }),
]);

export type SetIncidentResponseAccessRequest = z.infer<
  typeof setIncidentResponseAccessSchema
>;
export type CreateIncidentRequest = z.infer<typeof createIncidentSchema>;
export type UpdateIncidentRequest = z.infer<typeof updateIncidentSchema>;
export type PostIncidentUpdateRequest = z.infer<
  typeof postIncidentUpdateSchema
>;
export type ListIncidentsQuery = z.infer<typeof listIncidentsQuerySchema>;
export type IncidentSummaryQuery = z.infer<typeof incidentSummaryQuerySchema>;
export type IncidentActivityQuery = z.infer<typeof incidentActivityQuerySchema>;
export type IncidentHistoryQuery = z.infer<typeof incidentHistoryQuerySchema>;
export type IncidentFlowQuery = z.infer<typeof incidentFlowQuerySchema>;
export type IncidentOccurrenceQuery = z.infer<
  typeof incidentOccurrenceQuerySchema
>;
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
