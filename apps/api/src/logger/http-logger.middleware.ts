import { Injectable, Logger } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { getRequestId } from '../common/request-context.js';
import { redactUrl } from './redact.js';

const NANOSECONDS_PER_MILLISECOND = 1_000_000;

/**
 * Emits one line per completed request: the access record.
 *
 * A middleware rather than an interceptor, because an interceptor only runs for
 * requests that matched a route — 404s, the case where an access log is most
 * often consulted, would be invisible. This runs on `{*path}`, the same
 * coverage RequestIdMiddleware already has.
 *
 * It records on `finish` rather than at entry, so status and duration are real
 * rather than predicted, and it deliberately logs nothing else: no request
 * body, no response body, no headers beyond the correlation id, which the
 * logger contributes from the ambient context.
 *
 * A failed request therefore produces two lines — this one and the diagnostic
 * line from AllExceptionsFilter. That is intended: this record proves the
 * request arrived and how it ended, the filter's record explains why. Merging
 * them would cost one or the other.
 */
@Injectable()
export class HttpLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction): void {
    const startedAt = process.hrtime.bigint();
    // Read synchronously here, while unambiguously inside the context
    // RequestIdMiddleware established, and passed explicitly below rather than
    // left to AppLogger's ambient lookup. The ambient value does survive into
    // `finish` in practice, but that depends on the response being ended from
    // within the request's own async chain — which an infrastructure-level
    // timeout or abort need not do. The access log is the one record that must
    // never lose its correlation id.
    const requestId = getRequestId();

    // Registered inside the AsyncLocalStorage context established upstream by
    // RequestIdMiddleware, so the handler still sees the correlation id when it
    // runs after the response has been written.
    res.once('finish', () => {
      const durationMs =
        Number(process.hrtime.bigint() - startedAt) /
        NANOSECONDS_PER_MILLISECOND;

      const method = req.method;
      const path = redactUrl(req.originalUrl ?? req.url ?? '');
      const statusCode = res.statusCode;
      // Sub-millisecond requests are common on health checks; one decimal keeps
      // them from all reading as 0ms without implying false precision.
      const duration = Math.round(durationMs * 10) / 10;

      const message = `${method} ${path} ${statusCode} ${duration}ms`;
      const params = {
        ...(requestId ? { requestId } : {}),
        method,
        path,
        statusCode,
        durationMs: duration,
      };

      if (statusCode >= 500) {
        this.logger.error(message, undefined, params);
        return;
      }

      if (statusCode >= 400) {
        this.logger.warn(message, params);
        return;
      }

      this.logger.log(message, params);
    });

    next();
  }
}
