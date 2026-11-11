import { ConflictException, NotFoundException } from '@nestjs/common';

/**
 * The machine-readable `code` values this module puts on the error contract.
 * Part of the public API, like ServicesErrorCode.
 */
export const KnownIssuesErrorCode = {
  KNOWN_ISSUE_NOT_FOUND: 'KNOWN_ISSUE_NOT_FOUND',
  KNOWN_ISSUE_NAME_TAKEN: 'KNOWN_ISSUE_NAME_TAKEN',
  KNOWN_ISSUE_ARCHIVED: 'KNOWN_ISSUE_ARCHIVED',
  KNOWN_ISSUE_OTHER_SERVICE: 'KNOWN_ISSUE_OTHER_SERVICE',
  KNOWN_ISSUE_MERGE_INTO_ITSELF: 'KNOWN_ISSUE_MERGE_INTO_ITSELF',
} as const;

export type KnownIssuesErrorCode =
  (typeof KnownIssuesErrorCode)[keyof typeof KnownIssuesErrorCode];

/**
 * The single answer for a known issue that is not visible within the
 * admitted organization: malformed id, no such row, another organization's,
 * or — when declaring — one of another service's, which the incident could
 * never link to.
 */
export const knownIssueNotFound = (): NotFoundException =>
  new NotFoundException('Known issue not found', {
    errorCode: KnownIssuesErrorCode.KNOWN_ISSUE_NOT_FOUND,
  });

/** The service already has a known issue by this name, in any case. */
export const knownIssueNameTaken = (): ConflictException =>
  new ConflictException(
    'This service already has a known issue with this name',
    { errorCode: KnownIssuesErrorCode.KNOWN_ISSUE_NAME_TAKEN },
  );

/**
 * The known issue is archived: no longer offered, and not available for new
 * incidents. Its earlier incidents keep it.
 */
export const knownIssueArchived = (): ConflictException =>
  new ConflictException(
    'This known issue is archived. Choose another, or restore it first',
    { errorCode: KnownIssuesErrorCode.KNOWN_ISSUE_ARCHIVED },
  );

/** Two known issues of different services cannot be merged. */
export const knownIssueOtherService = (): ConflictException =>
  new ConflictException(
    'A known issue can only be merged into another of the same service',
    { errorCode: KnownIssuesErrorCode.KNOWN_ISSUE_OTHER_SERVICE },
  );

export const knownIssueMergeIntoItself = (): ConflictException =>
  new ConflictException('A known issue cannot be merged into itself', {
    errorCode: KnownIssuesErrorCode.KNOWN_ISSUE_MERGE_INTO_ITSELF,
  });
