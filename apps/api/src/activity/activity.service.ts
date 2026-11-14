import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { isResourceId } from '../tenancy/tenancy.schemas.js';
import { CHANGE_AREAS } from './activity.actions.js';
import type { ChangeArea } from './activity.actions.js';
import type {
  ActivityEntryDetailResponse,
  ActivityEntryResponse,
  ActivityPageResponse,
  ActivitySubjectType,
} from './activity.contract.js';
import {
  decodeActivityCursor,
  encodeActivityCursor,
  olderThan,
} from './activity.cursor.js';
import { activityEntryNotFound } from './activity.errors.js';
import { foldRepeats, toActivityEntryResponse } from './activity.responses.js';
import type { ActivityRow } from './activity.responses.js';
import { describeUserAgent } from './activity.user-agent.js';
import type { ListActivityQuery } from './activity.schemas.js';

/** Entries per page. */
export const ACTIVITY_PAGE_SIZE = 50;

/** How many earlier entries about the same subject one entry shows. */
export const ACTIVITY_HISTORY_SIZE = 3;

/** The most wrong passwords one entry lists as its run. */
export const ACTIVITY_ATTEMPTS_SIZE = 20;

/** How far back "where they usually sign in from" looks. */
export const USUAL_CLIENT_DAYS = 30;

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
/** An entry with its actor marked as removed since, when they are. */
const markFormer = <T extends ActivityEntryResponse>(
  entry: T,
  former: ReadonlySet<string>,
): T =>
  former.has(entry.actor.id)
    ? { ...entry, actor: { ...entry.actor, former: true } }
    : entry;

@Injectable()
export class ActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    organizationId: string,
    query: ListActivityQuery,
  ): Promise<ActivityPageResponse> {
    // Everything but the area, the result and the page: the area buttons and
    // the sign-in totals count under it.
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
        ...(query.result !== undefined ? [{ action: query.result }] : []),
        ...(query.cursor !== undefined
          ? [olderThan(decodeActivityCursor(query.cursor))]
          : []),
      ],
    };

    // One more than a page says whether there is another.
    const [rows, areaCounts, securityTotals] = await Promise.all([
      this.prisma.activityEntry.findMany({
        where,
        select: ENTRY_SELECT,
        orderBy: [...NEWEST_FIRST],
        take: ACTIVITY_PAGE_SIZE + 1,
      }),
      query.view === 'changes' ? this.countByArea(filters) : null,
      query.view === 'security' ? this.countSecurity(filters) : null,
    ]);
    const page = rows.slice(0, ACTIVITY_PAGE_SIZE);
    const last = page.at(-1);
    const former = await this.formerActors(organizationId, page);

    return {
      // Wrong passwords tried one after another read as one row.
      entries: (query.view === 'security'
        ? foldRepeats(page)
        : page.map(toActivityEntryResponse)
      ).map((entry) => markFormer(entry, former)),
      securityTotals,
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

    const security = row.area === 'SECURITY';
    const [history, subjectNow, attempts, next, usualClient] =
      await Promise.all([
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
        row.action === 'SIGN_IN_FAILED'
          ? this.attemptsEndingAt(organizationId, row)
          : null,
        security ? this.nextFor(organizationId, row) : null,
        security ? this.usualClientBefore(organizationId, row) : null,
      ]);

    const former = await this.formerActors(organizationId, [
      row,
      ...history,
      ...(next === null ? [] : [next]),
    ]);

    return {
      ...markFormer(toActivityEntryResponse(row), former),
      history: history
        .map(toActivityEntryResponse)
        .map((entry) => markFormer(entry, former)),
      subjectNow,
      attempts,
      next:
        next === null ? null : markFormer(toActivityEntryResponse(next), former),
      usualClient,
    };
  }

  /**
   * Which of these entries' actors the Admin has removed from the
   * organization since: one query for the page.
   */
  private async formerActors(
    organizationId: string,
    rows: readonly { actorId: string }[],
  ): Promise<ReadonlySet<string>> {
    if (rows.length === 0) return new Set();

    const removed = await this.prisma.membership.findMany({
      where: {
        organizationId,
        removedAt: { not: null },
        userId: { in: [...new Set(rows.map(({ actorId }) => actorId))] },
      },
      select: { userId: true },
    });

    return new Set(removed.map(({ userId }) => userId));
  }

  /** Sign-ins, wrong passwords and blocks under `where`, each counted. */
  private async countSecurity(
    where: Prisma.ActivityEntryWhereInput,
  ): Promise<{ signIns: number; failedSignIns: number; blocked: number }> {
    const groups = await this.prisma.activityEntry.groupBy({
      by: ['action'],
      where,
      _count: { _all: true },
    });
    const count = (action: string) =>
      groups.find((group) => group.action === action)?._count._all ?? 0;

    return {
      signIns: count('SIGNED_IN'),
      failedSignIns: count('SIGN_IN_FAILED'),
      blocked: count('SIGN_IN_BLOCKED'),
    };
  }

  /**
   * The wrong passwords tried one after another that end with `row`, oldest
   * first: this account's security events going back from it, up to the
   * first that was not a wrong password.
   */
  private async attemptsEndingAt(
    organizationId: string,
    row: ActivityRow,
  ): Promise<string[]> {
    const earlier = await this.prisma.activityEntry.findMany({
      where: {
        AND: [
          { organizationId, actorId: row.actorId, area: 'SECURITY' },
          olderThan(row),
        ],
      },
      select: { action: true, createdAt: true },
      orderBy: [...NEWEST_FIRST],
      take: ACTIVITY_ATTEMPTS_SIZE - 1,
    });
    const run = [row.createdAt];

    for (const entry of earlier) {
      if (entry.action !== 'SIGN_IN_FAILED') break;
      run.push(entry.createdAt);
    }

    return run.reverse().map((at) => at.toISOString());
  }

  /**
   * What happened to the account next: its first security event after
   * `row` that is not another wrong password — those are `row`'s run.
   */
  private async nextFor(
    organizationId: string,
    row: ActivityRow,
  ): Promise<ActivityRow | null> {
    return this.prisma.activityEntry.findFirst({
      where: {
        organizationId,
        actorId: row.actorId,
        area: 'SECURITY',
        action: { not: 'SIGN_IN_FAILED' },
        OR: [
          { createdAt: { gt: row.createdAt } },
          { createdAt: row.createdAt, id: { gt: row.id } },
        ],
      },
      select: ENTRY_SELECT,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  /**
   * The address and browser the account signed in from most often in the
   * days before `row`, or null when it had not signed in.
   */
  private async usualClientBefore(
    organizationId: string,
    row: ActivityRow,
  ): Promise<{ ipAddress: string | null; browser: string | null } | null> {
    const [usual] = await this.prisma.activityEntry.groupBy({
      by: ['ipAddress', 'userAgent'],
      where: {
        organizationId,
        actorId: row.actorId,
        action: 'SIGNED_IN',
        id: { not: row.id },
        createdAt: {
          lte: row.createdAt,
          gte: new Date(
            row.createdAt.getTime() - USUAL_CLIENT_DAYS * 24 * 60 * 60 * 1000,
          ),
        },
      },
      _count: { _all: true },
      orderBy: { _count: { id: 'desc' } },
      take: 1,
    });

    return usual === undefined
      ? null
      : {
          ipAddress: usual.ipAddress,
          browser: describeUserAgent(usual.userAgent),
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
