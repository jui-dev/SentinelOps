import { Injectable, Logger } from '@nestjs/common';

import { Permission } from '../authorization/permissions.js';
import { hasPermission } from '../authorization/role-permissions.js';
import { PrismaService } from '../database/prisma.service.js';
import { foreignKeyViolationHint } from '../database/foreign-key-violation.js';
import { Prisma } from '../generated/prisma/client.js';
import type { Role } from '../generated/prisma/enums.js';
import { membershipNotFound } from '../organizations/organizations.errors.js';
import {
  serviceArchived,
  serviceNotFound,
} from '../services/services.errors.js';
import { teamNotFound } from '../teams/teams.errors.js';
import { organizationNotFound } from '../tenancy/tenancy.errors.js';
import { isResourceId } from '../tenancy/tenancy.schemas.js';
import { buildActivityCalendar } from './incidents.activity.js';
import { classifyAttention } from './incidents.attention.js';
import { buildMemberActivityCalendar } from './member-activity.js';
import type {
  IncidentActivityResponse,
  IncidentAttentionResponse,
  IncidentDetailResponse,
  IncidentPage,
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
  notInvestigating,
  notOnResponsibleTeam,
  respondersStillInvestigating,
  responseAlreadyCompleted,
  startInvestigatingFirst,
} from './incidents.errors.js';
import {
  toIncidentActivityResponse,
  toIncidentAttentionResponse,
  toIncidentDetailResponse,
  toIncidentResponse,
  toIncidentSummaryResponse,
  toMemberActivityResponse,
  toMemberResponseResponse,
  toOperationalActivityResponse,
} from './incidents.responses.js';
import { mergeHistory } from './incidents.history.js';
import {
  parseIncidentNumber,
  searchedIncidentNumber,
  summaryBounds,
} from './incidents.schemas.js';
import type {
  CreateIncidentRequest,
  IncidentActivityQuery,
  IncidentSummaryQuery,
  ListIncidentsQuery,
  MemberResponsesQuery,
  PostIncidentUpdateRequest,
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

/** A LIKE pattern matching `text` literally: Postgres escapes with `\`. */
const escapeLike = (text: string): string =>
  text.replace(/[\\%_]/g, '\\$&');

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
): Prisma.IncidentWhereInput => {
  const number = query.q ? searchedIncidentNumber(query.q) : undefined;

  return {
    ...(query.severity && { severity: query.severity }),
    ...(query.serviceId && { serviceId: query.serviceId }),
    ...(query.teamId && { teamId: query.teamId }),
    ...(query.q && {
      AND: [
        {
          OR: [
            { title: { contains: escapeLike(query.q), mode: 'insensitive' } },
            ...(number !== undefined ? [{ number }] : []),
          ],
        },
      ],
    }),
  };
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
const incidentSelection = {
  id: true,
  number: true,
  title: true,
  summary: true,
  severity: true,
  status: true,
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
} as const;

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
      membership: { select: { id: true, user: { select: { name: true } } } },
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
 * Titles, summaries, and update messages are free text and may carry
 * customer or system details, so they are never logged. Ids, numbers, and
 * enum values are.
 */
@Injectable()
export class IncidentsService {
  private readonly logger = new Logger(IncidentsService.name);

  constructor(private readonly prisma: PrismaService) {}

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
   */
  async list(
    organizationId: string,
    query: ListIncidentsQuery,
  ): Promise<IncidentPage> {
    const scope = { organizationId, organization: { deletedAt: null } };
    // A period narrows each state by the moment that defines it.
    const period =
      query.from && query.to
        ? summaryBounds({ from: query.from, to: query.to })
        : undefined;
    const filters = listFilters(query);
    let rows;

    if (query.state === 'active') {
      const after = query.cursor ? decodeActiveCursor(query.cursor) : undefined;

      rows = await this.prisma.incident.findMany({
        where: {
          ...scope,
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
        },
        select: incidentSelection,
        orderBy: [{ severity: 'asc' }, { number: 'asc' }],
        take: INCIDENT_PAGE_SIZE + 1,
      });
    } else {
      const before = query.cursor
        ? decodeResolvedCursor(query.cursor)
        : undefined;

      rows = await this.prisma.incident.findMany({
        where: {
          ...scope,
          status: 'RESOLVED',
          ...(period && { resolvedAt: period }),
          ...filters,
          ...(before !== undefined && { number: { lt: before } }),
        },
        select: incidentSelection,
        orderBy: { number: 'desc' },
        take: INCIDENT_PAGE_SIZE + 1,
      });
    }

    const hasMore = rows.length > INCIDENT_PAGE_SIZE;
    const items = rows.slice(0, INCIDENT_PAGE_SIZE);
    const last = items.at(-1);

    return {
      items: items.map(toIncidentResponse),
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
   * The membership is resolved within the organization first: a malformed,
   * missing, or foreign one is 404 MEMBERSHIP_NOT_FOUND, identically. Keyset
   * pages over (startedAt, id) — the id a UUIDv7, breaking a tie — served by
   * the (membership_id, started_at) index. The incidents are the lists'
   * shape, with no responders or resolution.
   */
  async memberResponses(
    organizationId: string,
    membershipId: string,
    query: MemberResponsesQuery,
  ): Promise<MemberResponsePage> {
    if (!isResourceId(membershipId)) {
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

    const after = query.cursor
      ? decodeResponseCursor(query.cursor)
      : undefined;

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
   * Counts, not pages: every figure covers every incident it describes. The
   * reads share one repeatable-read snapshot, so the figures and the history
   * agree with each other even while incidents change. Active incidents are
   * grouped by service and severity in one query, which gives the
   * organization's counts and each affected service's. The history previews
   * the most recent incidents declared or resolved in the period.
   */
  async summary(
    organizationId: string,
    query: IncidentSummaryQuery,
  ): Promise<IncidentSummaryResponse> {
    const scope = { organizationId, organization: { deletedAt: null } };
    const unresolved = { status: { not: 'RESOLVED' as const } };
    const period = summaryBounds(query);

    const declaredInPeriod = { ...scope, createdAt: period };
    const resolvedInPeriod = {
      ...scope,
      status: 'RESOLVED' as const,
      resolvedAt: period,
    };

    const [
      active,
      services,
      declared,
      resolved,
      stillOpen,
      bothInPeriod,
      declaredRecently,
      resolvedRecently,
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
      ],
      { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
    );

    return toIncidentSummaryResponse({
      active,
      services,
      declared,
      resolved,
      stillOpen,
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
   * When the organization was operationally active, day by day, over a
   * period of whole UTC days.
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
   * When one member personally took part in incident response, day by day,
   * over a period of whole UTC days.
   *
   * The membership is resolved within the organization first, as
   * memberResponses does: a malformed, missing, or foreign one is 404
   * MEMBERSHIP_NOT_FOUND, identically, and resolving it also settles the
   * organization's soft deletion before anything is read.
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
    membershipId: string,
    query: IncidentActivityQuery,
  ): Promise<MemberActivityResponse> {
    if (!isResourceId(membershipId)) {
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
    const canRespond = hasPermission(actor.role, Permission.INCIDENTS_RESPOND);

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

  /** One incident, by its number within the organization, with its responders. */
  async get(
    organizationId: string,
    incidentNumber: string,
  ): Promise<IncidentDetailResponse> {
    const number = parseIncidentNumber(incidentNumber);

    if (number === undefined) {
      throw incidentNotFound();
    }

    const incident = await this.prisma.incident.findFirst({
      where: { organizationId, number, organization: { deletedAt: null } },
      select: incidentDetailSelection,
    });

    if (!incident) {
      throw incidentNotFound();
    }

    return toIncidentDetailResponse(incident);
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
    actor: { membershipId: string },
    input: CreateIncidentRequest,
  ): Promise<IncidentDetailResponse> {
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
            createdById: declarerId,
          },
          select: incidentDetailSelection,
        });

        await tx.incidentActivity.create({
          data: {
            organizationId,
            incidentId: created.id,
            type: 'DECLARED',
            actorId: declarerId,
            toValue: created.severity,
            createdAt: created.createdAt,
          },
          select: { id: true },
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
    actor: { membershipId: string },
  ): Promise<IncidentDetailResponse> {
    const number = parseIncidentNumber(incidentNumber);

    if (number === undefined) {
      throw incidentNotFound();
    }

    const resolving = input.status === 'RESOLVED';
    let incident;

    try {
      incident = await this.prisma.$transaction(async (tx) => {
        const incidentId = await this.lockActive(tx, organizationId, number);
        const now = new Date();
        const before = await tx.incident.findFirstOrThrow({
          where: { id: incidentId, organizationId },
          select: {
            severity: true,
            status: true,
            team: { select: { id: true, name: true } },
          },
        });

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
            status: input.status,
            teamId: input.teamId,
            resolvedAt: resolving ? now : undefined,
            resolution: resolving ? input.resolution : undefined,
          },
          select: incidentDetailSelection,
        });

        if (actorId !== undefined) {
          await tx.incidentActivity.createMany({
            data: changes.map((change) => ({
              organizationId,
              incidentId,
              actorId,
              ...change,
              createdAt: now,
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
   * NOT_ON_RESPONSIBLE_TEAM otherwise, the Admin included. Starting again
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
    actor: { membershipId: string },
  ): Promise<IncidentDetailResponse> {
    const number = parseIncidentNumber(incidentNumber);

    if (number === undefined) {
      throw incidentNotFound();
    }

    const { incident, started, statusChanged } = await this.prisma.$transaction(
      async (tx) => {
        const incidentId = await this.lockActive(tx, organizationId, number);
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
          await this.requireResponsibleTeamMember(
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
    actor: { membershipId: string },
  ): Promise<IncidentDetailResponse> {
    const number = parseIncidentNumber(incidentNumber);

    if (number === undefined) {
      throw incidentNotFound();
    }

    const { incident, completed } = await this.prisma.$transaction(
      async (tx) => {
        const incidentId = await this.lockActive(tx, organizationId, number);
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

        let completed = false;

        if (existing.status === 'INVESTIGATING') {
          const now = new Date();

          await tx.incidentResponder.update({
            where: { id: existing.id },
            data: { status: 'COMPLETED', completedAt: now },
            select: { id: true },
          });
          await tx.incidentActivity.create({
            data: {
              organizationId,
              incidentId,
              actorId,
              type: 'RESPONSE_COMPLETED',
              createdAt: now,
            },
            select: { id: true },
          });

          completed = true;
        }

        return {
          incident: await tx.incident.findFirstOrThrow({
            where: { id: incidentId, organizationId },
            select: incidentDetailSelection,
          }),
          completed,
        };
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
   * resolved.
   */
  async timeline(
    organizationId: string,
    incidentNumber: string,
  ): Promise<IncidentActivityResponse[]> {
    const number = parseIncidentNumber(incidentNumber);

    if (number === undefined) {
      throw incidentNotFound();
    }

    const incident = await this.prisma.incident.findFirst({
      where: { organizationId, number, organization: { deletedAt: null } },
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

    return incident.activity.map(toIncidentActivityResponse);
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
      const incidentId = await this.lockActive(tx, organizationId, number);
      const actorId = await this.resolveActor(
        tx,
        organizationId,
        actor.membershipId,
      );

      if (!hasPermission(actor.role, Permission.INCIDENTS_MANAGE)) {
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

    return toIncidentActivityResponse(activity);
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
  private async requireResponsibleTeamMember(
    tx: Prisma.TransactionClient,
    organizationId: string,
    incidentId: string,
    membershipId: string,
  ): Promise<void> {
    const onTeam = await tx.incident.findFirst({
      where: {
        id: incidentId,
        organizationId,
        team: { memberships: { some: { membershipId } } },
      },
      select: { id: true },
    });

    if (!onTeam) {
      throw notOnResponsibleTeam();
    }
  }

  /**
   * Judges the incident for a change — 404, then 409 — and holds its row
   * until the transaction ends. Returns its id.
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
    number: number,
  ): Promise<string> {
    const current = await tx.incident.findFirst({
      where: { organizationId, number, organization: { deletedAt: null } },
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
