import {
  Body,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';

import { Permission } from '../authorization/permissions.js';
import { RequirePermission } from '../authorization/require-permission.decorator.js';
import type { OrganizationContext } from '../common/request-context.js';
import { CurrentMembership } from '../tenancy/current-membership.decorator.js';
import { OrganizationController } from '../tenancy/organization-controller.decorator.js';
import type {
  NotificationPage,
  NotificationResponse,
  NotificationUnreadCountResponse,
} from './notifications.contract.js';
import {
  listNotificationsQuerySchema,
  markNotificationsReadSchema,
} from './notifications.schemas.js';
import type {
  ListNotificationsQuery,
  MarkNotificationsReadRequest,
} from './notifications.schemas.js';
import { NotificationsService } from './notifications.service.js';

/**
 * The caller's own notifications in an organization.
 *
 * The same three layers as every organization route: admission by
 * `@OrganizationController()`, authorization by `@RequirePermission()`, and
 * isolation in the service. Whose notifications they are is the admitted
 * membership, passed explicitly on every call — no route names a recipient,
 * so no request can reach anyone else's.
 *
 * Notification ids are validated in the service, so a malformed one answers
 * 404 like any other id the caller cannot see.
 */
@OrganizationController('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** One page of the caller's notifications, newest first. */
  @Get()
  @RequirePermission(Permission.NOTIFICATIONS_READ)
  list(
    @CurrentMembership() membership: OrganizationContext,
    @Query({ schema: listNotificationsQuerySchema })
    query: ListNotificationsQuery,
  ): Promise<NotificationPage> {
    return this.notifications.list(
      membership.organizationId,
      membership.membershipId,
      query,
    );
  }

  /** How many of the caller's notifications are unread. */
  @Get('unread-count')
  @RequirePermission(Permission.NOTIFICATIONS_READ)
  unreadCount(
    @CurrentMembership() membership: OrganizationContext,
  ): Promise<NotificationUnreadCountResponse> {
    return this.notifications.unreadCount(
      membership.organizationId,
      membership.membershipId,
    );
  }

  /**
   * Acknowledges every unread notification up to and including `through`,
   * the newest the caller has seen; newer ones stay unread. Answers with how
   * many remain unread.
   */
  @Post('read')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.NOTIFICATIONS_READ)
  markReadThrough(
    @CurrentMembership() membership: OrganizationContext,
    @Body({ schema: markNotificationsReadSchema })
    body: MarkNotificationsReadRequest,
  ): Promise<NotificationUnreadCountResponse> {
    return this.notifications.markReadThrough(
      membership.organizationId,
      membership.membershipId,
      body.through,
    );
  }

  /**
   * Acknowledges one notification. Acknowledging again changes nothing —
   * the first time stands — so this answers 200 either way, with it.
   */
  @Post(':notificationId/read')
  @HttpCode(HttpStatus.OK)
  @RequirePermission(Permission.NOTIFICATIONS_READ)
  markRead(
    @CurrentMembership() membership: OrganizationContext,
    @Param('notificationId') notificationId: string,
  ): Promise<NotificationResponse> {
    return this.notifications.markRead(
      membership.organizationId,
      membership.membershipId,
      notificationId,
    );
  }
}
