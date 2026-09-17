import { NotFoundException } from '@nestjs/common';

/**
 * The machine-readable `code` values this module puts on the error contract.
 * Part of the public API, like AuthErrorCode.
 */
export const TenancyErrorCode = {
  ORGANIZATION_NOT_FOUND: 'ORGANIZATION_NOT_FOUND',
} as const;

export type TenancyErrorCode =
  (typeof TenancyErrorCode)[keyof typeof TenancyErrorCode];

/**
 * The single answer to every way admission to an organization can fail: the id
 * is malformed, no such organization exists, it was soft-deleted, the caller is
 * not a member, or the caller's own account was soft-deleted.
 *
 * 404 rather than 403, and one message for all of them, because a 403 would
 * confirm that the organization exists to someone who has no business knowing.
 * The message never echoes the id.
 */
export const organizationNotFound = (): NotFoundException =>
  new NotFoundException('Organization not found', {
    errorCode: TenancyErrorCode.ORGANIZATION_NOT_FOUND,
  });
