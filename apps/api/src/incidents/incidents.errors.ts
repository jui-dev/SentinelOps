import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

/**
 * The machine-readable `code` values this module puts on the error contract.
 * Part of the public API, like AuthErrorCode.
 *
 * A service or team named in a body answers with its own module's code —
 * SERVICE_NOT_FOUND, SERVICE_ARCHIVED, TEAM_NOT_FOUND: one code per kind of
 * thing.
 */
export const IncidentsErrorCode = {
  INCIDENT_NOT_FOUND: 'INCIDENT_NOT_FOUND',
  INCIDENT_RESOLVED: 'INCIDENT_RESOLVED',
  INVALID_CURSOR: 'INVALID_CURSOR',
} as const;

export type IncidentsErrorCode =
  (typeof IncidentsErrorCode)[keyof typeof IncidentsErrorCode];

/**
 * The single answer for an incident that is not visible within the admitted
 * organization: a malformed number, no such incident, or — since numbers are
 * per organization — anything another tenant holds.
 */
export const incidentNotFound = (): NotFoundException =>
  new NotFoundException('Incident not found', {
    errorCode: IncidentsErrorCode.INCIDENT_NOT_FOUND,
  });

/**
 * The incident is resolved, and a resolved incident is not changed. If the
 * problem returns, it is a new incident.
 */
export const incidentResolved = (): ConflictException =>
  new ConflictException(
    'This incident is resolved and can no longer be changed',
    {
      errorCode: IncidentsErrorCode.INCIDENT_RESOLVED,
    },
  );

/**
 * A page cursor this list did not issue. A query parameter is part of the
 * request, so a malformed one is a 400 rather than a lookup that finds
 * nothing.
 */
export const invalidCursor = (): BadRequestException =>
  new BadRequestException('Invalid page cursor', {
    errorCode: IncidentsErrorCode.INVALID_CURSOR,
  });
