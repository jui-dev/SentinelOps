import { BadRequestException, NotFoundException } from '@nestjs/common';

/**
 * The machine-readable `code` values this module puts on the error contract.
 * Part of the public API, like AuthErrorCode.
 */
export const NotificationsErrorCode = {
  NOTIFICATION_NOT_FOUND: 'NOTIFICATION_NOT_FOUND',
  INVALID_CURSOR: 'INVALID_CURSOR',
} as const;

export type NotificationsErrorCode =
  (typeof NotificationsErrorCode)[keyof typeof NotificationsErrorCode];

/**
 * The single answer for a notification the caller may not see: a malformed
 * id, no such row, another member's, or another organization's. Someone
 * else's notification answers exactly as a nonexistent one, so an id reveals
 * nothing about whose it is.
 */
export const notificationNotFound = (): NotFoundException =>
  new NotFoundException('Notification not found', {
    errorCode: NotificationsErrorCode.NOTIFICATION_NOT_FOUND,
  });

/** A cursor this API did not issue, or one that has been altered. */
export const invalidCursor = (): BadRequestException =>
  new BadRequestException('Invalid page cursor', {
    errorCode: NotificationsErrorCode.INVALID_CURSOR,
  });
