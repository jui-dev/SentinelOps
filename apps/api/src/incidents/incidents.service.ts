import { lockActiveMembership } from '../organizations/active-membership.js';
import { Injectable, Logger } from '@nestjs/common';

import { Permission } from '../authorization/permissions.js';
import { hasPermission } from '../authorization/role-permissions.js';
import { PrismaService } from '../database/prisma.service.js';
import { foreignKeyViolationHint } from '../database/foreign-key-violation.js';
import { Prisma } from '../generated/prisma/client.js';
import type { Role } from '../generated/prisma/enums.js';
import { NotificationsWriter } from '../notifications/notifications.writer.js';
import type { IncidentNotificationType } from '../notifications/notifications.recipients.js';
import { membershipNotFound } from '../organizations/organizations.errors.js';
import { permissionDenied } from '../authorization/authorization.errors.js';
import { knownIssueForDeclaration } from '../known-issues/known-issues.declare.js';
import {
  knownIssueArchived,
  knownIssueNotFound,
} from '../known-issues/known-issues.errors.js';
import {
  serviceArchived,
  serviceNotFound,
} from '../services/services.errors.js';
import { teamNotFound } from '../teams/teams.errors.js';
import { organizationNotFound } from '../tenancy/tenancy.errors.js';
import { isResourceId } from '../tenancy/tenancy.schemas.js';
import { buildActivityCalendar } from './incidents.activity.js';
import { classifyAttention, readyToResolve } from './incidents.attention.js';
import { buildOccurrence, occurrenceWindows } from './incidents.occurrence.js';
import type { InstantRange } from './incidents.occurrence.js';
import {
  mayReadMemberHistory,
  withinIncidentScope,
} from './incidents.scope.js';
import type { IncidentReader } from './incidents.scope.js';
import { buildMemberActivityCalendar } from './member-activity.js';
import type {
  IncidentActivityResponse,
  IncidentActivityType,
  IncidentAttentionResponse,
  IncidentDetailResponse,
  IncidentRepeatsResponse,
  IncidentFlowResponse,
  IncidentHistoryPage,
  IncidentOccurrenceResponse,
  IncidentPage,
  IncidentPartsResponse,
  IncidentSeverity,
  IncidentSummaryResponse,
  MemberActivityResponse,
  MemberResponsePage,
  OperationalActivityResponse,
} from './incidents.contract.js';
import {
  incidentNotFound,
  incidentResolved,
  invalidCursor,
  invalidStatusTransition,
  notAssignedToIncident,
  assigneeCannotRespond,
  severityAlreadyConfirmed,
  notInvestigating,
  notOnResponsibleTeam,
  respondersStillInvestigating,
  responseAlreadyCompleted,
  responseNotOpen,
  startInvestigatingFirst,
} from './incidents.errors.js';
import {
  INITIAL_RESPONSE_ACCESS,
  nextResponseAccess,
  startRefusal,
} from './incidents.response-access.js';
import {
  toIncidentActivityResponse,
  toIncidentAttentionResponse,
  toIncidentDetailResponse,
  toIncidentFlowResponse,
  toIncidentHistoryItemResponse,
  toIncidentOccurrenceResponse,
  toIncidentListItemResponse,
  toIncidentPartsResponse,
  toIncidentSummaryResponse,
  toMemberActivityResponse,
  toMemberResponseResponse,
  toOperationalActivityResponse,
} from './incidents.responses.js';
import type { TypicalResolutionRow } from './incidents.responses.js';
import { buildFlow } from './incidents.flow.js';
import { mergeHistory, toHistoryEntry } from './incidents.history.js';
import {
  flowWindow,
  parseIncidentNumber,
  searchedIncidentNumber,
  summaryBounds,
  typicalResolutionWindow,
} from './incidents.schemas.js';
import type {
  CreateIncidentRequest,
  IncidentActivityQuery,
  IncidentFlowQuery,
  IncidentHistoryQuery,
  IncidentOccurrenceQuery,
  IncidentPart,
  IncidentSummaryQuery,
  ListIncidentsQuery,
  MemberResponsesQuery,
  PostIncidentUpdateRequest,
  SetIncidentResponseAccessRequest,
  UpdateIncidentRequest,
} from './incidents.schemas.js';

/**
 * Prisma's answer to an update whose where matched no row: here, an incident
 * that is not in this organization, one resolved since it was read, or an
 * organization soft-deleted since admission.
 */
const RECORD_NOT_FOUND = 'P2025';

/** Incidents per page, for both lists. Not a client parameter. */
export const INCIDENT_PAGE_SIZE = 50;

/** A member's responses per page. Not a client parameter. */
export const RESPONSE_PAGE_SIZE = 20;

/** How many of a period's incidents a summary previews. */
export const HISTORY_PREVIEW_LIMIT = 10;

/**
 * The most incidents a response flow reads, newest first: a bound on one
 * request, far above two weeks of any organization's incidents.
 */
export const FLOW_INCIDENT_LIMIT = 500;

/** A period's history per page. Not a client parameter. */
export const HISTORY_PAGE_SIZE = 25;

/** A LIKE pattern matching `text` literally: Postgres escapes with `\`. */
const escapeLike = (text: string): string => text.replace(/[\\%_]/g, '\\$&');

/**
 * One of the caller's parts (see INCIDENT_PARTS) as a condition on an
 * incident. It narrows by the caller's own membership only, and always sits
 * inside the reader's scope, so it can never show an incident the reader's
 * list would not.
 */
export const partCondition = (
  part: IncidentPart,
  membershipId: string,
): Prisma.IncidentWhereInput => {
  switch (part) {
    case 'needs-you':
      return {
        responders: { none: { membershipId } },
        AND: [
          // They may start it: open to their team, or assigned to them.
          {
            OR: [
              {
                responseAccess: 'OPEN',
                team: { memberships: { some: { membershipId } } },
              },
              {
                responseAccess: 'ASSIGNED',
                assignees: { some: { membershipId } },
              },
            ],
          },
          {
            OR: [
              { status: 'DECLARED' },
              {
                status: 'INVESTIGATING',
                responders: { some: { status: 'INVESTIGATING' } },
              },
            ],
          },
        ],
      };
    case 'investigating':
      return {
        responders: { some: { membershipId, status: 'INVESTIGATING' } },
      };
    case 'completed':
      return { responders: { some: { membershipId, status: 'COMPLETED' } } };
  }
};

/**
 * The list filters, as conditions on an incident. Each is an equality on a
 * column the organization already scopes, so a service or team from another
 * organization matches nothing rather than leaking anything.
 *
 * A search matches the title case-insensitively, anywhere in it — a plain
 * substring — or, when it names an incident number, that incident. Prisma's
 * `contains` puts the value inside an ILIKE pattern as it is, so `%`, `_`,
 * and the escape character itself are escaped first: a search for "100%"
 * means those four characters. It sits under AND, so it never meets the
 * active list's cursor OR.
 */
const listFilters = (
  query: ListIncidentsQuery,
  membershipId: string,
): Prisma.IncidentWhereInput => {
  const number = query.q ? searchedIncidentNumber(query.q) : undefined;

  // Each condition its own entry under AND, so none can displace the
  // state's own status — a resolved list asked for unclaimed ones is empty.
  const and: Prisma.IncidentWhereInput[] = [
    ...(query.part ? [partCondition(query.part, membershipId)] : []),
    ...(query.response === 'unclaimed'
      ? [{ status: 'DECLARED' as const }]
      : []),
    ...(query.response === 'ready'
      ? [
          {
            status: 'INVESTIGATING' as const,
            responders: { none: { status: 'INVESTIGATING' as const } },
          },
        ]
      : []),
    ...(query.q
      ? [
          {
            OR: [
              {
                title: {
                  contains: escapeLike(query.q),
                  mode: 'insensitive' as const,
                },
              },
              ...(number !== undefined ? [{ number }] : []),
            ],
          },
        ]
      : []),
  ];

  return {
    ...(query.severity && { severity: query.severity }),
    ...(query.serviceId && { serviceId: query.serviceId }),
    ...(query.teamId && { teamId: query.teamId }),
    ...(and.length > 0 && { AND: and }),
  };
};

/** How many incidents were declared on one UTC day, as the raw count returns it. */
export interface DeclaredDayRow {
  day: string;
  declared: number;
}

/**
 * Declarations per UTC calendar day, over a range of instants, for one
 * organization: only the days that had any.
 *
 * Raw, because the query builder cannot group by a day. The day is taken in
 * UTC explicitly — `AT TIME ZONE 'UTC'` turns the instant into a UTC
 * wall-clock `timestamp`, with no zone left in it — so the connection's
 * TimeZone setting cannot move an incident to a neighbouring day. That
 * timestamp is formatted directly: casting it to a `date` first would send
 * it back through the session's zone on its way into `to_char`, which has no
 * form for dates, and casting to text would follow DateStyle. The
 * organization is part of the predicate, as in every read, and its soft
 * deletion is checked; the (organization_id, created_at) index serves the
 * range.
 *
 * A function of the client, so it can join a batch transaction — and so a
 * test can run it under a session time zone of its choosing.
 */
export const declaredPerUtcDay = (
  client: Pick<PrismaService, '$queryRaw'>,
  organizationId: string,
  range: InstantRange,
) =>
  client.$queryRaw<DeclaredDayRow[]>`
    SELECT to_char(i.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
           count(*)::int AS declared
    FROM incidents i
    JOIN organizations o ON o.id = i.organization_id
    WHERE i.organization_id = ${organizationId}::uuid
      AND o.deleted_at IS NULL
      AND i.created_at >= ${range.gte}::timestamptz
      AND i.created_at < ${range.lt}::timestamptz
    GROUP BY 1
    ORDER BY 1
  `;

/**
 * The notification a change's timeline entry is reported as. A change writes
 * only these three; the only status a change can name is RESOLVED, so its
 * status entry is the resolution.
 */
const notifiedBy = (type: IncidentActivityType): IncidentNotificationType => {
  switch (type) {
    case 'SEVERITY_CHANGED':
      return 'INCIDENT_SEVERITY_CHANGED';
    case 'STATUS_CHANGED':
      return 'INCIDENT_RESOLVED';
    case 'TEAM_CHANGED':
      return 'INCIDENT_REASSIGNED';
    default:
      // Unreachable through update(): a masked 500, and nothing committed.
      throw new Error(`A change does not record ${type} entries`);
  }
};

/** Most severe first — the order the database enum declares them in. */
const SEVERITIES: readonly IncidentSeverity[] = [
  'SEV1',
  'SEV2',
  'SEV3',
  'SEV4',
];

/**
 * Columns an incident response is built from. Embedded records are identity
 * only: never the declarer's email, and never `team.memberships`.
 */
/** The people assigned, in the order they were; UUIDv7 ids break a tie. */
const assigneeOrder: Prisma.IncidentAssigneeOrderByWithRelationInput[] = [
  { assignedAt: 'asc' },
  { id: 'asc' },
];

