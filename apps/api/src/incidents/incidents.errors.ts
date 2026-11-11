import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
  INVALID_STATUS_TRANSITION: 'INVALID_STATUS_TRANSITION',
  INVALID_CURSOR: 'INVALID_CURSOR',
  NOT_ON_RESPONSIBLE_TEAM: 'NOT_ON_RESPONSIBLE_TEAM',
  START_INVESTIGATING_FIRST: 'START_INVESTIGATING_FIRST',
  RESPONSE_ALREADY_COMPLETED: 'RESPONSE_ALREADY_COMPLETED',
  NOT_INVESTIGATING: 'NOT_INVESTIGATING',
  RESPONDERS_STILL_INVESTIGATING: 'RESPONDERS_STILL_INVESTIGATING',
  RESPONSE_NOT_OPEN: 'RESPONSE_NOT_OPEN',
  NOT_ASSIGNED_TO_INCIDENT: 'NOT_ASSIGNED_TO_INCIDENT',
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
 * The incident cannot move to that status from where it stands: the
 * lifecycle is DECLARED → INVESTIGATING → RESOLVED, one step at a time. A
 * DECLARED incident is investigated — someone starts investigating it —
 * before it is resolved.
 */
export const invalidStatusTransition = (
  from: string,
  to: string,
): ConflictException =>
  new ConflictException(`An incident that is ${from} cannot move to ${to}`, {
    errorCode: IncidentsErrorCode.INVALID_STATUS_TRANSITION,
  });

/**
 * A page cursor this list did not issue. A query parameter is part of the
 * request, so a malformed one is a 400 rather than a lookup that finds
 * nothing.
 */
export const invalidCursor = (): BadRequestException =>
  new BadRequestException('Invalid page cursor', {
    errorCode: IncidentsErrorCode.INVALID_CURSOR,
  });

/**
 * The caller may respond to incidents, but may not start investigating this
 * one: they are not on its responsible team. Reading it is still open to
 * them.
 *
 * 403, and specific, rather than PERMISSION_DENIED: the refusal is about this
 * incident, not the caller's role, and a client explains it by naming the
 * team. Given only after the incident is found, so it reveals nothing about
 * another organization's incidents.
 */
export const notOnResponsibleTeam = (): ForbiddenException =>
  new ForbiddenException(
    "Only members of this incident's responsible team can start investigating it",
    {
      errorCode: IncidentsErrorCode.NOT_ON_RESPONSIBLE_TEAM,
    },
  );

/** The Admin has not yet chosen who responds to this incident. */
export const responseNotOpen = (): ConflictException =>
  new ConflictException(
    'The Admin has not yet chosen who responds to this incident',
    { errorCode: IncidentsErrorCode.RESPONSE_NOT_OPEN },
  );

/** The incident is assigned to specific people, and the caller is not one. */
export const notAssignedToIncident = (): ForbiddenException =>
  new ForbiddenException(
    'Only the people assigned to this incident can start responding to it',
    { errorCode: IncidentsErrorCode.NOT_ASSIGNED_TO_INCIDENT },
  );

/**
 * A member posting an update to an incident they have not started
 * investigating. Updates are part of a response: a responsible-team member
 * starts investigating first, and anyone else cannot respond at all.
 */
export const startInvestigatingFirst = (): ForbiddenException =>
  new ForbiddenException(
    'Start investigating this incident before posting updates to it',
    {
      errorCode: IncidentsErrorCode.START_INVESTIGATING_FIRST,
    },
  );

/**
 * The caller's response to this incident is complete, and a completed
 * response is final: it is not restarted, and takes no more updates.
 */
export const responseAlreadyCompleted = (): ConflictException =>
  new ConflictException('Your response to this incident is already complete', {
    errorCode: IncidentsErrorCode.RESPONSE_ALREADY_COMPLETED,
  });

/** Completing a response the caller never started. */
export const notInvestigating = (): ConflictException =>
  new ConflictException('You are not investigating this incident', {
    errorCode: IncidentsErrorCode.NOT_INVESTIGATING,
  });

/**
 * Resolving while someone is still investigating. The incident is resolved
 * once every responder has marked their response complete.
 */
export const respondersStillInvestigating = (
  investigating: number,
): ConflictException =>
  new ConflictException(
    investigating === 1
      ? 'A responder is still investigating this incident'
      : `${investigating} responders are still investigating this incident`,
    {
      errorCode: IncidentsErrorCode.RESPONDERS_STILL_INVESTIGATING,
    },
  );
