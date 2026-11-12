import { ConflictException, NotFoundException } from '@nestjs/common';

/**
 * The machine-readable `code` values this module puts on the error contract.
 * Part of the public API, like AuthErrorCode.
 */
export const OrganizationsErrorCode = {
  MEMBERSHIP_NOT_FOUND: 'MEMBERSHIP_NOT_FOUND',
  LAST_ADMIN: 'LAST_ADMIN',
  CANNOT_RESET_OWN_PASSWORD: 'CANNOT_RESET_OWN_PASSWORD',
  MEMBER_OF_OTHER_ORGANIZATIONS: 'MEMBER_OF_OTHER_ORGANIZATIONS',
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

/**
 * Changing the role of the organization's only Admin. Somebody must always be
 * able to manage its people, so the last Admin keeps the role.
 */
export const lastAdmin = (): ConflictException =>
  new ConflictException('The only Admin keeps their role', {
    errorCode: OrganizationsErrorCode.LAST_ADMIN,
  });

/**
 * An Admin resetting their own password. They change it themselves, giving
 * the current one, so an unattended session cannot take the account over.
 */
export const cannotResetOwnPassword = (): ConflictException =>
  new ConflictException('Change your own password from your account instead', {
    errorCode: OrganizationsErrorCode.CANNOT_RESET_OWN_PASSWORD,
  });

/**
 * A member whose account also belongs to another organization. An account is
 * one person's everywhere, so one organization's Admin must not be able to
 * set the password that opens the others.
 */
export const memberOfOtherOrganizations = (): ConflictException =>
  new ConflictException(
    "This person also belongs to another organization, so their password can't be reset from here",
    { errorCode: OrganizationsErrorCode.MEMBER_OF_OTHER_ORGANIZATIONS },
  );
