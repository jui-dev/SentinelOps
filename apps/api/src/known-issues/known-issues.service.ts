import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import { uniqueViolationHint } from '../database/unique-violation.js';
import type { Prisma } from '../generated/prisma/client.js';
import {
  serviceArchived,
  serviceNotFound,
} from '../services/services.errors.js';
import { isResourceId } from '../tenancy/tenancy.schemas.js';
import type { KnownIssueResponse } from './known-issues.contract.js';
import {
  knownIssueMergeIntoItself,
  knownIssueNameTaken,
  knownIssueNotFound,
  knownIssueOtherService,
} from './known-issues.errors.js';
import {
  byFrequency,
  NO_OCCURRENCES,
  toKnownIssueResponse,
} from './known-issues.responses.js';
import type { Occurrences } from './known-issues.responses.js';
import type {
  CreateKnownIssueRequest,
  ListKnownIssuesQuery,
  MergeKnownIssueRequest,
  UpdateKnownIssueRequest,
} from './known-issues.schemas.js';

/** Columns a known issue response is built from. */
export const knownIssueSelection = {
  id: true,
  name: true,
  description: true,
  usualSeverity: true,
  pendingReview: true,
  archivedAt: true,
  createdAt: true,
  service: {
    select: {
      id: true,
      name: true,
      slug: true,
      ownerTeam: { select: { id: true, name: true, slug: true } },
    },
  },
} as const satisfies Prisma.KnownIssueSelect;

/** The unique (service, name) index, which a racing duplicate trips. */
const isNameConflict = (hint: string): boolean => hint.includes('name');

/**
 * An organization's known issues: what each service has had before.
 *
 * Every member may read them — declaring starts from them. Making, changing,
 * archiving and merging them is the Admin's (`services:manage`).
 *
 * Isolation as for services: every read and write names the organization,
 * and an id from another one answers exactly as a nonexistent one.
 */
@Injectable()
export class KnownIssuesService {
  private readonly logger = new Logger(KnownIssuesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every service's known issues, or one's, most frequent first. Archived
   * ones only when asked for.
   */
  async list(
    organizationId: string,
    query: ListKnownIssuesQuery,
  ): Promise<KnownIssueResponse[]> {
    const rows = await this.prisma.knownIssue.findMany({
      where: {
        organizationId,
        organization: { deletedAt: null },
        ...(query.serviceId ? { serviceId: query.serviceId } : {}),
        ...(query.archived === 'include' ? {} : { archivedAt: null }),
      },
      select: knownIssueSelection,
    });
    const occurrences = await this.occurrencesOf(
      organizationId,
      rows.map(({ id }) => id),
    );

    return rows
      .map((row) =>
        toKnownIssueResponse(row, occurrences.get(row.id) ?? NO_OCCURRENCES),
      )
      .sort(byFrequency);
  }

  /** One known issue, by its id and the organization together. */
  async get(organizationId: string, id: string): Promise<KnownIssueResponse> {
    return this.read(this.prisma, organizationId, id);
  }

  /**
   * The Admin adds one by hand. Not pending review: the Admin made it. Its
   * service must exist here and not be archived; its name must be new to
   * the service, in any case.
   */
  async create(
    organizationId: string,
    input: CreateKnownIssueRequest,
  ): Promise<KnownIssueResponse> {
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const service = await tx.service.findFirst({
          where: {
            id: input.serviceId,
            organizationId,
            organization: { deletedAt: null },
          },
          select: { archivedAt: true },
        });

        if (!service) throw serviceNotFound();
        if (service.archivedAt !== null) throw serviceArchived();

        await this.requireNameFree(
          tx,
          organizationId,
          input.serviceId,
          input.name,
        );

        return tx.knownIssue.create({
          data: {
            organizationId,
            serviceId: input.serviceId,
            name: input.name,
            description: input.description ?? null,
            usualSeverity: input.usualSeverity,
          },
          select: { id: true },
        });
      });

      this.logger.log('Known issue created', {
        knownIssueId: created.id,
        serviceId: input.serviceId,
      });

