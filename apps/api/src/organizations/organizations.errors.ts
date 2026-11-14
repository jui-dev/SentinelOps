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
  MEMBER_REMOVED: 'MEMBER_REMOVED',
  MEMBER_NOT_REMOVED: 'MEMBER_NOT_REMOVED',
  CANNOT_REMOVE_SELF: 'CANNOT_REMOVE_SELF',
  MEMBER_HAS_OPEN_WORK: 'MEMBER_HAS_OPEN_WORK',
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
/**
 * Acting on someone the Admin removed — changing their role, resetting their
 * password, removing them again — or adding a person by the email of one.
 * They are restored instead, which keeps their history theirs.
 */
export const memberRemoved = (): ConflictException =>
  new ConflictException(
    'This person was removed from the organization. Restore them instead',
    { errorCode: OrganizationsErrorCode.MEMBER_REMOVED },
  );

/** Restoring someone who was never removed, or already restored. */
export const memberNotRemoved = (): ConflictException =>
  new ConflictException('This person belongs to the organization already', {
    errorCode: OrganizationsErrorCode.MEMBER_NOT_REMOVED,
  });

/** An Admin removing themselves: another Admin does it, so one always remains. */
export const cannotRemoveSelf = (): ConflictException =>
  new ConflictException("You can't remove yourself from the organization", {
    errorCode: OrganizationsErrorCode.CANNOT_REMOVE_SELF,
  });

/**
 * Someone with a response under way, or an unpublished analysis they own.
 * Handed over first, so nothing is left with nobody to finish it.
 */
export const memberHasOpenWork = (): ConflictException =>
  new ConflictException(
    'Hand over their open work first: a response still under way, or an analysis they own',
    { errorCode: OrganizationsErrorCode.MEMBER_HAS_OPEN_WORK },
  );

export const memberOfOtherOrganizations = (): ConflictException =>
  new ConflictException(
    "This person also belongs to another organization, so their password can't be reset from here",
    { errorCode: OrganizationsErrorCode.MEMBER_OF_OTHER_ORGANIZATIONS },
  );
