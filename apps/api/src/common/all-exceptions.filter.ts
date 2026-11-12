import { randomUUID } from 'node:crypto';
import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import type { Request } from 'express';

import {
  INTERNAL_ERROR_MESSAGE,
  REQUEST_ID_HEADER,
} from './api-error.contract.js';
import type {
  ApiErrorResponse,
  ValidationErrorDetail,
} from './api-error.contract.js';
import { TooManyRequestsException } from './too-many-requests.exception.js';

/**
 * Renders a status code as its canonical reason phrase by reversing the
 * HttpStatus enum: 400 -> BAD_REQUEST -> "Bad Request". Derived from the status
 * rather than read from the thrown body, so a caller cannot put an arbitrary
 * string in the contract's `error` field.
 */
const reasonPhrase = (statusCode: number): string => {
  const name: string | undefined = HttpStatus[statusCode as HttpStatus];

  if (!name) {
    return 'Error';
  }

  return name
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string');

/**
 * Rebuilds `details` from an unknown value, keeping only well-formed entries
 * and copying just `field` and `message`. The thrown body is untrusted input as
 * far as the contract is concerned, so extra keys are dropped rather than
 * spread into the response.
 */
const toValidationDetails = (
  value: unknown,
): ValidationErrorDetail[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const details: ValidationErrorDetail[] = [];

  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) {
      continue;
    }

    const { field, message } = entry as Partial<ValidationErrorDetail>;

    if (typeof field === 'string' && typeof message === 'string') {
      details.push({ field, message });
    }
  }

  return details.length > 0 ? details : undefined;
};

/**
 * The single place any thrown value becomes an HTTP response body.
 *
 * One filter catching everything, rather than several narrower ones: Nest
 * resolves an exception by taking the first registered filter whose `@Catch()`
 * matches, which makes the effective behaviour of multiple global filters
 * depend on provider registration order. Branching inside one filter keeps that
 * ordering out of the design entirely.
 *
 * It deliberately does not extend `BaseExceptionFilter`, whose `catch()` passes
 * an object response straight through — precisely the behaviour that produces
 * inconsistent bodies. It does borrow two things that filter gets right: going
 * through `HttpAdapterHost` rather than reaching for Express directly, and
 * guarding on `isHeadersSent`.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly httpAdapterHost: HttpAdapterHost) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.httpAdapterHost;
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse();

    const body = this.toErrorResponse(exception, request);

    this.log(exception, body);

    // An error thrown after the response has begun cannot be re-bodied; ending
    // the stream is all that is left, and is better than a double-send crash.
    if (httpAdapter.isHeadersSent(response)) {
      httpAdapter.end(response);
      return;
    }

    // A 429 says how long to wait, in the header clients and proxies read.
    if (exception instanceof TooManyRequestsException) {
      httpAdapter.setHeader(
        response,
        'Retry-After',
        String(exception.retryAfterSeconds),
      );
    }

    httpAdapter.reply(response, body, body.statusCode);
  }

  private toErrorResponse(
    exception: unknown,
    request: Request,
  ): ApiErrorResponse {
    const context = {
      requestId: this.readRequestId(request),
      timestamp: new Date().toISOString(),
      path: request?.originalUrl ?? request?.url ?? '',
    };

    // Anything that is not an HttpException is unexpected, and unexpected
    // means its message is an implementation detail. Mask it: the real error
    // is logged against the same requestId.
    if (!(exception instanceof HttpException)) {
      return {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        error: reasonPhrase(HttpStatus.INTERNAL_SERVER_ERROR),
        message: INTERNAL_ERROR_MESSAGE,
        ...context,
      };
    }

    const statusCode = exception.getStatus();
    const { message, details } = this.describe(
      exception.getResponse(),
      statusCode,
    );

    return {
      statusCode,
      error: reasonPhrase(statusCode),
      message,
      ...(exception.errorCode ? { code: exception.errorCode } : {}),
      ...(details ? { details } : {}),
      ...context,
    };
  }

  /**
   * Reduces an HttpException's response — a string, our own structured
   * validation payload, or one of Nest's several built-in object shapes — to a
   * single string message plus optional field details.
   */
  private describe(
    response: string | object,
    statusCode: number,
  ): { message: string; details?: ValidationErrorDetail[] } {
    if (typeof response === 'string') {
      return { message: response };
    }

    const { message: raw, details: rawDetails } = response as {
      message?: unknown;
      details?: unknown;
    };

    let message = reasonPhrase(statusCode);
    let details = toValidationDetails(rawDetails);

    if (typeof raw === 'string') {
      message = raw;
    } else if (isStringArray(raw) && raw.length > 0) {
      // Nest's own validation errors arrive as `message: string[]`. Collapse
      // them so `message` stays a string and the entries stay reachable.
      message = raw[0];
      details ??= raw.map((entry) => ({ field: '', message: entry }));
    }

    return details ? { message, details } : { message };
  }

  /**
   * Reads the id assigned by RequestIdMiddleware. The fallback covers requests
   * that failed before the middleware ran, so the field is always a usable id
   * rather than an empty string.
   */
  private readRequestId(request: Request): string {
    const header = request?.headers?.[REQUEST_ID_HEADER];
    const value = Array.isArray(header) ? header[0] : header;

    return typeof value === 'string' && value.length > 0
      ? value
      : randomUUID();
  }

  /**
   * This filter replaces BaseExceptionFilter, which is where Nest logged
   * unhandled errors — if it does not log them, nothing does. 5xx carries the
   * stack; 4xx is ordinary client behaviour and is left at debug so routine
   * mistakes do not fill the log.
   *
   * This is the *diagnostic* record — what went wrong. The matching lifecycle
   * record (method, duration, status) comes from HttpLoggerMiddleware, which
   * logs every request whether it failed or not. Two lines for one failure is
   * intended: they answer different questions and share a requestId, so they
   * join.
   *
   * The status and path travel as structured params rather than interpolated
   * into the message, so they are queryable fields in JSON output. requestId is
   * deliberately not passed: AppLogger contributes it from the ambient context,
   * which is the same value in every path where the middleware ran.
   */
  private log(exception: unknown, body: ApiErrorResponse): void {
    const params = { statusCode: body.statusCode, path: body.path };

    if (body.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        exception instanceof Error ? exception.message : String(exception),
        exception instanceof Error ? exception.stack : undefined,
        params,
      );
      return;
    }

    this.logger.debug(body.message, params);
  }
}
