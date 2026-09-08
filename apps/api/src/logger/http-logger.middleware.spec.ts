import { EventEmitter } from 'node:events';
import { Logger } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { runWithRequestContext } from '../common/request-context.js';
import { HttpLoggerMiddleware } from './http-logger.middleware.js';
import { REDACTED } from './redact.js';

describe('HttpLoggerMiddleware', () => {
  let middleware: HttpLoggerMiddleware;

  const next = vi.fn();
  const logLog = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  const warnLog = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  const errorLog = vi
    .spyOn(Logger.prototype, 'error')
    .mockImplementation(() => undefined);

  /**
   * Drives one request through the middleware. The response is an EventEmitter,
   * because the middleware logs on 'finish' rather than at entry.
   */
  const run = ({
    method = 'GET',
    originalUrl = '/api/v1/health',
    statusCode = 200,
    finish = true,
  } = {}) => {
    const res = Object.assign(new EventEmitter(), {
      statusCode,
    }) as unknown as Response;

    middleware.use(
      { method, originalUrl } as unknown as Request,
      res,
      next as NextFunction,
    );

    if (finish) {
      (res as unknown as EventEmitter).emit('finish');
    }

    return res;
  };

  /** The params object from whichever level was used. */
  const paramsOf = (spy: typeof logLog | typeof warnLog) =>
    spy.mock.calls[0][1] as Record<string, unknown>;

  beforeEach(() => {
    middleware = new HttpLoggerMiddleware();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('the request lifecycle', () => {
    it('should always continue the chain', () => {
      run();

      expect(next).toHaveBeenCalledOnce();
    });

    it('should log nothing before the response finishes', () => {
      run({ finish: false });

      expect(logLog).not.toHaveBeenCalled();
      expect(warnLog).not.toHaveBeenCalled();
      expect(errorLog).not.toHaveBeenCalled();
    });

    it('should log exactly once per request', () => {
      run();

      expect(logLog).toHaveBeenCalledOnce();
    });

    it('should record the method, path, status, and duration', () => {
      run({ method: 'POST', originalUrl: '/api/v1/incidents', statusCode: 201 });

      expect(paramsOf(logLog)).toMatchObject({
        method: 'POST',
        path: '/api/v1/incidents',
        statusCode: 201,
      });
      expect(typeof paramsOf(logLog).durationMs).toBe('number');
      expect(paramsOf(logLog).durationMs as number).toBeGreaterThanOrEqual(0);
    });

    it('should summarise the request in the message', () => {
      run({ method: 'POST', originalUrl: '/api/v1/incidents', statusCode: 201 });

      expect(logLog.mock.calls[0][0] as string).toContain(
        'POST /api/v1/incidents 201',
      );
    });
  });

  describe('level by status', () => {
    it.each([
      ['a 200', 200],
      ['a 201', 201],
      ['a 301', 301],
    ])('should log %s at log level', (_case, statusCode) => {
      run({ statusCode });

      expect(logLog).toHaveBeenCalledOnce();
      expect(warnLog).not.toHaveBeenCalled();
      expect(errorLog).not.toHaveBeenCalled();
    });

    it.each([
      ['a 400', 400],
      ['a 404', 404],
      ['a 422', 422],
    ])('should log %s at warn level', (_case, statusCode) => {
      run({ statusCode });

      expect(warnLog).toHaveBeenCalledOnce();
      expect(logLog).not.toHaveBeenCalled();
    });

    it.each([
      ['a 500', 500],
      ['a 503', 503],
    ])('should log %s at error level', (_case, statusCode) => {
      run({ statusCode });

      expect(errorLog).toHaveBeenCalledOnce();
      expect(logLog).not.toHaveBeenCalled();
    });

    it('should not pass a stack for a 5xx', () => {
      // The stack belongs to the diagnostic record from AllExceptionsFilter.
      // This is the lifecycle record; it has no exception in hand.
      run({ statusCode: 500 });

      expect(errorLog.mock.calls[0][1]).toBeUndefined();
    });
  });

  describe('correlation', () => {
    it('should carry the request id from the ambient context', () => {
      runWithRequestContext({ requestId: 'req-1' }, () => run());

      expect(paramsOf(logLog)).toMatchObject({ requestId: 'req-1' });
    });

    it('should capture the id at entry, not at finish', () => {
      // The id is read while the middleware runs, so a 'finish' fired from
      // outside the context still logs correlated.
      const res = runWithRequestContext({ requestId: 'req-1' }, () =>
        run({ finish: false }),
      );

      (res as unknown as EventEmitter).emit('finish');

      expect(paramsOf(logLog)).toMatchObject({ requestId: 'req-1' });
    });

    it('should omit the id when there is no context', () => {
      run();

      expect(paramsOf(logLog)).not.toHaveProperty('requestId');
    });
  });

  describe('sensitive data', () => {
    it('should redact a secret in the query string', () => {
      run({ originalUrl: '/api/v1/health?token=hunter2&page=2' });

      expect(JSON.stringify(logLog.mock.calls[0])).not.toContain('hunter2');
      expect(paramsOf(logLog).path).toBe(
        `/api/v1/health?token=${REDACTED}&page=2`,
      );
    });

    it('should log no body or headers', () => {
      run();

      expect(Object.keys(paramsOf(logLog)).sort()).toEqual([
        'durationMs',
        'method',
        'path',
        'statusCode',
      ]);
    });
  });
});
