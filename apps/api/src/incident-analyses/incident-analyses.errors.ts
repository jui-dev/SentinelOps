import { ConflictException, NotFoundException } from '@nestjs/common';

/**
 * The machine-readable `code` values this module puts on the error contract.
 * Part of the public API, like IncidentsErrorCode.
 *
 * An incident or membership that is not visible answers with its own
 * module's code — INCIDENT_NOT_FOUND, MEMBERSHIP_NOT_FOUND: one code per kind
 * of thing.
 */
export const IncidentAnalysesErrorCode = {
  ANALYSIS_NOT_STARTED: 'ANALYSIS_NOT_STARTED',
  INCIDENT_NOT_RESOLVED: 'INCIDENT_NOT_RESOLVED',
  ANALYSIS_ALREADY_STARTED: 'ANALYSIS_ALREADY_STARTED',
} as const;

export type IncidentAnalysesErrorCode =
  (typeof IncidentAnalysesErrorCode)[keyof typeof IncidentAnalysesErrorCode];

/**
 * The incident is visible, and nobody has started its analysis. Starting one
 * is optional, so this is an ordinary answer, not a fault. Only ever given
 * once the incident itself has been found in the admitted organization.
 */
export const analysisNotStarted = (): NotFoundException =>
  new NotFoundException('This incident has no analysis', {
    errorCode: IncidentAnalysesErrorCode.ANALYSIS_NOT_STARTED,
  });

/**
 * An analysis is written about how an incident went, so it begins once the
 * incident is resolved.
 */
export const incidentNotResolved = (): ConflictException =>
  new ConflictException(
    'An incident analysis can begin once the incident is resolved',
    { errorCode: IncidentAnalysesErrorCode.INCIDENT_NOT_RESOLVED },
  );

/** An incident has one analysis, and this one's has already been started. */
export const analysisAlreadyStarted = (): ConflictException =>
  new ConflictException('This incident’s analysis has already been started', {
    errorCode: IncidentAnalysesErrorCode.ANALYSIS_ALREADY_STARTED,
  });
