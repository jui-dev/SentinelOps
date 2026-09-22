import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

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
  NOT_ANALYSIS_OWNER: 'NOT_ANALYSIS_OWNER',
  ANALYSIS_PUBLISHED: 'ANALYSIS_PUBLISHED',
  ANALYSIS_CHANGED: 'ANALYSIS_CHANGED',
  ANALYSIS_SUMMARY_REQUIRED: 'ANALYSIS_SUMMARY_REQUIRED',
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

/**
 * The caller may write incident analyses, but not this one: only its owner,
 * or whoever runs incidents' lifecycles, writes it. Reading it is still open
 * to them.
 */
export const notAnalysisOwner = (): ForbiddenException =>
  new ForbiddenException('Only this analysis’s owner can change it', {
    errorCode: IncidentAnalysesErrorCode.NOT_ANALYSIS_OWNER,
  });

/** A published analysis's written sections are final. */
export const analysisPublished = (): ConflictException =>
  new ConflictException(
    'This analysis is published and its sections can no longer be changed',
    { errorCode: IncidentAnalysesErrorCode.ANALYSIS_PUBLISHED },
  );

/**
 * The analysis has changed since the version the request was based on.
 * Nothing was applied: read it again, and make the change against what it
 * says now.
 */
export const analysisChanged = (): ConflictException =>
  new ConflictException('This analysis has changed since you last read it', {
    errorCode: IncidentAnalysesErrorCode.ANALYSIS_CHANGED,
  });

/**
 * A published analysis says, at least, what happened. The summary is the
 * only section publishing requires: impact, cause, and lessons may honestly
 * be unknown.
 */
export const analysisSummaryRequired = (): ConflictException =>
  new ConflictException('Write a summary before publishing this analysis', {
    errorCode: IncidentAnalysesErrorCode.ANALYSIS_SUMMARY_REQUIRED,
  });
