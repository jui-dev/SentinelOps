import { z } from "zod";

import type { ValidationErrorDetail } from "./contracts";

/** A response from the API that was not a success. */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly code?: string;
  readonly details: ValidationErrorDetail[];
  readonly requestId?: string;

  constructor(init: {
    statusCode: number;
    message: string;
    code?: string;
    details?: ValidationErrorDetail[];
    requestId?: string;
  }) {
    super(init.message);
    this.name = "ApiError";
    this.statusCode = init.statusCode;
    this.code = init.code;
    this.details = init.details ?? [];
    this.requestId = init.requestId;
  }
}

/** The API could not be reached at all: offline, refused, or blocked by CORS. */
export class NetworkError extends Error {
  constructor() {
    super("The SentinelOps API could not be reached");
    this.name = "NetworkError";
  }
}

/**
 * The error contract, read defensively. Only the fields the client uses are
 * required; anything else a body carries is ignored rather than trusted.
 */
const errorBodySchema = z.object({
  message: z.string(),
  code: z.string().optional(),
  details: z
    .array(z.object({ field: z.string(), message: z.string() }))
    .optional(),
  requestId: z.string().optional(),
});

/**
 * Builds an `ApiError` from a failed response. A body that is not the
 * contract — a proxy's HTML page, an empty 502 — still yields a usable error
 * carrying the real status code.
 */
export const toApiError = async (response: Response): Promise<ApiError> => {
  let body: unknown;

  try {
    body = await response.json();
  } catch {
    body = undefined;
  }

  const parsed = errorBodySchema.safeParse(body);

  if (parsed.success) {
    return new ApiError({ statusCode: response.status, ...parsed.data });
  }

  return new ApiError({
    statusCode: response.status,
    message: response.statusText || "Request failed",
  });
};

export const isApiError = (
  error: unknown,
  statusCode?: number,
): error is ApiError =>
  error instanceof ApiError &&
  (statusCode === undefined || error.statusCode === statusCode);

/**
 * The first validation message for each field of a failed request, keyed by
 * the API's dotted field path. Empty for anything but a validation failure.
 */
export const fieldErrorsOf = (error: unknown): Record<string, string> => {
  if (!(error instanceof ApiError)) return {};

  const fields: Record<string, string> = {};

  for (const { field, message } of error.details) {
    fields[field] ??= message;
  }

  return fields;
};
