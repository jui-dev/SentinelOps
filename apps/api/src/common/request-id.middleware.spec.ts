import type { NextFunction, Request, Response } from 'express';

import { REQUEST_ID_HEADER } from './api-error.contract.js';
import { getRequestClient, getRequestId } from './request-context.js';
import {
  requestClientOf,
  RequestIdMiddleware,
  USER_AGENT_MAX_LENGTH,
} from './request-id.middleware.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('RequestIdMiddleware', () => {
  let middleware: RequestIdMiddleware;
  const setHeader = vi.fn();
  const next = vi.fn();

  const run = (inbound?: string | string[]) => {
    const req = {
      headers: inbound === undefined ? {} : { [REQUEST_ID_HEADER]: inbound },
    } as unknown as Request;

    middleware.use(
      req,
      { setHeader } as unknown as Response,
      next as NextFunction,
    );

    return req.headers[REQUEST_ID_HEADER];
  };

  beforeEach(() => {
    middleware = new RequestIdMiddleware();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('assignment', () => {
    it('should generate a uuid when no id arrives', () => {
      expect(run()).toMatch(UUID);
    });

    it('should reuse a well-formed inbound id', () => {
      expect(run('my-trace-123')).toBe('my-trace-123');
    });

    it('should take the first entry when the header repeats', () => {
      expect(run(['first-id', 'second-id'])).toBe('first-id');
    });

    it('should expose the id on the response header', () => {
      const requestId = run();

      expect(setHeader).toHaveBeenCalledWith('X-Request-Id', requestId);
    });

    it('should always continue the chain', () => {
      run();

      expect(next).toHaveBeenCalledOnce();
    });

    it('should publish the id as ambient context for the rest of the chain', () => {
      // What lets a logger correlate a line without being handed the Request.
      let seen: string | undefined;
      next.mockImplementation(() => {
        seen = getRequestId();
      });

      const requestId = run();

      expect(seen).toBe(requestId);
    });

    it('should not leave the context set once the chain returns', () => {
      run();

      expect(getRequestId()).toBeUndefined();
    });
  });

  describe('rejecting unsafe inbound ids', () => {
    it.each([
      ['a header injection attempt', 'abc\r\nX-Injected: evil'],
      ['a quoted value', 'aaa"; DROP--'],
      ['whitespace', 'has spaces'],
      ['an overlong value', 'a'.repeat(129)],
      ['an empty value', ''],
    ])('should regenerate the id for %s', (_case, hostile) => {
      const requestId = run(hostile);

      expect(requestId).toMatch(UUID);
      expect(requestId).not.toBe(hostile);
      expect(setHeader).toHaveBeenCalledWith('X-Request-Id', requestId);
    });

    it('should accept a value at exactly the length limit', () => {
      const atLimit = 'a'.repeat(128);

      expect(run(atLimit)).toBe(atLimit);
    });
  });
});

describe('requestClientOf', () => {
  const of = (ip: string | undefined, agent?: string) =>
    requestClientOf({
      ip,
      headers: agent === undefined ? {} : { 'user-agent': agent },
    } as unknown as Request);

  it('should keep the address and the browser', () => {
    expect(of('10.0.4.2', 'Mozilla/5.0 Chrome/130.0')).toEqual({
      ipAddress: '10.0.4.2',
      userAgent: 'Mozilla/5.0 Chrome/130.0',
    });
  });

  it('should say nothing for what was not sent', () => {
    expect(of(undefined)).toEqual({ ipAddress: null, userAgent: null });
    expect(of('10.0.4.2', '   ').userAgent).toBeNull();
  });

  it('should cut a User-Agent longer than any browser sends', () => {
    expect(of('10.0.4.2', 'x'.repeat(5000)).userAgent).toHaveLength(
      USER_AGENT_MAX_LENGTH,
    );
  });

  it('should publish it on the request context', () => {
    let seen: unknown;

    new RequestIdMiddleware().use(
      {
        ip: '10.0.4.9',
        headers: { 'user-agent': 'Firefox' },
      } as unknown as Request,
      { setHeader: vi.fn() } as unknown as Response,
      (() => {
        seen = getRequestClient();
      }) as NextFunction,
    );

    expect(seen).toEqual({ ipAddress: '10.0.4.9', userAgent: 'Firefox' });
  });
});