const incidentSelection = {
  id: true,
  number: true,
  title: true,
  summary: true,
  severity: true,
  severityConfirmed: true,
  status: true,
  responseAccess: true,
  assignees: {
    select: {
      membership: { select: { id: true, user: { select: { name: true } } } },
    },
    orderBy: assigneeOrder,
  },
  createdAt: true,
  updatedAt: true,
  resolvedAt: true,
  service: {
    select: {
      id: true,
      name: true,
      slug: true,
      criticality: true,
      archivedAt: true,
    },
  },
  team: { select: { id: true, name: true, slug: true } },
  createdBy: { select: { id: true, name: true } },
  knownIssue: { select: { id: true, name: true } },
} as const;

/**
 * Columns a list item is built from: the incident's, its responders'
 * statuses to count, and its latest update's time — two small joins, never
 * the responders themselves.
 */
// Each responder's status for the counts, and who and when only so the
// reader's own row can be picked out: toIncidentListItemResponse emits no one
// else's.
const incidentListSelection = {
  ...incidentSelection,
  responders: {
    select: {
      status: true,
      membershipId: true,
      startedAt: true,
      completedAt: true,
    },
  },
  activity: {
    where: { type: 'UPDATE' },
    orderBy: { createdAt: 'desc' },
    take: 1,
    select: { createdAt: true },
  },
} as const satisfies Prisma.IncidentSelect;

/** Responders in the order they started; UUIDv7 ids break a tie. */
const responderOrder: Prisma.IncidentResponderOrderByWithRelationInput[] = [
  { startedAt: 'asc' },
  { id: 'asc' },
];

/**
 * Columns a single incident is built from: the list's, with its responders.
 * Lists never select these, so a page stays free of the join. The user's
 * name is not filtered on deletedAt: who responded stays true after they
 * leave, as for the declarer.
 */
const incidentDetailSelection = {
  ...incidentSelection,
  resolution: true,
  responders: {
    select: {
      status: true,
      startedAt: true,
      completedAt: true,
      membership: {
        select: { id: true, removedAt: true, user: { select: { name: true } } },
      },
    },
    orderBy: responderOrder,
  },
} as const;

/**
 * Columns a timeline entry is built from. The actor is identity only, and is
 * not filtered on deletedAt: who posted or changed something stays true after
 * they leave.
 */
const activitySelection = {
  id: true,
  type: true,
  message: true,
  fromValue: true,
  toValue: true,
  createdAt: true,
  actor: { select: { id: true, name: true } },
} as const;

/**
 * Columns the activity calendar reads. The entry carries only what decides
 * whether it counts and when — never its message, and never its actor, which
 * a calendar of the whole organization has no use for. The incident is
 * identity enough to recognise and open, with the service it hit.
 */
const calendarSelection = {
  type: true,
  toValue: true,
  createdAt: true,
  incident: {
    select: {
      id: true,
      number: true,
      title: true,
      severity: true,
      status: true,
      service: { select: { name: true, slug: true } },
    },
  },
} as const;

/**
 * The composite service key refused the row: the service is not in this
 * organization. Matched on the referencing column; the constraint name also
 * contains `organization_id`, which the plain organization key shares.
 */
const violatesServiceKey = (hint: string): boolean =>
  hint.includes('service_id') || hint.includes('serviceid');

/** The composite team key refused the row. */
const violatesTeamKey = (hint: string): boolean =>
  hint.includes('team_id') || hint.includes('teamid');

/**
 * Where the next page of a list starts: the sort key of the last incident on
 * this one. Active incidents are ordered by severity, then number; resolved
 * ones by number alone, newest first.
 */
type ActiveCursor = { severity: IncidentSeverity; number: number };

/** `SEV2:41` for the active list; `41` for the resolved one. */
export const encodeActiveCursor = ({
  severity,
  number,
}: ActiveCursor): string => `${severity}:${number}`;

export const encodeResolvedCursor = (number: number): string => String(number);

export const decodeActiveCursor = (cursor: string): ActiveCursor => {
  const match = /^(SEV[1-4]):([^:]+)$/.exec(cursor);
  const number = match ? parseIncidentNumber(match[2]) : undefined;

  if (!match || number === undefined) {
    throw invalidCursor();
  }

  return { severity: match[1] as IncidentSeverity, number };
};

export const decodeResolvedCursor = (cursor: string): number => {
  const number = parseIncidentNumber(cursor);

  if (number === undefined) {
    throw invalidCursor();
  }

  return number;
};

/**
 * Where the next page of a period's history starts: the last incident's
 * anchor, and its number to break a tie. `2026-09-18T12:05:00.000Z~41`.
 */
type HistoryCursor = { at: Date; number: number };

export const encodeHistoryCursor = ({ at, number }: HistoryCursor) =>
  `${at.toISOString()}~${number}`;

export const decodeHistoryCursor = (cursor: string): HistoryCursor => {
  const [at, digits, ...rest] = cursor.split('~');
  const moment = at === undefined ? undefined : new Date(at);
  const number = digits === undefined ? undefined : parseIncidentNumber(digits);

  if (
    rest.length > 0 ||
    number === undefined ||
    moment === undefined ||
    Number.isNaN(moment.getTime()) ||
    moment.toISOString() !== at
  ) {
    throw invalidCursor();
  }

  return { at: moment, number };
};

/**
 * Where the next page of a member's responses starts: the last response's
 * start, and its id to break a tie. `2026-09-18T12:05:00.000Z~<uuid>`.
 */
type ResponseCursor = { startedAt: Date; id: string };

export const encodeResponseCursor = ({ startedAt, id }: ResponseCursor) =>
  `${startedAt.toISOString()}~${id}`;

export const decodeResponseCursor = (cursor: string): ResponseCursor => {
  const [at, id, ...rest] = cursor.split('~');
  const startedAt = at === undefined ? undefined : new Date(at);

  if (
    rest.length > 0 ||
    id === undefined ||
    !isResourceId(id) ||
    startedAt === undefined ||
    Number.isNaN(startedAt.getTime()) ||
    startedAt.toISOString() !== at
  ) {
    throw invalidCursor();
  }

  return { startedAt, id };
};

/**
 * An organization's incidents: declaring them, reading them, and moving them
 * to resolution.
 *
 * Resource isolation lives here, and does not rely on admission. Every method
 * takes the organization id as an explicit argument and every query filters
 * by it, so each is correct with no guard in front of it. Incidents are
 * addressed by their number within the organization, which is only
 * meaningful together with that organization.
 *
 * Tenant consistency of the service and the team does not rely on this
 * service: composite foreign keys make either from another organization
 * unrepresentable. The declarer is the one reference the database cannot
 * hold to the organization — users are global — so it is taken from the
 * admitted membership, inside the declaring transaction, and never from a
 * body.
 *
 * Authorization by role is the guards'. What depends on the incident itself
 * is here: only its responsible team's members may start investigating it
 * (startResponse), and once they have, their own response — not their team —
 * governs posting updates and completing it (postUpdate, completeResponse).
 * The Admin posts to any incident, and resolves one once nobody is still
 * investigating (update).
 *
 * A declaration, a severity or team change, a resolution, and the last
 * response completing each notify the members they concern (see
 * notifications.recipients.ts), in the same transaction as the timeline
 * entry that records them and at its time: one notification per recipient
 * per entry, and none for a change that changed nothing.
 *
 * Titles, summaries, and update messages are free text and may carry
 * customer or system details, so they are never logged. Ids, numbers, and
 * enum values are.
 */
@Injectable()
export class IncidentsService {
  private readonly logger = new Logger(IncidentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsWriter,
  ) {}

  /**
   * One page of the organization's active or resolved incidents.
   *
   * Active: most severe first, and within a severity the longest-running
   * first. Resolved: most recently declared first. Keyset pages, so a page is
   * one indexed range read however deep it is. An incident whose severity or
   * status changes between two page requests can be skipped or repeated;
   * that is the nature of paging a changing set, and the active list is
   * rarely more than one page.
   *
   * A period narrows each list by the moment that defines its state: active
   * incidents declared in it, resolved incidents resolved in it.
   *
   * Only the incidents the reader may see (see incidents.scope.ts), their
   * scope joined to the page's conditions under AND, so neither the cursor's
   * OR nor the search's AND can displace it.
   */
  async list(
    organizationId: string,
    reader: IncidentReader,
    query: ListIncidentsQuery,
  ): Promise<IncidentPage> {
    // A period narrows each state by the moment that defines it.
    const period =
      query.from && query.to
        ? summaryBounds({ from: query.from, to: query.to })
        : undefined;
    const filters = listFilters(query, reader.membershipId);
    let rows;

    if (query.state === 'active') {
      const after = query.cursor ? decodeActiveCursor(query.cursor) : undefined;

      rows = await this.prisma.incident.findMany({
        where: withinIncidentScope(organizationId, reader, {
          status: { not: 'RESOLVED' },
          ...(period && { createdAt: period }),
          ...filters,
          // Prisma compares enums by equality and membership only, so "after
          // this severity" is the explicit list of the less severe ones.
          ...(after && {
            OR: [
              { severity: after.severity, number: { gt: after.number } },
              {
                severity: {
                  in: SEVERITIES.slice(SEVERITIES.indexOf(after.severity) + 1),
                },
              },
            ],
          }),
        }),
        select: incidentListSelection,
        orderBy: [{ severity: 'asc' }, { number: 'asc' }],
        take: INCIDENT_PAGE_SIZE + 1,
      });
    } else {
      const before = query.cursor
        ? decodeResolvedCursor(query.cursor)
        : undefined;

      rows = await this.prisma.incident.findMany({
        where: withinIncidentScope(organizationId, reader, {
          status: 'RESOLVED',
          ...(period && { resolvedAt: period }),
          ...filters,
          ...(before !== undefined && { number: { lt: before } }),
        }),
        select: incidentListSelection,
        orderBy: { number: 'desc' },
        take: INCIDENT_PAGE_SIZE + 1,
      });
    }

    const hasMore = rows.length > INCIDENT_PAGE_SIZE;
    const items = rows.slice(0, INCIDENT_PAGE_SIZE);
    const last = items.at(-1);

    return {
      items: items.map((item) =>
        toIncidentListItemResponse(item, reader.membershipId),
      ),
      page: {
        cursor:
          hasMore && last
            ? query.state === 'active'
              ? encodeActiveCursor(last)
              : encodeResolvedCursor(last.number)
            : null,
        hasMore,
      },
    };
  }

