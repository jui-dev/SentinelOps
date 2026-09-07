/**
 * The response contract for every non-2xx response the API produces —
 * validation failures, thrown HTTP exceptions, unmatched routes, and
 * unhandled crashes alike. `AllExceptionsFilter` is the only place allowed to
 * construct it, so there is exactly one error shape to consume and one place
 * to change it.
 *
 * `message` is deliberately always a string. Nest's own error bodies alternate
 * between `string` and `string[]` depending on which exception produced them,
 * which forces every consumer to handle both. Field-level information lives in
 * `details` instead, where the element shape is stable.
 */
export interface ApiErrorResponse {
  /** Mirrors the HTTP status of the response. */
  statusCode: number;
  /** Canonical reason phrase for the status, e.g. `Bad Request`. */
  error: string;
  /** Human-readable summary. Always a string, never an array. */
  message: string;
  /**
   * Machine-readable error code, present only when the thrower sets one via
   * Nest's `HttpExceptionOptions.errorCode`. Nothing sets one yet — it exists
   * so that introducing codes later is additive rather than a contract break.
   */
  code?: string;
  /** Field-level failures. Present only when the error is field-scoped. */
  details?: ValidationErrorDetail[];
  /** Correlates this response with the server-side log entry for it. */
  requestId: string;
  /** ISO-8601 timestamp of when the response was composed. */
  timestamp: string;
  /** The request path that produced the error. */
  path: string;
}

/**
 * A single field-level failure. `field` is a dotted path from the root of the
 * validated value (`items.0.qty`), or an empty string for an issue that
 * applies to the value as a whole.
 */
export interface ValidationErrorDetail {
  field: string;
  message: string;
}

/**
 * Lowercase header name, for reading off `req.headers` — Node lowercases
 * inbound header names.
 */
export const REQUEST_ID_HEADER = 'x-request-id';

/** Canonical casing, for writing the header onto a response. */
export const REQUEST_ID_RESPONSE_HEADER = 'X-Request-Id';

/**
 * The only message an unexpected error is allowed to return. Anything that is
 * not an `HttpException` is masked with this, so driver errors, stack traces,
 * and constraint names never reach a client.
 */
export const INTERNAL_ERROR_MESSAGE = 'Internal server error';
