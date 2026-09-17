import { ForbiddenException } from '@nestjs/common';

/**
 * The machine-readable `code` values this module puts on the error contract.
 * Part of the public API, like AuthErrorCode.
 */
export const AuthorizationErrorCode = {
  PERMISSION_DENIED: 'PERMISSION_DENIED',
} as const;

export type AuthorizationErrorCode =
  (typeof AuthorizationErrorCode)[keyof typeof AuthorizationErrorCode];

/**
 * The answer to an admitted member whose role does not hold the permission a
 * route requires.
 *
 * 403, where admission answers 404. Only a caller already admitted to the
 * organization can reach this, so it confirms nothing they do not already
 * know: the organization exists and they belong to it. Everything that is not
 * admitted still receives admission's uniform 404.
 *
 * The message names neither the permission nor the role that would have
 * sufficed.
 */
export const permissionDenied = (): ForbiddenException =>
  new ForbiddenException('You do not have permission to perform this action', {
    errorCode: AuthorizationErrorCode.PERMISSION_DENIED,
  });
