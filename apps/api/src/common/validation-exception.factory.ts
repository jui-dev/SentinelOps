import { BadRequestException } from '@nestjs/common';
import type { StandardSchemaValidationPipeOptions } from '@nestjs/common';

import type { ValidationErrorDetail } from './api-error.contract.js';

/**
 * The issue type `StandardSchemaValidationPipe` hands to its `exceptionFactory`.
 *
 * Derived from the pipe's own options rather than imported from
 * `@standard-schema/spec`: that package is a dependency of `@nestjs/common`,
 * not of this one, so under pnpm's strict layout it is not resolvable from
 * here. Deriving it keeps the type exact without adding a dependency for a
 * type that is already reachable.
 */
type ValidationIssues = Parameters<
  NonNullable<StandardSchemaValidationPipeOptions['exceptionFactory']>
>[0];

type ValidationIssue = ValidationIssues[number];

/** Message used for every validation failure, regardless of which fields failed. */
export const VALIDATION_FAILED_MESSAGE = 'Request validation failed';

/**
 * Renders a Standard Schema issue path as a dotted string (`items.0.qty`).
 *
 * Path segments arrive either as raw keys or as `{ key }` objects — the spec
 * permits both — so both are handled. A root-level issue has no path and is
 * reported against an empty field.
 */
export const formatIssuePath = (path: ValidationIssue['path']): string => {
  if (!path?.length) {
    return '';
  }

  return path
    .map((segment) =>
      typeof segment === 'object' && segment !== null && 'key' in segment
        ? String(segment.key)
        : String(segment),
    )
    .join('.');
};

/**
 * Turns schema validation issues into a `BadRequestException` already shaped
 * like the API error contract: a single string message, with the per-field
 * failures in `details`.
 *
 * Only each issue's message and path cross this boundary. The schema library's
 * own issue internals — expected type, received value, issue code — are
 * dropped, so a validation response never echoes back what was submitted or
 * describes the schema's shape.
 *
 * Typed against the pipe's issue type rather than against Zod's, so the
 * validation layer is not welded to one schema library.
 */
export const validationExceptionFactory = (
  issues: ValidationIssues,
): BadRequestException =>
  new BadRequestException({
    message: VALIDATION_FAILED_MESSAGE,
    details: issues.map(
      (issue): ValidationErrorDetail => ({
        field: formatIssuePath(issue.path),
        message: issue.message,
      }),
    ),
  });
