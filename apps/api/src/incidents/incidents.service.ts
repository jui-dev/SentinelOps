import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import { foreignKeyViolationHint } from '../database/foreign-key-violation.js';
import { uniqueViolationHint } from '../database/unique-violation.js';
import { Prisma } from '../generated/prisma/client.js';
import { membershipNotFound } from '../organizations/organizations.errors.js';
import {
  serviceArchived,
  serviceNotFound,
} from '../services/services.errors.js';
import { teamNotFound } from '../teams/teams.errors.js';
import { organizationNotFound } from '../tenancy/tenancy.errors.js';
import { isResourceId } from '../tenancy/tenancy.schemas.js';
import type {
  IncidentDetailResponse,
  IncidentPage,
  IncidentSeverity,
} from './incidents.contract.js';
import {
  alreadyAResponder,
  incidentNotFound,
  incidentResolved,
  invalidCursor,
  responderNotFound,
} from './incidents.errors.js';
import {
  toIncidentDetailResponse,
  toIncidentResponse,
} from './incidents.responses.js';
import { parseIncidentNumber } from './incidents.schemas.js';
import type {
  AddResponderRequest,
  CreateIncidentRequest,
  ListIncidentsQuery,
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

/** A member as an incident names one: the membership id and a name. */
const incidentMemberSelection = {
  select: { id: true, user: { select: { name: true } } },
} as const;

/**
 * Columns a single incident is built from: the list's, with the lead and the
 * responders. Lists never select these, so a page stays free of the joins.
 *
 * The user's name is not filtered on deletedAt: who led or responded stays
 * true after they leave, as for the declarer.
 */
const incidentDetailSelection = {
  ...incidentSelection,
  lead: incidentMemberSelection,
  responders: {
    select: { membership: incidentMemberSelection },
    // UUIDv7: ordering by id is the order responders were added.
    orderBy: { id: 'asc' },
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
 * A composite membership key refused the row: the lead's on incidents, or
 * the responder's on incident_responders.
 */
const violatesMembershipKey = (hint: string): boolean =>
  hint.includes('membership_id') || hint.includes('membershipid');

/** Whether a unique violation came from the one-row-per-responder index. */
const isResponderConflict = (hint: string): boolean =>
  hint.includes('incident_responders_incident_id_membership_id_key') ||
  (hint.includes('incident') && hint.includes('membership'));

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
 * Title and summary are free text and may carry customer or system details,
 * so they are never logged. Ids, numbers, and enum values are.
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
   */
  async list(
    organizationId: string,
    query: ListIncidentsQuery,
  ): Promise<IncidentPage> {
    const scope = { organizationId, organization: { deletedAt: null } };
    let rows;

    if (query.state === 'active') {
      const after = query.cursor ? decodeActiveCursor(query.cursor) : undefined;

      rows = await this.prisma.incident.findMany({
        where: {
          ...scope,
          status: { not: 'RESOLVED' },
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

  /** One incident, by its number within the organization. */
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
   *   4. Insert the incident with scalar ids.
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

        const declarer = await tx.membership.findFirst({
          where: {
            id: actor.membershipId,
            organizationId,
            user: { deletedAt: null },
          },
          select: { userId: true },
        });

        if (!declarer) {
          // The caller's grant is gone since admission: the same answer
          // admission would now give.
          throw organizationNotFound();
        }

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
        return tx.incident.create({
          data: {
            organizationId,
            number,
            title: input.title,
            summary: input.summary ?? null,
            serviceId: input.serviceId,
            teamId: service.ownerTeamId,
            severity: input.severity,
            createdById: declarer.userId,
          },
          select: incidentDetailSelection,
        });
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
   * Changes an active incident: its title, summary, severity, status,
   * responsible team, or lead. `status: 'RESOLVED'` resolves it, and resolvedAt is set
   * in the same write. A resolved incident is not changed — any change to one
   * is a 409, whatever it names.
   *
   * The incident is judged first (404, then 409), and only then the team or
   * lead a body names, so a foreign incident reveals nothing about the body. The
   * update itself re-asserts that the incident is unresolved: of two
   * concurrent resolutions, the second waits on the row, then matches
   * nothing and is told the incident is resolved. resolvedAt is written
   * exactly once.
   */
  async update(
    organizationId: string,
    incidentNumber: string,
    input: UpdateIncidentRequest,
  ): Promise<IncidentDetailResponse> {
    const number = parseIncidentNumber(incidentNumber);

    if (number === undefined) {
      throw incidentNotFound();
    }

    const resolving = input.status === 'RESOLVED';
    let incident;

    try {
      incident = await this.prisma.$transaction(async (tx) => {
        const current = await tx.incident.findFirst({
          where: { organizationId, number, organization: { deletedAt: null } },
          select: { status: true },
        });

        if (!current) {
          throw incidentNotFound();
        }

        if (current.status === 'RESOLVED') {
          throw incidentResolved();
        }

        if (input.teamId !== undefined) {
          await this.requireTeam(tx, organizationId, input.teamId);
        }

        if (input.leadMembershipId) {
          await this.requireMembership(
            tx,
            organizationId,
            input.leadMembershipId,
          );
        }

        return tx.incident.update({
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
            leadMembershipId: input.leadMembershipId,
            resolvedAt: resolving ? new Date() : undefined,
          },
          select: incidentDetailSelection,
        });
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

      // The team or the lead's membership was deleted between its lookup
      // and the write: the answer the lookup would have given.
      const foreignKey = foreignKeyViolationHint(error);

      if (foreignKey !== undefined && violatesTeamKey(foreignKey)) {
        throw teamNotFound();
      }

      if (foreignKey !== undefined && violatesMembershipKey(foreignKey)) {
        throw membershipNotFound();
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
      ...(input.leadMembershipId !== undefined && {
        leadMembershipId: input.leadMembershipId,
      }),
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
   * Adds a member of the organization, from any team, to the incident's
   * responders.
   *
   * The incident is judged and locked first (see lockActive), then the
   * membership is looked up within the organization. A membership deleted
   * between that read and the insert is refused by the composite key and
   * answered with the read's 404; a concurrent add of the same member is
   * refused by the unique index and answered 409.
   */
  async addResponder(
    organizationId: string,
    incidentNumber: string,
    input: AddResponderRequest,
  ): Promise<IncidentDetailResponse> {
    const number = parseIncidentNumber(incidentNumber);

    if (number === undefined) {
      throw incidentNotFound();
    }

    let incident;

    try {
      incident = await this.prisma.$transaction(async (tx) => {
        const incidentId = await this.lockActive(tx, organizationId, number);

        await this.requireMembership(tx, organizationId, input.membershipId);

        // Scalar ids, not nested connects: both relations share
        // organizationId, and it is that shared column the keys check.
        await tx.incidentResponder.create({
          data: {
            organizationId,
            incidentId,
            membershipId: input.membershipId,
          },
          select: { id: true },
        });

        return tx.incident.findFirstOrThrow({
          where: { id: incidentId, organizationId },
          select: incidentDetailSelection,
        });
      });
    } catch (error) {
      const unique = uniqueViolationHint(error);

      if (unique !== undefined && isResponderConflict(unique)) {
        throw alreadyAResponder();
      }

      const foreignKey = foreignKeyViolationHint(error);

      if (foreignKey !== undefined && violatesMembershipKey(foreignKey)) {
        throw membershipNotFound();
      }

      throw error;
    }

    this.logger.log('Incident responder added', {
      incidentId: incident.id,
      incidentNumber: incident.number,
      membershipId: input.membershipId,
    });

    return toIncidentDetailResponse(incident);
  }

  /**
   * Takes a member off the incident's responders. They remain in the
   * organization, and remain its lead if they are.
   *
   * The incident is judged and locked first. A membership that is not
   * responding — malformed, in another organization, or simply not on it —
   * is then one 404, which also rolls back lockActive's touch of updatedAt.
   */
  async removeResponder(
    organizationId: string,
    incidentNumber: string,
    membershipId: string,
  ): Promise<void> {
    const number = parseIncidentNumber(incidentNumber);

    if (number === undefined) {
      throw incidentNotFound();
    }

    const incidentId = await this.prisma.$transaction(async (tx) => {
      const id = await this.lockActive(tx, organizationId, number);

      if (!isResourceId(membershipId)) {
        throw responderNotFound();
      }

      const { count } = await tx.incidentResponder.deleteMany({
        where: { organizationId, incidentId: id, membershipId },
      });

      if (count !== 1) {
        throw responderNotFound();
      }

      return id;
    });

    this.logger.log('Incident responder removed', {
      incidentId,
      incidentNumber: number,
      membershipId,
    });
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
   * The team exists in this organization, or 404 TEAM_NOT_FOUND — the same
   * answer for a missing team and for another organization's.
   */
  private async requireTeam(
    tx: Prisma.TransactionClient,
    organizationId: string,
    teamId: string,
  ): Promise<void> {
    const team = await tx.team.findFirst({
      where: {
        id: teamId,
        organizationId,
        organization: { deletedAt: null },
      },
      select: { id: true },
    });

    if (!team) {
      throw teamNotFound();
    }
  }

  /**
   * Judges the incident for a change to its responders — 404, then 409 — and
   * holds its row until the transaction ends. Returns its id.
   *
   * The pattern update() follows: a read to answer precisely, then a write
   * whose own predicate re-asserts that the incident is unresolved. Here the
   * write only touches updatedAt — responders are part of the incident, so a
   * change to them is a change to it — and its row lock orders this change
   * against a resolution. If the resolution commits first, this write
   * re-evaluates its predicate, matches nothing, and the caller is told the
   * incident is resolved; if this commits first, the resolution waits and
   * follows it. Either way no responder changes on a resolved incident.
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

  /**
   * The membership is a current member of this organization, or 404
   * MEMBERSHIP_NOT_FOUND — the same answer for a missing membership, one in
   * another organization, and one whose user was soft-deleted.
   */
  private async requireMembership(
    tx: Prisma.TransactionClient,
    organizationId: string,
    membershipId: string,
  ): Promise<void> {
    const membership = await tx.membership.findFirst({
      where: {
        id: membershipId,
        organizationId,
        organization: { deletedAt: null },
        user: { deletedAt: null },
      },
      select: { id: true },
    });

    if (!membership) {
      throw membershipNotFound();
    }
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
