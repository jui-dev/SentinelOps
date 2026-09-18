import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

/**
 * The machine-readable `code` values this module puts on the error contract.
 * Part of the public API, like AuthErrorCode.
 */
export const InvitationsErrorCode = {
  INVITATION_NOT_FOUND: 'INVITATION_NOT_FOUND',
  INVITATION_NOT_PENDING: 'INVITATION_NOT_PENDING',
  INVITATION_ALREADY_PENDING: 'INVITATION_ALREADY_PENDING',
  INVITATION_EMAIL_MISMATCH: 'INVITATION_EMAIL_MISMATCH',
  ALREADY_A_MEMBER: 'ALREADY_A_MEMBER',
} as const;

export type InvitationsErrorCode =
  (typeof InvitationsErrorCode)[keyof typeof InvitationsErrorCode];

/**
 * The single answer for an invitation that cannot be used or seen.
 *
 * By id, within an admitted organization: malformed, missing, or belonging to
 * another organization. By token: unknown, expired, revoked, already accepted,
 * belonging to a deleted organization, or claimed by a concurrent request.
 * Telling those apart would help nobody who holds a working link.
 */
export const invitationNotFound = (): NotFoundException =>
  new NotFoundException('Invitation not found', {
    errorCode: InvitationsErrorCode.INVITATION_NOT_FOUND,
  });

/** Revoking an invitation that was already accepted or revoked. */
export const invitationNotPending = (): ConflictException =>
  new ConflictException('This invitation is no longer open', {
    errorCode: InvitationsErrorCode.INVITATION_NOT_PENDING,
  });

/**
 * Another request created an open invitation for the same email at the same
 * time. Its link went to that request; this one has none to hand back.
 */
export const invitationAlreadyPending = (): ConflictException =>
  new ConflictException(
    'An invitation for this email address was just created',
    { errorCode: InvitationsErrorCode.INVITATION_ALREADY_PENDING },
  );

/**
 * A signed-in caller presenting an invitation issued to another address.
 * Names neither address.
 */
export const invitationEmailMismatch = (): ForbiddenException =>
  new ForbiddenException(
    'This invitation was issued to a different email address',
    { errorCode: InvitationsErrorCode.INVITATION_EMAIL_MISMATCH },
  );

export const alreadyAMember = (): ConflictException =>
  new ConflictException('Already a member of this organization', {
    errorCode: InvitationsErrorCode.ALREADY_A_MEMBER,
  });
