import type { NextFunction, Request, Response } from 'express';

import { REQUEST_ID_HEADER } from './api-error.contract.js';
import { getRequestId } from './request-context.js';
import { RequestIdMiddleware } from './request-id.middleware.js';

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

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