  /**
   * One member's responses: the incidents they started investigating, the
   * most recently started first, each with where their own part stands.
   * Only actual participation — being on the incident's team is not a
   * response — so a member who never started has none.
   *
   * Whose history a reader may ask for is mayReadMemberHistory's judgement:
   * their own always, anyone else's only as oversight. A history that is not
   * theirs is 404 MEMBERSHIP_NOT_FOUND — the same answer a malformed,
   * missing, or foreign id gets, and given before any query, so whether that
   * membership exists is not disclosed by the reply or by how long it took.
   *
   * The membership is then resolved within the organization, which also
   * settles the organization's soft deletion before anything is read. Keyset
   * pages over (startedAt, id) — the id a UUIDv7, breaking a tie — served by
   * the (membership_id, started_at) index. The incidents are the lists'
   * shape, with no responders or resolution, and are not narrowed by the
   * reader: see mayReadMemberHistory.
   */
  async memberResponses(
    organizationId: string,
    reader: IncidentReader,
    membershipId: string,
    query: MemberResponsesQuery,
  ): Promise<MemberResponsePage> {
    if (
      !isResourceId(membershipId) ||
      !mayReadMemberHistory(reader, membershipId)
    ) {
      throw membershipNotFound();
    }

    const membership = await this.prisma.membership.findFirst({
      where: {
        id: membershipId,
        organizationId,
        organization: { deletedAt: null },
      },
      select: { id: true },
    });

    if (!membership) {
      throw membershipNotFound();
    }

    const after = query.cursor ? decodeResponseCursor(query.cursor) : undefined;

    const rows = await this.prisma.incidentResponder.findMany({
      where: {
        organizationId,
        membershipId,
        ...(after && {
          OR: [
            { startedAt: { lt: after.startedAt } },
            { startedAt: after.startedAt, id: { lt: after.id } },
          ],
        }),
      },
      select: {
        id: true,
        status: true,
        startedAt: true,
        completedAt: true,
        incident: { select: incidentSelection },
      },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: RESPONSE_PAGE_SIZE + 1,
    });

    const hasMore = rows.length > RESPONSE_PAGE_SIZE;
    const items = rows.slice(0, RESPONSE_PAGE_SIZE);
    const last = items.at(-1);

    return {
      items: items.map(toMemberResponseResponse),
      page: {
        cursor: hasMore && last ? encodeResponseCursor(last) : null,
        hasMore,
      },
    };
  }

