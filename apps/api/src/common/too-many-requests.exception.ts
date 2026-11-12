import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * 429: the caller must wait before trying again. Carries how long, which
 * AllExceptionsFilter sends as the standard `Retry-After` header alongside
 * the usual error body.
 */
export class TooManyRequestsException extends HttpException {
  constructor(
    message: string,
    readonly retryAfterSeconds: number,
    errorCode: string,
  ) {
    super(message, HttpStatus.TOO_MANY_REQUESTS, { errorCode });
  }
}
