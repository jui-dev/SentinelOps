import { ConflictException, NotFoundException } from '@nestjs/common';

/**
 * The machine-readable `code` values this module puts on the error contract.
 * Part of the public API, like AuthErrorCode.
 *
 * An owner team that is not in the organization answers with teams' own
 * TEAM_NOT_FOUND, as a membership id answers with MEMBERSHIP_NOT_FOUND on the
 * team routes: one code per kind of thing that was not found.
 */
export const ServicesErrorCode = {
  SERVICE_NOT_FOUND: 'SERVICE_NOT_FOUND',
  SERVICE_NAME_TAKEN: 'SERVICE_NAME_TAKEN',
} as const;

export type ServicesErrorCode =
  (typeof ServicesErrorCode)[keyof typeof ServicesErrorCode];

/**
 * The single answer for a service that is not visible within the admitted
 * organization: malformed id, no such row, or a row belonging to another
 * organization. A service in another tenant answers exactly as a nonexistent
 * one.
 */
export const serviceNotFound = (): NotFoundException =>
  new NotFoundException('Service not found', {
    errorCode: ServicesErrorCode.SERVICE_NOT_FOUND,
  });

/**
 * Another service in the organization already has this name — or, at
 * creation, one that differs only by case or punctuation, which the derived
 * slug catches. The slug is never mentioned: clients do not choose it.
 */
export const serviceNameTaken = (): ConflictException =>
  new ConflictException(
    'A service with this name, or a very similar one, already exists',
    { errorCode: ServicesErrorCode.SERVICE_NAME_TAKEN },
  );
