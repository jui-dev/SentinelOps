import { NotFoundException } from '@nestjs/common';

/**
 * The machine-readable `code` values this module puts on the error contract.
 * Part of the public API, like AuthErrorCode.
 */
export const OrganizationsErrorCode = {
  MEMBERSHIP_NOT_FOUND: 'MEMBERSHIP_NOT_FOUND',
} as const;

export type OrganizationsErrorCode =
  (typeof OrganizationsErrorCode)[keyof typeof OrganizationsErrorCode];

/**
 * The single answer for a membership that is not visible within the admitted
 * organization: malformed id, no such row, a row belonging to another
 * organization, or one whose user was soft-deleted.
 *
 * A membership in another tenant answers exactly as a nonexistent one does, so
 * a caller cannot probe for ids outside the organization it was admitted to.
 */
export const membershipNotFound = (): NotFoundException =>
  new NotFoundException('Membership not found', {
    errorCode: OrganizationsErrorCode.MEMBERSHIP_NOT_FOUND,
  });