      return this.get(organizationId, created.id);
    } catch (error) {
      const hint = uniqueViolationHint(error);

      if (hint !== undefined && isNameConflict(hint)) {
        throw knownIssueNameTaken();
      }

      throw error;
    }
  }

  /**
   * Renames, describes, re-rates, archives or restores one. Any change is
   * the Admin having looked at it, so it is no longer pending review.
   */
  async update(
    organizationId: string,
    id: string,
    input: UpdateKnownIssueRequest,
  ): Promise<KnownIssueResponse> {
    if (!isResourceId(id)) throw knownIssueNotFound();

    try {
      await this.prisma.$transaction(async (tx) => {
        const current = await tx.knownIssue.findFirst({
          where: { id, organizationId, organization: { deletedAt: null } },
          select: { serviceId: true, name: true, archivedAt: true },
        });

        if (!current) throw knownIssueNotFound();

        if (input.name !== undefined && input.name !== current.name) {
          await this.requireNameFree(
            tx,
            organizationId,
            current.serviceId,
            input.name,
            id,
          );
        }

        await tx.knownIssue.update({
          where: { id },
          data: {
            name: input.name,
            description: input.description,
            usualSeverity: input.usualSeverity,
            archivedAt:
              input.archived === undefined
                ? undefined
                : input.archived
                  ? (current.archivedAt ?? new Date())
                  : null,
            pendingReview: false,
          },
          select: { id: true },
        });
      });
    } catch (error) {
      const hint = uniqueViolationHint(error);

      if (hint !== undefined && isNameConflict(hint)) {
        throw knownIssueNameTaken();
      }

      throw error;
    }

    this.logger.log('Known issue updated', { knownIssueId: id });

    return this.get(organizationId, id);
  }

  /**
   * Folds one known issue into another of the same service: its incidents
   * move over, and it is removed. Both rows are locked first, in id order,
   * so two merges of the same pair cannot cross, and a declaration linking
   * to the one removed either lands before (and moves with the rest) or
   * after (and is refused by the incidents' key).
   */
  async merge(
    organizationId: string,
    id: string,
    input: MergeKnownIssueRequest,
  ): Promise<KnownIssueResponse> {
    if (!isResourceId(id)) throw knownIssueNotFound();
    if (id === input.intoId) throw knownIssueMergeIntoItself();

    const moved = await this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<{ id: string; service_id: string }[]>`
        SELECT k.id, k.service_id
        FROM known_issues k
        JOIN organizations o ON o.id = k.organization_id AND o.deleted_at IS NULL
        WHERE k.organization_id = ${organizationId}::uuid
          AND k.id IN (${id}::uuid, ${input.intoId}::uuid)
        ORDER BY k.id
        FOR UPDATE OF k`;
      const from = locked.find((row) => row.id === id);
      const into = locked.find((row) => row.id === input.intoId);

      if (!from || !into) throw knownIssueNotFound();
      if (from.service_id !== into.service_id) throw knownIssueOtherService();

      const { count } = await tx.incident.updateMany({
        where: { organizationId, knownIssueId: id },
        data: { knownIssueId: input.intoId },
      });

      await tx.knownIssue.delete({ where: { id }, select: { id: true } });

      return count;
    });

    this.logger.log('Known issue merged', {
      knownIssueId: id,
      intoId: input.intoId,
      incidentsMoved: moved,
    });

    return this.get(organizationId, input.intoId);
  }

  /** One, with its occurrences, read through `client`. */
  private async read(
    client: Prisma.TransactionClient,
    organizationId: string,
    id: string,
  ): Promise<KnownIssueResponse> {
    if (!isResourceId(id)) throw knownIssueNotFound();

    const row = await client.knownIssue.findFirst({
      where: { id, organizationId, organization: { deletedAt: null } },
      select: knownIssueSelection,
    });

    if (!row) throw knownIssueNotFound();

    const occurrences = await this.occurrencesOf(organizationId, [id]);

    return toKnownIssueResponse(row, occurrences.get(id) ?? NO_OCCURRENCES);
  }

  /** A name another of the service's known issues has, in any case, is taken. */
  private async requireNameFree(
    tx: Prisma.TransactionClient,
    organizationId: string,
    serviceId: string,
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const taken = await tx.knownIssue.findFirst({
      where: {
        organizationId,
        serviceId,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });

    if (taken) throw knownIssueNameTaken();
  }

  /**
   * How often each known issue has happened: its incidents counted, the
   * latest declared, and one still active. Two grouped reads, never the
   * incidents themselves.
   */
  private async occurrencesOf(
    organizationId: string,
    ids: readonly string[],
  ): Promise<Map<string, Occurrences>> {
    if (ids.length === 0) return new Map();

    const [all, active] = await Promise.all([
      this.prisma.incident.groupBy({
        by: ['knownIssueId'],
        where: { organizationId, knownIssueId: { in: [...ids] } },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
      this.prisma.incident.groupBy({
        by: ['knownIssueId'],
        where: {
          organizationId,
          knownIssueId: { in: [...ids] },
          status: { not: 'RESOLVED' },
        },
        _max: { number: true },
      }),
    ]);
    const activeOf = new Map(
      active.map((row) => [row.knownIssueId, row._max.number ?? null]),
    );

    return new Map(
      all.map((row) => [
        row.knownIssueId as string,
        {
          total: row._count._all,
          lastAt: row._max.createdAt,
          active: activeOf.get(row.knownIssueId) ?? null,
        },
      ]),
    );
  }
}
