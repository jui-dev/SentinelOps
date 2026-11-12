import { BadRequestException, NotFoundException } from '@nestjs/common';

/**
 * The machine-readable `code` values this module puts on the error contract.
 * Part of the public API, like KnownIssuesErrorCode.
 */
export const ActivityErrorCode = {
  ACTIVITY_ENTRY_NOT_FOUND: 'ACTIVITY_ENTRY_NOT_FOUND',
  INVALID_CURSOR: 'INVALID_CURSOR',
} as const;

export type ActivityErrorCode =
  (typeof ActivityErrorCode)[keyof typeof ActivityErrorCode];

/** Malformed id, no such entry, or another organization's: one answer. */
export const activityEntryNotFound = (): NotFoundException =>
  new NotFoundException('Activity log entry not found', {
    errorCode: ActivityErrorCode.ACTIVITY_ENTRY_NOT_FOUND,
  });

export const invalidCursor = (): BadRequestException =>
  new BadRequestException('Invalid page cursor', {
    errorCode: ActivityErrorCode.INVALID_CURSOR,
  });
