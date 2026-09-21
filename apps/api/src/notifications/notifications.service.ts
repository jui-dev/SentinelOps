import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import { isResourceId } from '../tenancy/tenancy.schemas.js';
import type {
  NotificationPage,
  NotificationResponse,
  NotificationUnreadCountResponse,
} from './notifications.contract.js';
import {
  atOrBefore,
  decodeNotificationCursor,
  encodeNotificationCursor,
  olderThan,
} from './notifications.cursor.js';
import { notificationNotFound } from './notifications.errors.js';
import { toNotificationResponse } from './notifications.responses.js';
import type { ListNotificationsQuery } from './notifications.schemas.js';

/** Notifications per page. Not a client parameter. */
export const NOTIFICATION_PAGE_SIZE = 20;

/**
 * Columns a notification response is built from. Identity only: the actor's
 * name, never their email, and not filtered on deletedAt — who did something
 * stays true after they leave. The incident is read as it stands now, through
 * the timeline entry; the entry's values are what was recorded then.
 */
const notificationSelection = {
  id: true,
  type: true,
  createdAt: true,
  readAt: true,
  actor: { select: { id: true, name: true } },
  activity: {
    select: {
      fromValue: true,
      toValue: true,
      incident: {
        select: {
          number: true,
          title: true,
          severity: true,
          status: true,
          service: { select: { name: true, slug: true } },
        },
      },
    },
  },
  team: { select: { id: true, name: true } },
} as const;

/** Newest first; the UUIDv7 id breaks a tie. */
const newestFirst = [{ createdAt: 'desc' }, { id: 'desc' }] as const;

/**
 * One member's notifications within one organization: reading them, counting
 * the unread, and acknowledging them.
 *
 * Only ever the caller's own. Every method takes the organization and the
 * recipient membership as explicit arguments — the controller passes the
 * admitted ones, and nothing else can name a recipient — and every query
 * filters by both, together with the organization not being soft-deleted.
 * So each is correct with no guard in front of it, and another member's or
 * another organization's notification is indistinguishable from none.
 *
 * Nothing here creates a notification; they are written in the transactions
 * of the changes they report.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * One page of the recipient's notifications, newest first: keyset pages
   * over (createdAt, id), served by the (recipient, created_at, id) index,
   * so a page is one range read however deep it is.
   */
  async list(
    organizationId: string,
    recipientMembershipId: string,
    query: ListNotificationsQuery,
  ): Promise<NotificationPage> {
    const after = query.cursor
      ? decodeNotificationCursor(query.cursor)
      : undefined;

    const rows = await this.prisma.notification.findMany({
      where: {
        ...this.scope(organizationId, recipientMembershipId),
        ...(after && olderThan(after)),
      },
      select: notificationSelection,
      orderBy: [...newestFirst],
      take: NOTIFICATION_PAGE_SIZE + 1,
    });

    const hasMore = rows.length > NOTIFICATION_PAGE_SIZE;
    const items = rows.slice(0, NOTIFICATION_PAGE_SIZE);
    const last = items.at(-1);

    return {
      items: items.map(toNotificationResponse),
      page: {
        cursor: hasMore && last ? encodeNotificationCursor(last) : null,
        hasMore,
      },
    };
  }

  /** How many of the recipient's notifications are unread, exactly. */
  async unreadCount(
    organizationId: string,
    recipientMembershipId: string,
  ): Promise<NotificationUnreadCountResponse> {
    return {
      count: await this.prisma.notification.count({
        where: {
          ...this.scope(organizationId, recipientMembershipId),
          readAt: null,
        },
      }),
    };
  }

  /**
   * Acknowledges one of the recipient's notifications, and returns it.
   *
   * readAt is written once. The write matches only while the notification is
   * unread, so acknowledging again — or twice at once, when the second waits
   * on the first's row lock and then finds it read — changes nothing, and
   * the first time stands. Either way the answer is 200 with the
   * notification. Anything not the recipient's to see is 404.
   */
  async markRead(
    organizationId: string,
    recipientMembershipId: string,
    notificationId: string,
  ): Promise<NotificationResponse> {
    if (!isResourceId(notificationId)) {
      throw notificationNotFound();
    }

    const own = {
      id: notificationId,
      ...this.scope(organizationId, recipientMembershipId),
    };

    const { count } = await this.prisma.notification.updateMany({
      where: { ...own, readAt: null },
      data: { readAt: new Date() },
    });

    const notification = await this.prisma.notification.findFirst({
      where: own,
      select: notificationSelection,
    });

    if (!notification) {
      throw notificationNotFound();
    }

    if (count === 1) {
      this.logger.log('Notification read', { notificationId });
    }

    return toNotificationResponse(notification);
  }

  /**
   * Acknowledges every unread notification of the recipient's up to and
   * including `through` — the newest one they have seen — and returns how
   * many remain unread.
   *
   * Bounded by (createdAt, id), so a notification newer than `through` stays
   * unread even if it arrived before this request. `through` is resolved
   * within the recipient's own notifications first: someone else's is 404,
   * as for markRead. One transaction, so the count is the one this left.
   */
  async markReadThrough(
    organizationId: string,
    recipientMembershipId: string,
    through: string,
  ): Promise<NotificationUnreadCountResponse> {
    const scope = this.scope(organizationId, recipientMembershipId);

    const { marked, unread } = await this.prisma.$transaction(async (tx) => {
      const bound = await tx.notification.findFirst({
        where: { id: through, ...scope },
        select: { createdAt: true, id: true },
      });

      if (!bound) {
        throw notificationNotFound();
      }

      const { count } = await tx.notification.updateMany({
        where: { ...scope, readAt: null, ...atOrBefore(bound) },
        data: { readAt: new Date() },
      });

      return {
        marked: count,
        unread: await tx.notification.count({
          where: { ...scope, readAt: null },
        }),
      };
    });

    if (marked > 0) {
      this.logger.log('Notifications read', { through, marked });
    }

    return { count: unread };
  }

  /** The recipient's own notifications, in an organization still active. */
  private scope(organizationId: string, recipientMembershipId: string) {
    return {
      organizationId,
      recipientMembershipId,
      organization: { deletedAt: null },
    };
  }
}
