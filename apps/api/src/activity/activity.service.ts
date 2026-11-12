import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { isResourceId } from '../tenancy/tenancy.schemas.js';
import { CHANGE_AREAS } from './activity.actions.js';
import type { ChangeArea } from './activity.actions.js';
import type {
  ActivityEntryDetailResponse,
  ActivityPageResponse,
  ActivitySubjectType,
} from './activity.contract.js';
import {
  decodeActivityCursor,
  encodeActivityCursor,
  olderThan,
} from './activity.cursor.js';
import { activityEntryNotFound } from './activity.errors.js';
import { toActivityEntryResponse } from './activity.responses.js';
import type { ListActivityQuery } from './activity.schemas.js';

/** Entries per page. */
export const ACTIVITY_PAGE_SIZE = 50;

/** How many earlier entries about the same subject one entry shows. */
export const ACTIVITY_HISTORY_SIZE = 3;

const ENTRY_SELECT = {
  id: true,
  action: true,
  area: true,
  actorId: true,
  actorName: true,
  subjectType: true,
  subjectId: true,
  subjectName: true,
  changes: true,
  ipAddress: true,
  userAgent: true,
  createdAt: true,
} as const satisfies Prisma.ActivityEntrySelect;

const NEWEST_FIRST = [
  { createdAt: 'desc' },
  { id: 'desc' },
] as const satisfies Prisma.ActivityEntryOrderByWithRelationInput[];

/**
 * Reads an organization's activity log. Writing is not here: entries are
 * written by the changes they record, inside their own transactions, through
 * recordActivity.
 *
 * Every query is scoped by the admitted organization, so another
 * organization's entries are never read, and an entry of theirs is answered
 * 404 exactly as one that does not exist.
 */
@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    organizationId: string,
    query: ListActivityQuery,
  ): Promise<ActivityPageResponse> {
    // Everything but the area and the page: the area buttons count under it.
    const filters: Prisma.ActivityEntryWhereInput = {
      organizationId,
      area: query.view === 'security' ? 'SECURITY' : { in: [...CHANGE_AREAS] },
      ...(query.actorId !== undefined && { actorId: query.actorId }),
      ...(query.since !== undefined && {
        createdAt: { gte: new Date(query.since) },
      }),
      ...(query.q !== undefined && {
        OR: [
          { actorName: { contains: query.q, mode: 'insensitive' } },
          { subjectName: { contains: query.q, mode: 'insensitive' } },
        ],
      }),
    };
    const where: Prisma.ActivityEntryWhereInput = {
      AND: [
        filters,
        ...(query.area !== undefined ? [{ area: query.area }] : []),
        ...(query.cursor !== undefined
          ? [olderThan(decodeActivityCursor(query.cursor))]
          : []),
      ],
    };

    // One more than a page says whether there is another.
    const [rows, areaCounts] = await Promise.all([
      this.prisma.activityEntry.findMany({
        where,
        select: ENTRY_SELECT,
        orderBy: [...NEWEST_FIRST],
        take: ACTIVITY_PAGE_SIZE + 1,
      }),
      query.view === 'changes' ? this.countByArea(filters) : null,
    ]);
    const page = rows.slice(0, ACTIVITY_PAGE_SIZE);
    const last = page.at(-1);

    return {
      entries: page.map(toActivityEntryResponse),
      nextCursor:
        rows.length > ACTIVITY_PAGE_SIZE && last !== undefined
          ? encodeActivityCursor(last)
          : null,
      areaCounts,
    };
  }

  async get(
    organizationId: string,
    entryId: string,
  ): Promise<ActivityEntryDetailResponse> {
    if (!isResourceId(entryId)) throw activityEntryNotFound();

    const row = await this.prisma.activityEntry.findFirst({
      where: { id: entryId, organizationId },
      select: ENTRY_SELECT,
    });

    if (row === null) throw activityEntryNotFound();

    const [history, subjectNow] = await Promise.all([
      row.subjectId === null
        ? []
        : this.prisma.activityEntry.findMany({
            where: {
              AND: [
                { organizationId, subjectId: row.subjectId },
                olderThan(row),
              ],
            },
            select: ENTRY_SELECT,
            orderBy: [...NEWEST_FIRST],
            take: ACTIVITY_HISTORY_SIZE,
          }),
      row.subjectType === null || row.subjectId === null
        ? null
        : this.subjectNow(organizationId, row.subjectType, row.subjectId),
    ]);

    return {
      ...toActivityEntryResponse(row),
      history: history.map(toActivityEntryResponse),
      subjectNow,
    };
  }

  private async countByArea(
    where: Prisma.ActivityEntryWhereInput,
  ): Promise<Record<ChangeArea, number>> {
    const groups = await this.prisma.activityEntry.groupBy({
      by: ['area'],
      where,
      _count: { _all: true },
    });
    const counts = Object.fromEntries(
      CHANGE_AREAS.map((area) => [area, 0]),
    ) as Record<ChangeArea, number>;

    for (const group of groups) {
      if (group.area in counts) {
        counts[group.area as ChangeArea] = group._count._all;
      }
    }

    return counts;
  }

  /**
   * Whether what an entry is about still exists, within this organization,
   * and the slug its page is addressed by where it has one.
   */
  private async subjectNow(
    organizationId: string,
    type: ActivitySubjectType,
    id: string,
  ): Promise<{ exists: boolean; slug: string | null }> {
    const where = { id, organizationId };
    const found = (row: { id?: string; slug?: string } | null) => ({
      exists: row !== null,
      slug: row?.slug ?? null,
    });

    switch (type) {
      case 'TEAM':
        return found(
          await this.prisma.team.findFirst({ where, select: { slug: true } }),
        );
      case 'SERVICE':
        return found(
          await this.prisma.service.findFirst({
            where,
            select: { slug: true },
          }),
        );
      case 'MEMBERSHIP':
        return found(
          await this.prisma.membership.findFirst({
            where,
            select: { id: true },
          }),
        );
      case 'INVITATION':
        return found(
          await this.prisma.invitation.findFirst({
            where,
            select: { id: true },
          }),
        );
      case 'KNOWN_ISSUE':
        return found(
          await this.prisma.knownIssue.findFirst({
            where,
            select: { id: true },
          }),
        );
      case 'ORGANIZATION':
        return found(
          await this.prisma.organization.findFirst({
            where: { id: organizationId },
            select: { slug: true },
          }),
        );
    }
  }
}
