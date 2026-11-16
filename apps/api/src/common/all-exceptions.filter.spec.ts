import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import type { HttpAdapterHost } from '@nestjs/core';

import { AllExceptionsFilter } from './all-exceptions.filter.js';
import {
  INTERNAL_ERROR_MESSAGE,
  REQUEST_ID_HEADER,
} from './api-error.contract.js';
import type { ApiErrorResponse } from './api-error.contract.js';

const REQUEST_ID = 'test-request-id';
const PATH = '/api/v1/incidents';

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;

  const reply = vi.fn();
  const end = vi.fn();
  const isHeadersSent = vi.fn().mockReturnValue(false);

  const errorLog = vi
    .spyOn(Logger.prototype, 'error')
    .mockImplementation(() => undefined);
  const debugLog = vi
    .spyOn(Logger.prototype, 'debug')
    .mockImplementation(() => undefined);

  /** Drives the filter and returns the body it handed to the adapter. */
  const capture = (
    exception: unknown,
    headers: Record<string, string | string[]> = {
      [REQUEST_ID_HEADER]: REQUEST_ID,
    },
  ): ApiErrorResponse => {
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ headers, originalUrl: PATH }),
        getResponse: () => ({}),
      }),
    } as unknown as ArgumentsHost;

    filter.catch(exception, host);

    return reply.mock.calls.at(-1)?.[1] as ApiErrorResponse;
  };

  beforeEach(() => {
    isHeadersSent.mockReturnValue(false);
    filter = new AllExceptionsFilter({
      httpAdapter: { reply, end, isHeadersSent },
    } as unknown as HttpAdapterHost);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('the contract', () => {
    it('should always include the correlation fields', () => {
      const body = capture(new NotFoundException('Incident not found'));

      expect(body.requestId).toBe(REQUEST_ID);
      expect(body.path).toBe(PATH);
      expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
    });

    it('should reply with the status from the body', () => {
      capture(new NotFoundException());

      expect(reply).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ statusCode: 404 }),
        404,
      );
    });

    it('should generate a request id when the middleware did not run', () => {
      expect(capture(new NotFoundException(), {}).requestId).toMatch(
        /^[0-9a-f-]{36}$/,
      );
    });

    it('should derive the reason phrase from the status, not the payload', () => {
      const body = capture(
        new HttpException({ error: 'Totally Made Up' }, HttpStatus.CONFLICT),
      );

      expect(body.error).toBe('Conflict');
    });
  });

  describe('HttpException with a string response', () => {
    it('should use the string as the message', () => {
      const body = capture(new NotFoundException('Incident not found'));

      expect(body).toMatchObject({
        statusCode: 404,
        error: 'Not Found',
        message: 'Incident not found',
      });
    });

    it('should fall back to the reason phrase when given no message', () => {
      expect(capture(new ServiceUnavailableException()).message).toBe(
        'Service Unavailable',
      );
    });

    it('should omit details', () => {
      expect(capture(new NotFoundException('nope')).details).toBeUndefined();
    });
  });

  describe('HttpException with an object response', () => {
    it('should keep a structured validation payload intact', () => {
      const body = capture(
        new BadRequestException({
          message: 'Request validation failed',
          details: [{ field: 'email', message: 'Invalid email address' }],
        }),
      );

      expect(body.message).toBe('Request validation failed');
      expect(body.details).toEqual([
        { field: 'email', message: 'Invalid email address' },
      ]);
    });

    it('should collapse a string[] message and keep the entries as details', () => {
      const body = capture(
        new BadRequestException(['email must be an email', 'name is required']),
      );

      expect(typeof body.message).toBe('string');
      expect(body.message).toBe('email must be an email');
      expect(body.details).toEqual([
        { field: '', message: 'email must be an email' },
        { field: '', message: 'name is required' },
      ]);
    });

    it('should fall back to the reason phrase when no message is usable', () => {
      const body = capture(
        new HttpException({ somethingElse: true }, HttpStatus.BAD_REQUEST),
      );

      expect(body.message).toBe('Bad Request');
      expect(body.details).toBeUndefined();
    });

    it('should drop malformed detail entries and extra keys', () => {
      const body = capture(
        new BadRequestException({
          message: 'Request validation failed',
          details: [
            { field: 'email', message: 'Invalid', received: 'bob@' },
            { field: 'nope' },
            'not an object',
            null,
          ],
        }),
      );

      expect(body.details).toEqual([{ field: 'email', message: 'Invalid' }]);
    });

    it('should not spread unknown payload keys into the response', () => {
      const body = capture(
        new ServiceUnavailableException({
          message: 'Database is not reachable',
          database: 'down',
          connectionString: 'postgresql://user:password@host/db',
        }),
      );

      expect(body).not.toHaveProperty('database');
      expect(body).not.toHaveProperty('connectionString');
      expect(JSON.stringify(body)).not.toContain('password');
    });
  });

  describe('the optional error code', () => {
    it('should surface errorCode as code when set', () => {
      const body = capture(
        new ConflictException('Already resolved', {
          errorCode: 'INCIDENT_ALREADY_RESOLVED',
        }),
      );

      expect(body.code).toBe('INCIDENT_ALREADY_RESOLVED');
    });

    it('should omit code when unset', () => {
      expect(
        capture(new ConflictException('Already resolved')),
      ).not.toHaveProperty('code');
    });
  });

  describe('unknown errors', () => {
    it.each([
      ['an Error', new Error('connect ECONNREFUSED 127.0.0.1:5432')],
      ['a thrown string', 'something went wrong'],
      ['null', null],
      ['undefined', undefined],
      ['a plain object', { code: 'P2002', meta: { target: ['email'] } }],
    ])('should mask %s as a generic 500', (_case, thrown) => {
      const body = capture(thrown);

      expect(body).toMatchObject({
        statusCode: 500,
        error: 'Internal Server Error',
        message: INTERNAL_ERROR_MESSAGE,
      });
      expect(body.details).toBeUndefined();
    });

    it('should not leak the original message or internals into the body', () => {
      const body = capture(
        new Error('connect ECONNREFUSED 127.0.0.1:5432 as user "postgres"'),
      );
      const serialised = JSON.stringify(body);

      expect(serialised).not.toContain('ECONNREFUSED');
      expect(serialised).not.toContain('postgres');
    });

    it('should not leak a Prisma-shaped error payload', () => {
      const prismaLike = Object.assign(
        new Error('Unique constraint failed on the fields: (`email`)'),
        { code: 'P2002', meta: { target: ['email'] } },
      );

      expect(JSON.stringify(capture(prismaLike))).not.toContain('P2002');
    });
  });

  describe('logging', () => {
    /**
     * This filter emits the *diagnostic* record — what went wrong and why. The
     * matching lifecycle record (method, duration, status) comes from
     * HttpLoggerMiddleware, which logs every request whether it failed or not.
     * Two lines for one failure is intended: they answer different questions
     * and share a requestId, so they join.
     */
    it('should log 5xx with the stack', () => {
      const error = new Error('boom');

      capture(error);

      expect(errorLog).toHaveBeenCalledOnce();
      expect(errorLog.mock.calls[0][0]).toBe('boom');
      expect(errorLog.mock.calls[0][1]).toBe(error.stack);
    });

    it('should log the status and path as structured params', () => {
      // Queryable fields in JSON output rather than an interpolated string.
      capture(new Error('boom'));

      expect(errorLog.mock.calls[0][2]).toEqual({
        statusCode: 500,
        path: PATH,
      });
    });

    it('should not pass the request id itself', () => {
      // AppLogger contributes it from the ambient context, so passing it here
      // would duplicate the field and let the two sources disagree.
      capture(new Error('boom'));

      expect(errorLog.mock.calls[0][2]).not.toHaveProperty('requestId');
      expect(String(errorLog.mock.calls[0][0])).not.toContain(REQUEST_ID);
    });

    it('should log a thrown non-Error without crashing', () => {
      capture('a bare string');

      expect(errorLog).toHaveBeenCalledOnce();
      expect(errorLog.mock.calls[0][0]).toBe('a bare string');
      expect(errorLog.mock.calls[0][1]).toBeUndefined();
    });

    it('should log a server-side 5xx HttpException', () => {
      capture(new ServiceUnavailableException('Database is not reachable'));

      expect(errorLog).toHaveBeenCalledOnce();
    });

    it('should not log 4xx as an error', () => {
      capture(new NotFoundException('Incident not found'));

      expect(errorLog).not.toHaveBeenCalled();
      expect(debugLog).toHaveBeenCalledOnce();
    });

    it('should log 4xx detail with structured params', () => {
      capture(new NotFoundException('Incident not found'));

      expect(debugLog.mock.calls[0][0]).toBe('Incident not found');
      expect(debugLog.mock.calls[0][1]).toEqual({
        statusCode: 404,
        path: PATH,
      });
    });
  });

  describe('when the response has already started', () => {
    it('should end the response instead of replying', () => {
      isHeadersSent.mockReturnValue(true);

      const host = {
        switchToHttp: () => ({
          getRequest: () => ({
            headers: { [REQUEST_ID_HEADER]: REQUEST_ID },
            originalUrl: PATH,
          }),
          getResponse: () => ({}),
        }),
      } as unknown as ArgumentsHost;

      filter.catch(new Error('too late'), host);

      expect(end).toHaveBeenCalledOnce();
      expect(reply).not.toHaveBeenCalled();
    });
  });
});