  /**
   * The organization's incidents now, and in one period of whole UTC days.
   *
   * Organization-wide by design, and so oversight: there is no reader here to
   * narrow it by, and the route declares `incidents:read-all` rather than
   * `incidents:read` because of it.
   *
   * Counts, not pages: every figure covers every incident it describes. The
   * reads share one repeatable-read snapshot, so the figures and the history
   * agree with each other even while incidents change. Active incidents are
   * grouped by service and severity in one query, which gives the
   * organization's counts and each affected service's. Responses still under
   * way are read in the same snapshot, so who is investigating cannot
   * disagree with what is active, and so are the active statuses and the
   * typical time each severity takes to resolve over the last ninety days —
   * what an active incident's duration is read against. The history
   * previews the most recent incidents declared or resolved in the period.
   */
  async summary(
    organizationId: string,
    query: IncidentSummaryQuery,
    /** The moment "the last ninety days" end at; the clock, unless a test says. */
    now: Date = new Date(),
  ): Promise<IncidentSummaryResponse> {
    const scope = { organizationId, organization: { deletedAt: null } };
    const unresolved = { status: { not: 'RESOLVED' as const } };
    const period = summaryBounds(query);
    const typicalWindow = typicalResolutionWindow(now);
    const typicalBounds = summaryBounds(typicalWindow);

    const declaredInPeriod = { ...scope, createdAt: period };
    const resolvedInPeriod = {
      ...scope,
      status: 'RESOLVED' as const,
      resolvedAt: period,
    };

    const [
      active,
      services,
      responders,
      statuses,
      typical,
      declared,
      resolved,
      stillOpen,
      bothInPeriod,
      declaredRecently,
      resolvedRecently,
      resolution,
    ] = await this.prisma.$transaction(
      [
        this.prisma.incident.groupBy({
          by: ['serviceId', 'severity'],
          where: { ...scope, ...unresolved },
          _count: { _all: true },
        }),
        this.prisma.service.findMany({
          where: {
            ...scope,
            incidents: { some: unresolved },
          },
          select: {
            id: true,
            name: true,
            slug: true,
            criticality: true,
            archivedAt: true,
            ownerTeam: { select: { id: true, name: true, slug: true } },
          },
        }),
        // Responses still under way, one row each. The incident's status is
        // checked as well as the responder's: a resolution is refused while
        // anyone is still investigating, but that is this service's rule,
        // not a constraint the database holds us to.
        this.prisma.incidentResponder.findMany({
          where: {
            ...scope,
            status: 'INVESTIGATING',
            incident: unresolved,
          },
          select: {
            membershipId: true,
            incidentId: true,
            incident: { select: { teamId: true } },
          },
        }),
        this.prisma.incident.groupBy({
          by: ['status'],
          where: { ...scope, ...unresolved },
          _count: { _all: true },
        }),
        // The median time to resolve, per severity, over the window. Raw,
        // because a percentile has no query-builder form; the organization
        // is part of the predicate, as in every other read, and the
        // (organization_id, resolved_at) index serves the range.
        this.prisma.$queryRaw<TypicalResolutionRow[]>`
          SELECT i.severity::text AS severity,
                 count(*)::int AS resolved,
                 percentile_cont(0.5) WITHIN GROUP (
                   ORDER BY extract(epoch FROM (i.resolved_at - i.created_at)) * 1000
                 )::float8 AS median_ms
          FROM incidents i
          JOIN organizations o ON o.id = i.organization_id
          WHERE i.organization_id = ${organizationId}::uuid
            AND o.deleted_at IS NULL
            AND i.status = 'RESOLVED'
            AND i.resolved_at >= ${typicalBounds.gte}::timestamptz
            AND i.resolved_at < ${typicalBounds.lt}::timestamptz
          GROUP BY i.severity
        `,
        this.prisma.incident.groupBy({
          by: ['severity'],
          where: declaredInPeriod,
          _count: { _all: true },
        }),
        this.prisma.incident.count({ where: resolvedInPeriod }),
        this.prisma.incident.count({
          where: { ...scope, ...unresolved, createdAt: period },
        }),
        // Declared and resolved in the same period: one incident, counted
        // once, so the history's total is neither doubled nor short.
        this.prisma.incident.count({
          where: { ...resolvedInPeriod, createdAt: period },
        }),
        this.prisma.incident.findMany({
          where: declaredInPeriod,
          select: incidentSelection,
          orderBy: [{ createdAt: 'desc' }, { number: 'desc' }],
          take: HISTORY_PREVIEW_LIMIT,
        }),
        this.prisma.incident.findMany({
          where: resolvedInPeriod,
          select: incidentSelection,
          orderBy: [{ resolvedAt: 'desc' }, { number: 'desc' }],
          take: HISTORY_PREVIEW_LIMIT,
        }),
        // The period's median time to resolve, raw for the same reason as
        // the typical one: a percentile has no query-builder form.
        this.prisma.$queryRaw<{ median_ms: number | null }[]>`
          SELECT percentile_cont(0.5) WITHIN GROUP (
                   ORDER BY extract(epoch FROM (i.resolved_at - i.created_at)) * 1000
                 )::float8 AS median_ms
          FROM incidents i
          JOIN organizations o ON o.id = i.organization_id
          WHERE i.organization_id = ${organizationId}::uuid
            AND o.deleted_at IS NULL
            AND i.status = 'RESOLVED'
            AND i.resolved_at >= ${period.gte}::timestamptz
            AND i.resolved_at < ${period.lt}::timestamptz
        `,
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    return toIncidentSummaryResponse({
      active,
      services,
      responders,
      statuses,
      typical: { rows: typical, window: typicalWindow },
      declared,
      resolved,
      stillOpen,
      resolutionMedianMs:
        resolution[0]?.median_ms == null
          ? null
          : Math.round(resolution[0].median_ms),
      period: { from: query.from, to: query.to },
      history: {
        // Declared plus resolved, less those that were both.
        total:
          declared.reduce((sum, row) => sum + row._count._all, 0) +
          resolved -
          bothInPeriod,
        items: mergeHistory(
          declaredRecently,
          resolvedRecently,
          period,
          HISTORY_PREVIEW_LIMIT,
        ),
      },
    });
  }

  /**
   * One page of a period's history: every incident declared or resolved in
   * it, most recent first. Organization-wide, like the summary, and
   * `incidents:read-all` for the same reason.
   *
   * An incident's place is its anchor — its resolution when that fell in
   * the period, its declaration otherwise — with its number breaking a tie,
   * keyset-paged on both. Raw, because the query builder cannot order by an
   * expression; the organization is part of the predicate, and its soft
   * deletion is checked, as in every read. The count, the order and the
   * rows share one repeatable-read snapshot, so `total` agrees with what is
   * listed.
   *
   * The filters narrow it: one severity, a search as the lists take it —
   * `%`, `_` and the escape character taken literally — and `show`, the
   * open incidents or those resolved in the period.
   */
  async history(
    organizationId: string,
    query: IncidentHistoryQuery,
  ): Promise<IncidentHistoryPage> {
    const period = summaryBounds(query);
    const after = query.cursor ? decodeHistoryCursor(query.cursor) : undefined;
    const number = query.q ? searchedIncidentNumber(query.q) : undefined;

    const inPeriod = (column: Prisma.Sql) =>
      Prisma.sql`(${column} >= ${period.gte}::timestamptz AND ${column} < ${period.lt}::timestamptz)`;
    const anchor = Prisma.sql`CASE WHEN ${inPeriod(Prisma.sql`i.resolved_at`)} THEN i.resolved_at ELSE i.created_at END`;
    const pattern = query.q ? `%${escapeLike(query.q)}%` : '';

    const conditions = [
      Prisma.sql`i.organization_id = ${organizationId}::uuid`,
      Prisma.sql`o.deleted_at IS NULL`,
      Prisma.sql`(${inPeriod(Prisma.sql`i.created_at`)} OR ${inPeriod(Prisma.sql`i.resolved_at`)})`,
      ...(query.severity
        ? [Prisma.sql`i.severity::text = ${query.severity}`]
        : []),
      ...(query.show === 'open' ? [Prisma.sql`i.status <> 'RESOLVED'`] : []),
      ...(query.show === 'resolved'
        ? [
            Prisma.sql`i.status = 'RESOLVED'`,
            inPeriod(Prisma.sql`i.resolved_at`),
          ]
        : []),
      ...(query.q
        ? [
            number === undefined
              ? Prisma.sql`i.title ILIKE ${pattern}`
              : Prisma.sql`(i.title ILIKE ${pattern} OR i.number = ${number})`,
          ]
        : []),
    ];
    const where = Prisma.join(conditions, ' AND ');

    const { total, rows, hasMore } = await this.prisma.$transaction(
      async (tx) => {
        const [counted] = await tx.$queryRaw<{ total: number }[]>`
          SELECT count(*)::int AS total
          FROM incidents i
          JOIN organizations o ON o.id = i.organization_id
          WHERE ${where}
        `;
        const ordered = await tx.$queryRaw<{ id: string }[]>`
          SELECT i.id
          FROM incidents i
          JOIN organizations o ON o.id = i.organization_id
          WHERE ${where}
            ${
              after
                ? Prisma.sql`AND (${anchor}, i.number) < (${after.at}::timestamptz, ${after.number})`
                : Prisma.empty
            }
          ORDER BY ${anchor} DESC, i.number DESC
          LIMIT ${HISTORY_PAGE_SIZE + 1}
        `;
        const ids = ordered.slice(0, HISTORY_PAGE_SIZE).map(({ id }) => id);
        const found = await tx.incident.findMany({
          where: { organizationId, id: { in: ids } },
          select: incidentSelection,
        });
        const byId = new Map(found.map((row) => [row.id, row]));

        return {
          total: counted?.total ?? 0,
          rows: ids
            .map((id) => byId.get(id))
            .filter((row) => row !== undefined),
          hasMore: ordered.length > HISTORY_PAGE_SIZE,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    const entries = rows.map((row) => toHistoryEntry(row, period));
    const last = entries.at(-1);

    return {
      items: entries.map(toIncidentHistoryItemResponse),
      total,
      page: {
        cursor:
          hasMore && last
            ? encodeHistoryCursor({
                at:
                  last.resolvedInPeriod && last.incident.resolvedAt
                    ? last.incident.resolvedAt
                    : last.incident.createdAt,
                number: last.incident.number,
              })
            : null,
        hasMore,
      },
    };
  }

  /**
   * When the organization was operationally active, day by day, over a
   * period of whole UTC days. Organization-wide, like the summary, and
   * `incidents:read-all` for the same reason.
   *
   * One read: every timeline entry recorded in the period, across every
   * incident, served by the (organization_id, created_at) index.
   * buildActivityCalendar decides what counts — so the entries arrive
   * unfiltered and the rule lives in one tested place, rather than being
   * spelt once here as a query and again there as a judgement.
   *
   * Not a transaction: it is one statement, and so already one snapshot.
   * Unpaged, like the timeline and attention: the period is capped at 366
   * days by the request schema, and what comes back is a count per day.
   *
   * The organization's soft deletion is checked through the incident, which
   * is the only relation an entry has to it.
   */
  async activity(
    organizationId: string,
    query: IncidentActivityQuery,
  ): Promise<OperationalActivityResponse> {
    const rows = await this.prisma.incidentActivity.findMany({
      where: {
        organizationId,
        incident: { organization: { deletedAt: null } },
        createdAt: summaryBounds(query),
      },
      select: calendarSelection,
      orderBy: { createdAt: 'asc' },
    });

    return toOperationalActivityResponse(
      buildActivityCalendar(rows, query),
      query,
    );
  }

  /**
   * How often incidents were declared over a period of whole UTC days, and
   * against which services, compared with the same elapsed time before it.
   * Organization-wide, like the summary, and `incidents:read-all` for the
   * same reason. See incidents.occurrence.ts for every rule; this only reads.
   *
   * Five reads in one repeatable-read snapshot, so the days, the previous
   * total, the services, and where history begins agree with each other
   * even while incidents are declared:
   *
   *   - the organization's creation, which also settles its soft deletion
   *   - its earliest incident, the other end history can begin at
   *   - declarations per UTC day, from six days before the period to `asOf`
   *   - declarations in the previous period, cut at the same distance
   *   - declarations per service in the period, and those services
   *
   * Every read names the organization, and every one but its own row also
   * requires it not to be soft-deleted. Each is a range on the
   * (organization_id, created_at) index, or a lookup by primary key. The
   * services are found through their incidents in the period rather than by
   * the ids the count returns, so both are read in the same snapshot.
   *
   * Occurrence is declaration alone: status, severity, and resolution are
   * never read, and an archived service is counted like any other.
   */
  async occurrence(
    organizationId: string,
    query: IncidentOccurrenceQuery,
    /** The moment counting stops at; the clock, unless a test says. */
    now: Date = new Date(),
  ): Promise<IncidentOccurrenceResponse> {
    const scope = { organizationId, organization: { deletedAt: null } };
    const windows = occurrenceWindows(query, now);
    const inPeriod = { ...scope, createdAt: windows.current };

    const [organization, earliest, daily, previous, perService, services] =
      await this.prisma.$transaction(
        [
          this.prisma.organization.findFirst({
            where: { id: organizationId, deletedAt: null },
            select: { createdAt: true },
          }),
          this.prisma.incident.findFirst({
            where: scope,
            select: { createdAt: true },
            orderBy: { createdAt: 'asc' },
          }),
          declaredPerUtcDay(this.prisma, organizationId, windows.series),
          this.prisma.incident.count({
            where: {
              ...scope,
              createdAt: { gte: windows.previous.gte, lt: windows.previous.lt },
            },
          }),
          this.prisma.incident.groupBy({
            by: ['serviceId'],
            where: inPeriod,
            _count: { _all: true },
          }),
          this.prisma.service.findMany({
            where: { ...scope, incidents: { some: inPeriod } },
            select: {
              id: true,
              name: true,
              slug: true,
              criticality: true,
              archivedAt: true,
            },
          }),
        ],
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );

    // Admission already refuses a soft-deleted organization; this is the
    // service's own check, for a caller that reaches it another way.
    if (!organization) {
      throw organizationNotFound();
    }

    const counts = new Map(
      perService.map((row) => [row.serviceId, row._count._all]),
    );
    const trackedSince =
      earliest && earliest.createdAt < organization.createdAt
        ? earliest.createdAt
        : organization.createdAt;

    return toIncidentOccurrenceResponse(
      buildOccurrence({
        period: query,
        windows,
        trackedSince,
        daily,
        previousDeclared: previous,
        services: services.map((service) => ({
          service,
          declared: counts.get(service.id) ?? 0,
        })),
      }),
    );
  }

  /**
   * When one member personally took part in incident response, day by day,
   * over a period of whole UTC days.
   *
   * Whose history it is, as memberResponses decides it: their own always,
   * anyone else's only as oversight, and anything else 404
   * MEMBERSHIP_NOT_FOUND before a query — indistinguishable from a
   * malformed, missing, or foreign id. The membership is then resolved
   * within the organization, which also settles the organization's soft
   * deletion before anything is read.
   *
   * Attribution is by author. A timeline entry names the global User rather
   * than the membership — attribution outlives the grant — so the membership
   * is resolved to its user and the entries are read by
   * (organization, actor, day), served by that index. A user who belongs to
   * two organizations has two memberships and two separate histories: the
   * organization is part of the key, so nothing they wrote elsewhere is here.
   *
   * What counts is buildMemberActivityCalendar's judgement, not this query's:
   * the entries arrive unfiltered by type, and only the three acts of
   * responding are counted. Being on a team writes no entry, so it cannot
   * appear; neither can anything a teammate wrote.
   */
  async memberActivity(
    organizationId: string,
    reader: IncidentReader,
    membershipId: string,
    query: IncidentActivityQuery,
  ): Promise<MemberActivityResponse> {
    if (
      !isResourceId(membershipId) ||
      !mayReadMemberHistory(reader, membershipId)
    ) {
      throw membershipNotFound();
    }

    const membership = await this.prisma.membership.findFirst({
      where: {
        id: membershipId,
        organizationId,
        organization: { deletedAt: null },
      },
      select: { userId: true },
    });

    if (!membership) {
      throw membershipNotFound();
    }

    const rows = await this.prisma.incidentActivity.findMany({
      where: {
        organizationId,
        actorId: membership.userId,
        createdAt: summaryBounds(query),
      },
      select: calendarSelection,
      orderBy: { createdAt: 'asc' },
    });

    return toMemberActivityResponse(
      buildMemberActivityCalendar(rows, query),
      query,
    );
  }

  /**
   * The active incidents waiting on the caller now (see classifyAttention):
   * resolvable ones for whoever holds `incidents:manage`; for whoever holds
   * `incidents:respond`, those their teams have not picked up and their own
   * responses still under way. Derived from the incidents as they stand —
   * nothing is recorded or marked read.
   *
   * The caller's role is the admitted one, passed in explicitly and judged
   * by the same role table the guards use, as postUpdate does. Their teams
   * are found by their membership, and everyone on those teams with them,
   * in one query scoped by organization. Both reads share one
   * repeatable-read snapshot, so a response or a team change between them
   * cannot put an incident in the wrong list. Unpaged: only active
   * incidents are read.
   */
  async attention(
    organizationId: string,
    actor: { membershipId: string; role: Role },
  ): Promise<IncidentAttentionResponse> {
    const canManage = hasPermission(actor.role, Permission.INCIDENTS_MANAGE);
    const canRespond = hasPermission(actor.role, Permission.RESPONSES_WORK);

    const [incidents, teamMembers] = await this.prisma.$transaction(
      [
        this.prisma.incident.findMany({
          where: {
            organizationId,
            organization: { deletedAt: null },
            status: { not: 'RESOLVED' },
          },
          // In no order: classifyAttention sorts each list.
          select: incidentDetailSelection,
        }),
        // Everyone on each of the caller's teams, the caller included.
        this.prisma.teamMembership.findMany({
          where: {
            organizationId,
            team: {
              memberships: { some: { membershipId: actor.membershipId } },
            },
          },
          select: { teamId: true, membershipId: true },
        }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    const teams = new Map<string, Set<string>>();

    for (const { teamId, membershipId } of teamMembers) {
      teams.set(teamId, (teams.get(teamId) ?? new Set()).add(membershipId));
    }

    return toIncidentAttentionResponse(
      classifyAttention(incidents, {
        membershipId: actor.membershipId,
        canManage,
        canRespond,
        teams,
      }),
    );
  }

  /**
   * The reader's active incidents counted by their own part in each, and
   * all of them: what sizes the Incidents page's tabs and filter pills.
   *
   * Every count stays inside the reader's scope (incidents.scope.ts), so it
   * never counts an incident their list would not show. Four groupings by
   * team and severity in one repeatable-read snapshot, so the parts agree
   * with each other and with the whole; the search and the list's other
   * filters play no part.
   */
  async parts(
    organizationId: string,
    reader: IncidentReader,
  ): Promise<IncidentPartsResponse> {
    const grouped = (part?: IncidentPart) =>
      this.prisma.incident.groupBy({
        by: ['teamId', 'severity'],
        where: withinIncidentScope(organizationId, reader, {
          status: { not: 'RESOLVED' },
          ...(part && { AND: [partCondition(part, reader.membershipId)] }),
        }),
        _count: { _all: true },
      });

    const [needsYou, investigating, completed, active] =
      await this.prisma.$transaction(
        [
          grouped('needs-you'),
          grouped('investigating'),
          grouped('completed'),
          grouped(),
        ],
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );

    const rows = (
      groups: readonly {
        teamId: string;
        severity: IncidentSeverity;
        _count: { _all: number };
      }[],
    ) =>
      groups.map(({ teamId, severity, _count }) => ({
        teamId,
        severity,
        count: _count._all,
      }));

    return toIncidentPartsResponse({
      'needs-you': rows(needsYou),
      investigating: rows(investigating),
      completed: rows(completed),
      active: rows(active),
    });
  }

  /**
   * How teams' incidents ran over the last week or two: each one's wait for
   * a first responder and its work after, with team-level figures.
   *
   * Whose teams follows the caller's grant: with `incidents:read-all`,
   * every team in the organization; otherwise the teams they are on now —
   * a subset of what incidents.scope.ts already lets them read, so nothing
   * here is visible that their incident list would not show. Their own
   * updates are found by their user, the timeline's actor.
   *
   * One repeatable-read snapshot: the teams, the incidents, and the
   * updates agree. An incident is read if it was running at any point in
   * the window: declared before its end, and unresolved or resolved after
   * its start.
   */
  async flow(
    organizationId: string,
    actor: { membershipId: string; role: Role },
    query: IncidentFlowQuery,
    /** The moment the window ends at; the clock, unless a test says. */
    now: Date = new Date(),
  ): Promise<IncidentFlowResponse> {
    const oversees = hasPermission(actor.role, Permission.INCIDENTS_READ_ALL);
    const { from, to } = flowWindow(query.days, now);
    const bounds = summaryBounds({ from, to });
    const asOf = now < bounds.lt ? now : bounds.lt;

    const { teams, rows } = await this.prisma.$transaction(
      async (tx) => {
        const membership = await tx.membership.findFirst({
          where: {
            id: actor.membershipId,
            organizationId,
            organization: { deletedAt: null },
          },
          select: { userId: true },
        });

        if (!membership) {
          throw organizationNotFound();
        }

        const teams = await tx.team.findMany({
          where: {
            organizationId,
            ...(!oversees && {
              memberships: { some: { membershipId: actor.membershipId } },
            }),
          },
          select: { id: true, name: true, slug: true },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        });

        const incidents = await tx.incident.findMany({
          where: {
            organizationId,
            teamId: { in: teams.map(({ id }) => id) },
            createdAt: { lt: bounds.lt },
            OR: [{ resolvedAt: null }, { resolvedAt: { gte: bounds.gte } }],
          },
          select: {
            id: true,
            number: true,
            title: true,
            severity: true,
            status: true,
            createdAt: true,
            resolvedAt: true,
            team: { select: { id: true, name: true, slug: true } },
            service: { select: { id: true, name: true, slug: true } },
            responders: { select: { startedAt: true } },
            activity: {
              where: {
                type: 'UPDATE',
                actorId: membership.userId,
                createdAt: { gte: bounds.gte, lt: bounds.lt },
              },
              select: { createdAt: true },
              orderBy: { createdAt: 'asc' },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: FLOW_INCIDENT_LIMIT,
        });

        return { teams, rows: incidents };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    const flow = buildFlow(
      rows.map(({ activity, ...row }) => ({ ...row, updates: activity })),
      teams,
      { gte: bounds.gte, lt: bounds.lt, now: asOf },
    );

    return toIncidentFlowResponse(flow, {
      from,
      to,
      asOf,
      days: query.days,
      scope: oversees ? 'organization' : 'teams',
    });
  }

  /**
   * One incident, by its number within the organization, with its
   * responders. One the reader may not see (see incidents.scope.ts) is 404
   * INCIDENT_NOT_FOUND, exactly as a missing or foreign one is.
   */
  async get(
    organizationId: string,
    reader: IncidentReader,
    incidentNumber: string,
  ): Promise<IncidentDetailResponse> {
    const number = parseIncidentNumber(incidentNumber);

    if (number === undefined) {
      throw incidentNotFound();
    }

    const incident = await this.prisma.incident.findFirst({
      where: withinIncidentScope(organizationId, reader, { number }),
      select: incidentDetailSelection,
    });

    if (!incident) {
      throw incidentNotFound();
    }

    return toIncidentDetailResponse(incident);
  }

  /**
   * The incident's known issue, and the other times it happened: those the
   * reader may see (see incidents.scope.ts), newest first, and how many
   * others there are that they may not. The incident itself is read in the
   * reader's scope first, so one they may not see is 404 as for get().
   */
  async repeats(
    organizationId: string,
    reader: IncidentReader,
    incidentNumber: string,
  ): Promise<IncidentRepeatsResponse> {
    const number = parseIncidentNumber(incidentNumber);

    if (number === undefined) {
      throw incidentNotFound();
    }

    const incident = await this.prisma.incident.findFirst({
      where: withinIncidentScope(organizationId, reader, { number }),
      select: {
        id: true,
        knownIssue: { select: { id: true, name: true, usualSeverity: true } },
      },
    });

    if (!incident) {
      throw incidentNotFound();
    }

    if (!incident.knownIssue) {
      return { knownIssue: null, others: [], hidden: 0 };
    }

    const others = {
      knownIssueId: incident.knownIssue.id,
      id: { not: incident.id },
    };
    const [visible, all] = await this.prisma.$transaction(
      [
        this.prisma.incident.findMany({
          where: withinIncidentScope(organizationId, reader, others),
          select: {
            number: true,
            title: true,
            severity: true,
            status: true,
            createdAt: true,
            resolvedAt: true,
            analysis: { select: { publishedAt: true } },
          },
          orderBy: [{ createdAt: 'desc' }, { number: 'desc' }],
        }),
        this.prisma.incident.count({ where: { organizationId, ...others } }),
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    return {
      knownIssue: {
        id: incident.knownIssue.id,
        name: incident.knownIssue.name,
        usualSeverity: incident.knownIssue.usualSeverity,
      },
      others: visible.map((row) => ({
        number: row.number,
        title: row.title,
        severity: row.severity,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        resolvedAt: row.resolvedAt?.toISOString() ?? null,
        analysisPublished: row.analysis?.publishedAt != null,
      })),
      hidden: all - visible.length,
    };
  }

  /**
   * Declares an incident against one of the organization's services. The
   * responsible team is the service's owner at this moment; the declarer is
   * the user behind the admitting membership.
   *
   * One transaction, taking its locks in a fixed order — the organization
   * row, then the service row — so it cannot deadlock with another
   * declaration or with a change to the service:
   *
   *   1. Increment the organization's incident counter. The UPDATE both
   *      allocates the number and holds the organization row until commit,
   *      so declarations in one organization take turns, and it refuses an
   *      organization soft-deleted since admission.
   *   2. Resolve the declarer from the membership, within this organization.
   *   3. Read the service's owner and archival state FOR SHARE (see
   *      lockService). Until commit, the service cannot be reassigned,
   *      archived, or deleted, and its owning team cannot be deleted — it
   *      owns the service. The owner read here is therefore still the owner
   *      when the incident is inserted, and still exists.
   *   4. Insert the incident with scalar ids, and its DECLARED timeline
   *      entry.
   *
   * So a declaration racing a change to its service happens entirely before
   * or entirely after it: before, and the change waits (and a delete is then
   * refused, because the service has an incident); after, and the
   * declaration sees the new owner, the archive (409), or no service (404).
   */
  async create(
    organizationId: string,
    actor: { membershipId: string; role: Role },
    input: CreateIncidentRequest,
  ): Promise<IncidentDetailResponse> {
    // Known issues are kept with the services, by whoever manages them.
    // Anyone who declares may pick one; saving a new one is that job.
    if (
      input.saveAsKnownIssue &&
      !hasPermission(actor.role, Permission.SERVICES_MANAGE)
    ) {
      throw permissionDenied();
    }

    let incident;

    try {
      incident = await this.prisma.$transaction(async (tx) => {
        const number = await this.allocateNumber(tx, organizationId);

        const declarerId = await this.resolveActor(
          tx,
          organizationId,
          actor.membershipId,
        );

        const service = await this.lockService(
          tx,
          organizationId,
          input.serviceId,
        );

        if (!service) {
          throw serviceNotFound();
        }

        if (service.archivedAt !== null) {
          throw serviceArchived();
        }

        const knownIssueId = await knownIssueForDeclaration(tx, {
          organizationId,
          serviceId: input.serviceId,
          title: input.title,
          summary: input.summary ?? null,
          severity: input.severity,
          knownIssueId: input.knownIssueId,
          saveAsKnownIssue: input.saveAsKnownIssue,
          actorId: declarerId,
        });

        // Scalar ids, not nested connects: both relations share
        // organizationId, and it is that shared column the keys check.
        const created = await tx.incident.create({
          data: {
            organizationId,
            number,
            title: input.title,
            summary: input.summary ?? null,
            serviceId: input.serviceId,
            teamId: service.ownerTeamId,
            severity: input.severity,
            // Whoever decides on incidents settles the severity as they
            // declare; anyone else's is a suggestion until they do.
            severityConfirmed: hasPermission(
              actor.role,
              Permission.INCIDENTS_MANAGE,
            ),
            responseAccess: INITIAL_RESPONSE_ACCESS,
            createdById: declarerId,
            knownIssueId,
          },
          select: incidentDetailSelection,
        });

        const declared = await tx.incidentActivity.create({
          data: {
            organizationId,
            incidentId: created.id,
            type: 'DECLARED',
            actorId: declarerId,
            toValue: created.severity,
            createdAt: created.createdAt,
          },
          select: { id: true, createdAt: true },
        });

        await this.notifications.incidentActivities(tx, {
          organizationId,
          incidentId: created.id,
          teamId: created.team.id,
          actor: { userId: declarerId, membershipId: actor.membershipId },
          events: [
            {
              type: 'INCIDENT_DECLARED',
              activityId: declared.id,
              createdAt: declared.createdAt,
            },
          ],
        });

        return created;
      });
    } catch (error) {
      // A backstop: the row lock makes this unreachable through the API,
      // but the answer if the service key ever refuses is the one the read
      // would have given. A team or user key violation is deliberately not
      // mapped — the lock makes it impossible through the API, so one means
      // an out-of-band deletion, and a masked 500 with the stack logged is
      // the honest answer.
      const foreignKey = foreignKeyViolationHint(error);

      // A known issue merged away between being chosen and the insert: the
      // incidents' key names service_id too, so it is told apart first.
      if (foreignKey !== undefined && foreignKey.includes('known_issue')) {
        throw knownIssueNotFound();
      }

      if (foreignKey !== undefined && violatesServiceKey(foreignKey)) {
        throw serviceNotFound();
      }

      throw error;
    }

    this.logger.log('Incident declared', {
      incidentId: incident.id,
      incidentNumber: incident.number,
      serviceId: incident.service.id,
      teamId: incident.team.id,
      severity: incident.severity,
      knownIssueId: incident.knownIssue?.id ?? null,
    });

    return toIncidentDetailResponse(incident);
  }

  /**
   * Changes an active incident: its title, summary, severity, status, or
   * responsible team. A resolved incident is not changed — any
   * change to one is a 409, whatever it names.
   *
   * The one status a change can name is `RESOLVED`: an INVESTIGATING incident
   * is resolved, setting resolvedAt and the resolution note (which the
   * request schema requires) in the same write, and the note is the message
   * of the resolution's timeline entry. A DECLARED incident
   * is not — nobody has investigated it — and is 409
   * INVALID_STATUS_TRANSITION. Nor is one that any responder is still
   * investigating: 409 RESPONDERS_STILL_INVESTIGATING. Either way nothing in
   * the request is applied. An incident becomes INVESTIGATING only when a
   * responder starts investigating it (see startResponse).
   *
   * The incident is judged and locked first (see lockActive: 404, then 409),
   * then the resolution against the status and responders read under that
   * lock, and only then the team a body names, so a foreign incident reveals
   * nothing about the body. Judged under the lock, a resolution cannot race a
   * response: a responder starting first is seen investigating, and one
   * starting after is told the incident is resolved. Of two concurrent
   * resolutions, the second waits on the row, then is told the incident is
   * resolved. resolvedAt is written exactly once; the update itself still
   * re-asserts that the incident is unresolved.
   *
   * A severity, status, or responsible team that actually changes is
   * recorded on the timeline in the same transaction, attributed to the
   * acting member. The previous value is read, and the entry timestamped,
   * under the row lock, so concurrent changes each record a true "from" and
   * appear in the order they applied. A team change records both teams'
   * names as they are now: reassigning changes who may start investigating,
   * and the timeline keeps that history however the teams are renamed later.
   * Reassigning leaves existing responders as they are.
   */
  async update(
    organizationId: string,
    incidentNumber: string,
    input: UpdateIncidentRequest,
    actor: IncidentReader,
  ): Promise<IncidentDetailResponse> {
    const number = parseIncidentNumber(incidentNumber);

    if (number === undefined) {
      throw incidentNotFound();
    }

    const resolving = input.status === 'RESOLVED';
    let incident;

    try {
      incident = await this.prisma.$transaction(async (tx) => {
        const incidentId = await this.lockActive(
          tx,
          organizationId,
          actor,
          number,
        );
        const now = new Date();
        const before = await tx.incident.findFirstOrThrow({
          where: { id: incidentId, organizationId },
          select: {
            severity: true,
            status: true,
            serviceId: true,
            knownIssueId: true,
            team: { select: { id: true, name: true } },
          },
        });

        // Correcting which known issue it is: one of its own service's, and
        // not an archived one unless it is already the one linked.
        if (input.knownIssueId) {
          const chosen = await tx.knownIssue.findFirst({
            where: {
              id: input.knownIssueId,
              organizationId,
              serviceId: before.serviceId,
            },
            select: { archivedAt: true },
          });

          if (!chosen) throw knownIssueNotFound();
          if (
            chosen.archivedAt !== null &&
            input.knownIssueId !== before.knownIssueId
          ) {
            throw knownIssueArchived();
          }
        }

        if (resolving) {
          // lockActive has refused a resolved incident, so this is DECLARED
          // or INVESTIGATING.
          if (before.status !== 'INVESTIGATING') {
            throw invalidStatusTransition(before.status, 'RESOLVED');
          }

          // Counted under the row lock, which a responder starting also
          // takes, so none can start between this count and the resolution.
          const investigating = await tx.incidentResponder.count({
            where: { organizationId, incidentId, status: 'INVESTIGATING' },
          });

          if (investigating > 0) {
            throw respondersStillInvestigating(investigating);
          }
        }

        const team =
          input.teamId !== undefined
            ? await this.requireTeam(tx, organizationId, input.teamId)
            : undefined;

        const changes = [
          ...(input.severity !== undefined && input.severity !== before.severity
            ? [
                {
                  type: 'SEVERITY_CHANGED' as const,
                  fromValue: before.severity,
                  toValue: input.severity,
                },
              ]
            : []),
          // The only status a change can name is RESOLVED, so this is the
          // resolution, and its entry carries the note.
          ...(input.status !== undefined && input.status !== before.status
            ? [
                {
                  type: 'STATUS_CHANGED' as const,
                  fromValue: before.status,
                  toValue: input.status,
                  message: input.resolution ?? null,
                },
              ]
            : []),
          ...(team !== undefined && team.id !== before.team.id
            ? [
                {
                  type: 'TEAM_CHANGED' as const,
                  fromValue: before.team.name,
                  toValue: team.name,
                },
              ]
            : []),
        ];

        // A new team's response is decided afresh. Whoever already started
        // keeps their response; being assigned was about the old team.
        const newTeam = team !== undefined && team.id !== before.team.id;

        if (newTeam) {
          await tx.incidentAssignee.deleteMany({
            where: { organizationId, incidentId },
          });
        }

        // Looked up only when there is a change to attribute.
        const actorId =
          changes.length > 0
            ? await this.resolveActor(tx, organizationId, actor.membershipId)
            : undefined;

        const updated = await tx.incident.update({
          where: {
            organizationId_number: { organizationId, number },
            status: { not: 'RESOLVED' },
            organization: { deletedAt: null },
          },
          data: {
            title: input.title,
            summary: input.summary,
            severity: input.severity,
            // Changing the severity settles it, suggested or not.
            severityConfirmed: input.severity !== undefined ? true : undefined,
            status: input.status,
            teamId: input.teamId,
            knownIssueId: input.knownIssueId,
            responseAccess: newTeam ? INITIAL_RESPONSE_ACCESS : undefined,
            resolvedAt: resolving ? now : undefined,
            resolution: resolving ? input.resolution : undefined,
          },
          select: incidentDetailSelection,
        });

        if (actorId !== undefined) {
          // Returned so each entry's notifications can name it. Matched by
          // type, which is unique within one change, rather than by the
          // order the rows come back in.
          const entries = await tx.incidentActivity.createManyAndReturn({
            data: changes.map((change) => ({
              organizationId,
              incidentId,
              actorId,
              ...change,
              createdAt: now,
            })),
            select: { id: true, type: true, createdAt: true },
          });

          // Every entry is its own event, judged against the incident as
          // it now stands: a severity and a team changed together are
          // reported separately, each to its own recipients.
          await this.notifications.incidentActivities(tx, {
            organizationId,
            incidentId,
            teamId: updated.team.id,
            actor: { userId: actorId, membershipId: actor.membershipId },
            events: entries.map((entry) => ({
              type: notifiedBy(entry.type),
              activityId: entry.id,
              createdAt: entry.createdAt,
            })),
          });
        }

        return updated;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === RECORD_NOT_FOUND
      ) {
        // Matched nothing between the read and the write: resolved by a
        // concurrent request, or its organization deleted. Read again to say
        // which.
        throw (await this.isResolved(organizationId, number))
          ? incidentResolved()
          : incidentNotFound();
      }

      // The team was deleted between its lookup and the write: the answer
      // the lookup would have given.
      const foreignKey = foreignKeyViolationHint(error);

      if (foreignKey !== undefined && violatesTeamKey(foreignKey)) {
        throw teamNotFound();
      }

      throw error;
    }

    const changed = Object.entries(input)
      .filter(([, value]) => value !== undefined)
      .map(([field]) => field);

    this.logger.log('Incident updated', {
      incidentId: incident.id,
      incidentNumber: incident.number,
      changed,
      ...(input.severity !== undefined && { severity: incident.severity }),
      ...(input.status !== undefined && { status: incident.status }),
      ...(input.teamId !== undefined && { teamId: incident.team.id }),
    });

    if (resolving) {
      this.logger.log('Incident resolved', {
        incidentId: incident.id,
        incidentNumber: incident.number,
        severity: incident.severity,
      });
    }

    return toIncidentDetailResponse(incident);
  }

  /**
   * The caller starts investigating an active incident: their own response,
   * as INVESTIGATING, recorded on the timeline. The first response to start
   * also moves a DECLARED incident to INVESTIGATING — nobody moves it by hand.
   *
   * Only a member of the incident's current responsible team may start: 403
   * NOT_ON_RESPONSIBLE_TEAM otherwise, the Admin included — while the incident
   * is open to its team. An assigned incident admits only the people assigned
   * (403 NOT_ASSIGNED_TO_INCIDENT), and one the Admin has not decided admits
   * nobody (409 RESPONSE_NOT_OPEN). Starting again
   * while investigating changes and records nothing, whatever team the
   * caller is on now — their response is under way. Starting again after
   * completing is 409 RESPONSE_ALREADY_COMPLETED: a completed response is
   * final.
   *
   * One transaction under the incident's row lock (see lockActive: 404, then
   * 409 for a resolved incident), so concurrent starts take turns: the first
   * moves the status, and the next finds it INVESTIGATING and only adds its
   * responder. A resolution cannot slip between them either — it takes the
   * same lock. The status moves by a write conditional on DECLARED, and the
   * change is recorded only if that write moved it. The one-response-per-
   * member index is the backstop against a duplicate.
   */
  async startResponse(
    organizationId: string,
    incidentNumber: string,
    actor: IncidentReader,
  ): Promise<IncidentDetailResponse> {
    const number = parseIncidentNumber(incidentNumber);

    if (number === undefined) {
      throw incidentNotFound();
    }

    const { incident, started, statusChanged } = await this.prisma.$transaction(
      async (tx) => {
        const incidentId = await this.lockActive(
          tx,
          organizationId,
          actor,
          number,
        );
        const actorId = await this.resolveActor(
          tx,
          organizationId,
          actor.membershipId,
        );
        const existing = await this.ownResponse(
          tx,
          organizationId,
          incidentId,
          actor.membershipId,
        );

        if (existing?.status === 'COMPLETED') {
          throw responseAlreadyCompleted();
        }

        let started = false;
        let statusChanged = false;

        if (!existing) {
          // Not someone whose removal is committing: see lockActiveMembership.
          if (
            !(await lockActiveMembership(
              tx,
              organizationId,
              actor.membershipId,
            ))
          ) {
            throw organizationNotFound();
          }

          await this.requireMayStart(
            tx,
            organizationId,
            incidentId,
            actor.membershipId,
          );

          const now = new Date();

          // Scalar ids, not nested connects: every relation shares
          // organizationId, and it is that shared column the keys check.
          await tx.incidentResponder.create({
            data: {
              organizationId,
              incidentId,
              membershipId: actor.membershipId,
              startedAt: now,
            },
            select: { id: true },
          });

          const { count } = await tx.incident.updateMany({
            where: { id: incidentId, organizationId, status: 'DECLARED' },
            data: { status: 'INVESTIGATING' },
          });

          statusChanged = count === 1;
          started = true;

          await tx.incidentActivity.createMany({
            data: [
              {
                organizationId,
                incidentId,
                actorId,
                type: 'RESPONSE_STARTED' as const,
                createdAt: now,
              },
              // A millisecond after the response that caused it, so the
              // timeline reads in cause-and-effect order however the ids sort.
              ...(statusChanged
                ? [
                    {
                      organizationId,
                      incidentId,
                      actorId,
                      type: 'STATUS_CHANGED' as const,
                      fromValue: 'DECLARED',
                      toValue: 'INVESTIGATING',
                      createdAt: new Date(now.getTime() + 1),
                    },
                  ]
                : []),
            ],
          });
        }

        return {
          incident: await tx.incident.findFirstOrThrow({
            where: { id: incidentId, organizationId },
            select: incidentDetailSelection,
          }),
          started,
          statusChanged,
        };
      },
    );

    if (started) {
      this.logger.log('Incident response started', {
        incidentId: incident.id,
        incidentNumber: incident.number,
        membershipId: actor.membershipId,
        ...(statusChanged && { status: incident.status }),
      });
    }

    return toIncidentDetailResponse(incident);
  }

  /**
   * The Admin chooses who may respond to an active incident: its responsible
   * team, or the people named, from any team. Replaces whatever was chosen;
   * see nextResponseAccess for who stays. A choice that changes nothing writes
   * and records nothing, and a changed one is one timeline entry. Under the
   * incident's row lock, so a member starting cannot slip between the choice
   * being read and written.
   */
  async setResponseAccess(
    organizationId: string,
    incidentNumber: string,
    input: SetIncidentResponseAccessRequest,
    actor: IncidentReader,
  ): Promise<IncidentDetailResponse> {
    const number = parseIncidentNumber(incidentNumber);

    if (number === undefined) {
      throw incidentNotFound();
    }

    const { incident, changed, confirming } = await this.prisma.$transaction(
      async (tx) => {
        const incidentId = await this.lockActive(
          tx,
          organizationId,
          actor,
          number,
        );
        const current = await tx.incident.findFirstOrThrow({
          where: { id: incidentId, organizationId },
          select: {
            teamId: true,
            severity: true,
            severityConfirmed: true,
            responseAccess: true,
            assignees: { select: { membershipId: true } },
            responders: { select: { membershipId: true, status: true } },
          },
        });
        const next = nextResponseAccess(current, input);
        for (const id of next.assigneeIds) {
          if (!(await lockActiveMembership(tx, organizationId, id))) {
            throw membershipNotFound();
          }
        }

        const people = await tx.membership.findMany({
          where: { organizationId, id: { in: next.assigneeIds } },
          select: { id: true, role: true, user: { select: { name: true } } },
        });

        if (people.length !== next.assigneeIds.length) {
          throw membershipNotFound();
        }

        const before = new Set(current.assignees.map((a) => a.membershipId));

        // Only someone who works responses can be newly assigned. One who was
        // assigned before their role changed stays, as a responder whose
        // team moves keeps their response.
        if (
          people.some(
            (p) =>
              !before.has(p.id) &&
              !hasPermission(p.role, Permission.RESPONSES_WORK),
          )
        ) {
          throw assigneeCannotRespond();
        }

        // A settled severity is changed in the incident, where everyone
        // working it is told; this decision only settles a suggested one.
        if (
          current.severityConfirmed &&
          input.severity !== undefined &&
          input.severity !== current.severity
        ) {
          throw severityAlreadyConfirmed();
        }

        // Deciding who responds settles a suggested severity: kept, or the
        // one the decision names. Recorded before the decision itself, and
        // told to whoever suggested it.
        const confirming =
          !current.severityConfirmed && next.responseAccess !== 'PENDING';

        if (confirming) {
          const actorId = await this.resolveActor(
            tx,
            organizationId,
            actor.membershipId,
          );
          const severity = input.severity ?? current.severity;

          await tx.incident.update({
            where: { id: incidentId },
            data: { severity, severityConfirmed: true },
            select: { id: true },
          });
          const confirmed = await tx.incidentActivity.create({
            data: {
              organizationId,
              incidentId,
              actorId,
              type: 'SEVERITY_CONFIRMED',
              fromValue: current.severity,
              toValue: severity,
              createdAt: new Date(),
            },
            select: { id: true, createdAt: true },
          });

          await this.notifications.incidentActivities(tx, {
            organizationId,
            incidentId,
            teamId: current.teamId,
            actor: { userId: actorId, membershipId: actor.membershipId },
            events: [
              {
                type: 'INCIDENT_SEVERITY_CONFIRMED',
                activityId: confirmed.id,
                createdAt: confirmed.createdAt,
              },
            ],
          });
        }

        const changed =
          current.responseAccess !== next.responseAccess ||
          before.size !== next.assigneeIds.length ||
          next.assigneeIds.some((id) => !before.has(id));

        if (changed) {
          const actorId = await this.resolveActor(
            tx,
            organizationId,
            actor.membershipId,
          );
          const now = new Date();
          const named = new Map(people.map((p) => [p.id, p.user.name]));

          // Everyone who stays keeps when they were assigned.
          await tx.incidentAssignee.deleteMany({
            where: {
              organizationId,
              incidentId,
              membershipId: { notIn: next.assigneeIds },
            },
          });
          await tx.incidentAssignee.createMany({
            data: next.assigneeIds
              .filter((id) => !before.has(id))
              .map((membershipId) => ({
                organizationId,
                incidentId,
                membershipId,
                assignedAt: now,
              })),
          });
          await tx.incident.update({
            where: { id: incidentId },
            data: { responseAccess: next.responseAccess },
            select: { id: true },
          });
          const entry = await tx.incidentActivity.create({
            data: {
              organizationId,
              incidentId,
              actorId,
              type: 'RESPONSE_ACCESS_CHANGED',
              fromValue: current.responseAccess,
              toValue: next.responseAccess,
              message:
                next.assigneeIds.map((id) => named.get(id)).join(', ') || null,
              createdAt: now,
            },
            select: { id: true, createdAt: true },
          });
          const newAssigneeIds = next.assigneeIds.filter(
            (id) => !before.has(id),
          );

          // Whoever may now start is told so: the whole team when it was just
          // opened to them, otherwise only the people just assigned.
          const opened =
            next.responseAccess === 'OPEN' && current.responseAccess !== 'OPEN';
          const type = opened
            ? ('INCIDENT_OPENED_TO_TEAM' as const)
            : newAssigneeIds.length > 0
              ? ('INCIDENT_ASSIGNED' as const)
              : undefined;

          if (type) {
            await this.notifications.incidentActivities(tx, {
              organizationId,
              incidentId,
              teamId: current.teamId,
              actor: { userId: actorId, membershipId: actor.membershipId },
              events: [
                { type, activityId: entry.id, createdAt: entry.createdAt },
              ],
              newAssigneeIds,
            });
          }
        }

        return {
          incident: await tx.incident.findFirstOrThrow({
            where: { id: incidentId, organizationId },
            select: incidentDetailSelection,
          }),
          changed,
          confirming,
        };
      },
    );

    if (confirming) {
      this.logger.log('Incident severity confirmed', {
        incidentId: incident.id,
        incidentNumber: incident.number,
        severity: incident.severity,
      });
    }

    if (changed) {
      this.logger.log('Incident response access changed', {
        incidentId: incident.id,
        incidentNumber: incident.number,
        responseAccess: incident.responseAccess,
        assignees: incident.assignees.length,
      });
    }

    return toIncidentDetailResponse(incident);
  }

  /**
   * The caller marks their own response to an active incident complete:
   * INVESTIGATING → COMPLETED, with its completion time, recorded on the
   * timeline. It resolves nothing — the Admin resolves the incident, once no
   * responder is investigating.
   *
   * Only the caller's own response, found by their membership; there is no
   * way to name anyone else's. Their response governs this, not the team: a
   * responder whose incident was reassigned finishes what they started.
   * Completing again changes and records nothing; completing a response
   * never started is 409 NOT_INVESTIGATING. A resolved incident is 409, as
   * for every change (see lockActive).
   */
  async completeResponse(
    organizationId: string,
    incidentNumber: string,
    actor: IncidentReader,
  ): Promise<IncidentDetailResponse> {
    const number = parseIncidentNumber(incidentNumber);

    if (number === undefined) {
      throw incidentNotFound();
    }

    const { incident, completed } = await this.prisma.$transaction(
      async (tx) => {
        const incidentId = await this.lockActive(
          tx,
          organizationId,
          actor,
          number,
        );
        const actorId = await this.resolveActor(
          tx,
          organizationId,
          actor.membershipId,
        );
        const existing = await this.ownResponse(
          tx,
          organizationId,
          incidentId,
          actor.membershipId,
        );

        if (!existing) {
          throw notInvestigating();
        }

        let entry: { id: string; createdAt: Date } | undefined;

        if (existing.status === 'INVESTIGATING') {
          const now = new Date();

          await tx.incidentResponder.update({
            where: { id: existing.id },
            data: { status: 'COMPLETED', completedAt: now },
            select: { id: true },
          });
          entry = await tx.incidentActivity.create({
            data: {
              organizationId,
              incidentId,
              actorId,
              type: 'RESPONSE_COMPLETED',
              createdAt: now,
            },
            select: { id: true, createdAt: true },
          });
        }

        const incident = await tx.incident.findFirstOrThrow({
          where: { id: incidentId, organizationId },
          select: incidentDetailSelection,
        });

        // This completion was the last response under way: the incident is
        // now ready to resolve, judged by the rule attention uses, on the
        // responders read under the row lock every start and completion
        // takes. Of two completing at once, only the second sees none left.
        if (entry && readyToResolve(incident)) {
          await this.notifications.incidentActivities(tx, {
            organizationId,
            incidentId,
            teamId: incident.team.id,
            actor: { userId: actorId, membershipId: actor.membershipId },
            events: [
              {
                type: 'INCIDENT_READY_TO_RESOLVE',
                activityId: entry.id,
                createdAt: entry.createdAt,
              },
            ],
          });
        }

        return { incident, completed: entry !== undefined };
      },
    );

    if (completed) {
      this.logger.log('Incident response completed', {
        incidentId: incident.id,
        incidentNumber: incident.number,
        membershipId: actor.membershipId,
      });
    }

    return toIncidentDetailResponse(incident);
  }

  /**
   * The incident's timeline, oldest first: operational updates and recorded
   * lifecycle changes. Unpaged, and readable whether or not the incident is
   * resolved. Only for an incident the reader may see, as `get`.
   */
  async timeline(
    organizationId: string,
    reader: IncidentReader,
    incidentNumber: string,
  ): Promise<IncidentActivityResponse[]> {
    const number = parseIncidentNumber(incidentNumber);

    if (number === undefined) {
      throw incidentNotFound();
    }

    const incident = await this.prisma.incident.findFirst({
      where: withinIncidentScope(organizationId, reader, { number }),
      select: {
        activity: {
          select: activitySelection,
          // The two entries of one change share a timestamp; the id breaks
          // the tie.
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
      },
    });

    if (!incident) {
      throw incidentNotFound();
    }

    // Each actor's role here now, read once for the whole timeline. Someone
    // who has left the organization — removed by the Admin — has none.
    const memberships = await this.prisma.membership.findMany({
      where: {
        organizationId,
        removedAt: null,
        userId: { in: [...new Set(incident.activity.map((a) => a.actor.id))] },
      },
      select: { userId: true, role: true },
    });
    const roles = new Map(memberships.map((m) => [m.userId, m.role]));

    return incident.activity.map((activity) =>
      toIncidentActivityResponse(
        activity,
        roles.get(activity.actor.id) ?? null,
      ),
    );
  }

  /**
   * Posts an operational update to an active incident's timeline, attributed
   * to the acting member. A resolved incident is not changed, and that
   * includes its timeline: 409.
   *
   * An update is part of a response. A member may post only while their own
   * response to the incident is INVESTIGATING: one who has not started is
   * refused with 403 START_INVESTIGATING_FIRST, and one who has completed
   * with 409 RESPONSE_ALREADY_COMPLETED; nothing is written. Their response
   * governs this, not their team, so a responder keeps posting after a
   * reassignment. Whoever runs the incident's lifecycle — `incidents:manage`,
   * the Admin — oversees every incident and may post to any without
   * responding. The role is the caller's admitted one, passed in explicitly,
   * and judged by the same role table the guards use.
   *
   * The incident is judged and locked first (see lockActive: 404, then 409),
   * which orders the post against a concurrent resolution, and only then the
   * caller's response, so a foreign incident reveals nothing. The message is
   * free text and is never logged.
   */
  async postUpdate(
    organizationId: string,
    incidentNumber: string,
    input: PostIncidentUpdateRequest,
    actor: { membershipId: string; role: Role },
  ): Promise<IncidentActivityResponse> {
    const number = parseIncidentNumber(incidentNumber);

    if (number === undefined) {
      throw incidentNotFound();
    }

    const activity = await this.prisma.$transaction(async (tx) => {
      const incidentId = await this.lockActive(
        tx,
        organizationId,
        actor,
        number,
      );
      const actorId = await this.resolveActor(
        tx,
        organizationId,
        actor.membershipId,
      );

      // Whoever decides posts on any incident, and whoever declared one on
      // theirs. Everyone else posts while their own response is under way.
      if (
        !hasPermission(actor.role, Permission.INCIDENTS_MANAGE) &&
        !(await this.declaredBy(tx, organizationId, incidentId, actorId))
      ) {
        const response = await this.ownResponse(
          tx,
          organizationId,
          incidentId,
          actor.membershipId,
        );

        if (!response) {
          throw startInvestigatingFirst();
        }

        if (response.status === 'COMPLETED') {
          throw responseAlreadyCompleted();
        }
      }

      return tx.incidentActivity.create({
        data: {
          organizationId,
          incidentId,
          type: 'UPDATE',
          actorId,
          message: input.message,
          // Taken under the row lock, as update() does, so the timeline shows
          // the order in which things applied.
          createdAt: new Date(),
        },
        select: { ...activitySelection, incidentId: true },
      });
    });

    this.logger.log('Incident update posted', {
      incidentId: activity.incidentId,
      incidentNumber: number,
      activityId: activity.id,
    });

    return toIncidentActivityResponse(activity, actor.role);
  }

  /**
   * The user behind the acting membership, within this organization: who a
   * declaration or a timeline entry is attributed to. A grant gone since
   * admission is answered as admission would now answer it.
   */
  private async resolveActor(
    tx: Prisma.TransactionClient,
    organizationId: string,
    membershipId: string,
  ): Promise<string> {
    const membership = await tx.membership.findFirst({
      where: {
        id: membershipId,
        organizationId,
        user: { deletedAt: null },
      },
      select: { userId: true },
    });

    if (!membership) {
      throw organizationNotFound();
    }

    return membership.userId;
  }

  /**
   * Allocates the organization's next incident number, which also proves the
   * organization is still active and holds its row until commit.
   *
   * Numbers are unique, never reused, and increase in the order declarations
   * commit. A declaration that fails rolls its increment back with it, but
   * gaplessness is not something anything relies on.
   */
  private async allocateNumber(
    tx: Prisma.TransactionClient,
    organizationId: string,
  ): Promise<number> {
    try {
      const organization = await tx.organization.update({
        where: { id: organizationId, deletedAt: null },
        data: { lastIncidentNumber: { increment: 1 } },
        select: { lastIncidentNumber: true },
      });

      return organization.lastIncidentNumber;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === RECORD_NOT_FOUND
      ) {
        throw organizationNotFound();
      }

      throw error;
    }
  }

  /**
   * The service's owner and archival state, read under a shared row lock
   * that lasts until the transaction ends — or null when the organization has
   * no such service.
   *
   * Raw SQL for one reason: Prisma's query API cannot express a locking read
   * (`FOR SHARE`). `FOR SHARE` rather than `FOR KEY SHARE`, which a foreign
   * key takes anyway: KEY SHARE does not block an UPDATE of a non-key column,
   * and owner_team_id and archived_at are exactly the columns that must not
   * change until the incident is committed. `FOR SHARE` still lets other
   * declarations share the lock. Parameterized by the tagged template; the
   * organization is part of the predicate, as in every other query.
   */
  private async lockService(
    tx: Prisma.TransactionClient,
    organizationId: string,
    serviceId: string,
  ): Promise<{ ownerTeamId: string; archivedAt: Date | null } | null> {
    const [service] = await tx.$queryRaw<
      { owner_team_id: string; archived_at: Date | null }[]
    >`
      SELECT owner_team_id, archived_at
      FROM services
      WHERE organization_id = ${organizationId}::uuid
        AND id = ${serviceId}::uuid
      FOR SHARE
    `;

    return service
      ? { ownerTeamId: service.owner_team_id, archivedAt: service.archived_at }
      : null;
  }

  /**
   * The team, which exists in this organization, or 404 TEAM_NOT_FOUND — the
   * same answer for a missing team and for another organization's.
   */
  private async requireTeam(
    tx: Prisma.TransactionClient,
    organizationId: string,
    teamId: string,
  ): Promise<{ id: string; name: string }> {
    const team = await tx.team.findFirst({
      where: {
        id: teamId,
        organizationId,
        organization: { deletedAt: null },
      },
      select: { id: true, name: true },
    });

    if (!team) {
      throw teamNotFound();
    }

    return team;
  }

  /**
   * The caller's own response to the incident, or null when they have not
   * started one. Scoped by organization, like every query.
   */
  /** Whether the user behind the acting membership declared the incident. */
  private async declaredBy(
    tx: Prisma.TransactionClient,
    organizationId: string,
    incidentId: string,
    userId: string,
  ): Promise<boolean> {
    const incident = await tx.incident.findFirst({
      where: { id: incidentId, organizationId, createdById: userId },
      select: { id: true },
    });

    return incident !== null;
  }

  private async ownResponse(
    tx: Prisma.TransactionClient,
    organizationId: string,
    incidentId: string,
    membershipId: string,
  ): Promise<{ id: string; status: 'INVESTIGATING' | 'COMPLETED' } | null> {
    return tx.incidentResponder.findFirst({
      where: { organizationId, incidentId, membershipId },
      select: { id: true, status: true },
    });
  }

  /**
   * The acting member is on the incident's responsible team, or 403
   * NOT_ON_RESPONSIBLE_TEAM.
   *
   * Called while the caller holds the incident's row lock (see lockActive),
   * so the responsible team read here is the one the incident has until the
   * transaction ends: a reassignment racing this waits for it, or has
   * already committed and is what is judged. One query, joining the incident
   * to its team's members.
   */
  private async requireMayStart(
    tx: Prisma.TransactionClient,
    organizationId: string,
    incidentId: string,
    membershipId: string,
  ): Promise<void> {
    const incident = await tx.incident.findFirstOrThrow({
      where: { id: incidentId, organizationId },
      select: {
        responseAccess: true,
        assignees: { where: { membershipId }, select: { id: true } },
        team: {
          select: {
            memberships: { where: { membershipId }, select: { id: true } },
          },
        },
      },
    });

    switch (
      startRefusal({
        responseAccess: incident.responseAccess,
        onResponsibleTeam: incident.team.memberships.length > 0,
        assigned: incident.assignees.length > 0,
      })
    ) {
      case 'awaiting-decision':
        throw responseNotOpen();
      case 'not-assigned':
        throw notAssignedToIncident();
      case 'not-on-team':
        throw notOnResponsibleTeam();
      case null:
    }
  }

  /**
   * Judges the incident for a change — 404, then 409 — and holds its row
   * until the transaction ends. Returns its id.
   *
   * Only an incident the actor may see (see incidents.scope.ts) is found:
   * one outside their scope is 404, like a missing one, before its status
   * or any rule of the change is judged — so neither a 409 nor the change's
   * own 403 can tell a member that it exists. Visibility is the only thing
   * judged here; whether the actor may make the change is still each
   * caller's own rule, applied after this.
   *
   * The pattern update() follows: a read to answer precisely, then a write
   * whose own predicate re-asserts that the incident is unresolved. Here the
   * write only touches updatedAt — an operational update is part of the
   * incident, so posting one is a change to it — and its row lock orders
   * this change against a resolution, a reassignment, or a response
   * starting. If the resolution
   * commits first, this write re-evaluates its predicate, matches nothing,
   * and the caller is told the incident is resolved; if this commits first,
   * the resolution waits and follows it. Either way nothing is added to a
   * resolved incident, and whatever is read of the incident after this —
   * its responsible team — holds until commit.
   */
  private async lockActive(
    tx: Prisma.TransactionClient,
    organizationId: string,
    actor: IncidentReader,
    number: number,
  ): Promise<string> {
    const current = await tx.incident.findFirst({
      where: withinIncidentScope(organizationId, actor, { number }),
      select: { id: true, status: true },
    });

    if (!current) {
      throw incidentNotFound();
    }

    if (current.status === 'RESOLVED') {
      throw incidentResolved();
    }

    const { count } = await tx.incident.updateMany({
      where: { id: current.id, organizationId, status: { not: 'RESOLVED' } },
      data: { updatedAt: new Date() },
    });

    if (count !== 1) {
      throw incidentResolved();
    }

    return current.id;
  }

  private async isResolved(
    organizationId: string,
    number: number,
  ): Promise<boolean> {
    const incident = await this.prisma.incident.findFirst({
      where: { organizationId, number, organization: { deletedAt: null } },
      select: { status: true },
    });

    return incident?.status === 'RESOLVED';
  }
}
