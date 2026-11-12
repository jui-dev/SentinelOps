import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import {
  REQUEST_ID_HEADER,
  REQUEST_ID_RESPONSE_HEADER,
} from './api-error.contract.js';
import { runWithRequestContext } from './request-context.js';
import type { RequestClient } from './request-context.js';

/**
 * A caller-supplied id is echoed into a response header and into log lines, so
 * it is only reused when it is short and unremarkable. Anything else — control
 * characters, quotes, newlines, an overlong value — is discarded in favour of a
 * generated id rather than being passed through into a header or a log.
 */
const SAFE_REQUEST_ID = /^[\w.:-]{1,128}$/;

/**
 * Longer than any real browser's User-Agent. It is a header the caller
 * chooses, so it is cut rather than stored at whatever length was sent.
 */
export const USER_AGENT_MAX_LENGTH = 400;

/** The address and browser a request came from, as the log keeps them. */
export const requestClientOf = (req: Request): RequestClient => {
  const agent = req.headers['user-agent'];

  return {
    ipAddress: req.ip ?? null,
    userAgent:
      typeof agent === 'string' && agent.trim() !== ''
        ? agent.trim().slice(0, USER_AGENT_MAX_LENGTH)
        : null,
  };
};

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

    // The id is also published as ambient context, so a logger can correlate a
    // line without being handed the Request. Established here rather than in a
    // second middleware to keep generation and context entry atomic: there is
    // no window in which the header is set but a log line would come out
    // uncorrelated. `run` invokes its callback synchronously, so this behaves
    // exactly as calling `next()` directly did.
    // Where it came from rides along too, for the activity log.
    runWithRequestContext({ requestId, client: requestClientOf(req) }, next);
  }
}
