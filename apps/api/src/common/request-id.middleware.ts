import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import {
  REQUEST_ID_HEADER,
  REQUEST_ID_RESPONSE_HEADER,
} from './api-error.contract.js';

/**
 * A caller-supplied id is echoed into a response header and into log lines, so
 * it is only reused when it is short and unremarkable. Anything else — control
 * characters, quotes, newlines, an overlong value — is discarded in favour of a
 * generated id rather than being passed through into a header or a log.
 */
const SAFE_REQUEST_ID = /^[\w.:-]{1,128}$/;

export const isSafeRequestId = (value: unknown): value is string =>
  typeof value === 'string' && SAFE_REQUEST_ID.test(value);

/**
 * Assigns every request a correlation id, reusing the caller's when it is safe
 * to. The id is returned on every error response and logged alongside every
 * 5xx, so a client-visible failure can be tied to the server-side stack trace
 * that produced it.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const inbound = req.headers[REQUEST_ID_HEADER];
    const candidate = Array.isArray(inbound) ? inbound[0] : inbound;
    const requestId = isSafeRequestId(candidate) ? candidate : randomUUID();

    // Carried on the request headers rather than as a `req.requestId`
    // property: the header bag already accepts arbitrary string keys, so the
    // exception filter can read the id back without augmenting Express's
    // Request type — declaration merging is the most brittle option under
    // NodeNext ESM.
    req.headers[REQUEST_ID_HEADER] = requestId;
    res.setHeader(REQUEST_ID_RESPONSE_HEADER, requestId);

    next();
  }
}
