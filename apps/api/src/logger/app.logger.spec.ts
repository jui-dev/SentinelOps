import type { ConfigType } from '@nestjs/config';

import { runWithRequestContext } from '../common/request-context.js';
import type { loggingConfig } from '../config/configuration.js';
import { AppLogger, levelsFrom } from './app.logger.js';
import { REDACTED } from './redact.js';

type LoggingConfig = ConfigType<typeof loggingConfig>;

describe('AppLogger', () => {
  const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

  /**
   * Builds a logger directly from a config object, matching how the other
   * common/ units are tested — no DI container involved.
   */
  const loggerFor = (config: Partial<LoggingConfig> = {}) =>
    new AppLogger({
      level: 'verbose',
      format: 'json',
      ...config,
    } as LoggingConfig);

  /** The last line written, parsed. Asserting on parsed JSON rather than on a
   * substring proves the output is genuinely machine-readable. */
  const lastJson = (stream = stdout): Record<string, unknown> => {
    const written = stream.mock.calls.at(-1)?.[0] as string;

    return JSON.parse(written) as Record<string, unknown>;
  };

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('levelsFrom', () => {
    it('should enable the named level and everything above it', () => {
      expect(levelsFrom('warn')).toEqual(['warn', 'error', 'fatal']);
    });

    it('should enable everything at the lowest level', () => {
      expect(levelsFrom('verbose')).toEqual([
        'verbose',
        'debug',
        'log',
        'warn',
        'error',
        'fatal',
      ]);
    });
  });

  describe('json format', () => {
    it('should emit one parseable line per entry', () => {
      loggerFor().log('Connected to PostgreSQL', 'PrismaService');

      expect(stdout).toHaveBeenCalledOnce();
      expect(stdout.mock.calls[0][0] as string).toMatch(/^\{.*\}\n$/s);
      expect(lastJson()).toMatchObject({
        level: 'log',
        message: 'Connected to PostgreSQL',
        context: 'PrismaService',
      });
    });

    it('should flatten structured params to the root', () => {
      loggerFor().log('Incident escalated', { incidentId: 'inc_1', tier: 2 });

      expect(lastJson()).toMatchObject({ incidentId: 'inc_1', tier: 2 });
    });

    it('should not let a param displace a framework field', () => {
      loggerFor().log('the real message', { message: 'impostor', level: 'fatal' });

      expect(lastJson()).toMatchObject({
        message: 'the real message',
        level: 'log',
      });
    });

    it('should omit params entirely when there are none', () => {
      loggerFor().log('a bare message');

      expect(lastJson()).not.toHaveProperty('params');
    });

    it('should write errors to stderr and keep the stack', () => {
      const error = new Error('boom');

      loggerFor().error(error.message, error.stack, { statusCode: 500 });

      expect(stderr).toHaveBeenCalledOnce();
      expect(lastJson(stderr)).toMatchObject({
        level: 'error',
        message: 'boom',
        statusCode: 500,
      });
      expect(lastJson(stderr).stack).toBe(error.stack);
    });
  });

  describe('request correlation', () => {
    it('should attach the ambient requestId', () => {
      runWithRequestContext({ requestId: 'req-1' }, () => {
        loggerFor().log('inside a request');
      });

      expect(lastJson()).toMatchObject({ requestId: 'req-1' });
    });

    it('should omit requestId outside a request', () => {
      // Bootstrap and shutdown log from here. The field is absent rather than
      // set to a fabricated id that would correlate with nothing.
      loggerFor().log('outside a request');

      expect(lastJson()).not.toHaveProperty('requestId');
    });

    it('should correlate a line written from an event handler', () => {
      const logger = loggerFor();

      runWithRequestContext({ requestId: 'req-1' }, () => {
        setTimeout(() => logger.log('deferred'), 0);
      });

      return new Promise<void>((resolve) => {
        setTimeout(() => {
          expect(lastJson()).toMatchObject({ requestId: 'req-1' });
          resolve();
        }, 5);
      });
    });

    it('should let an explicit requestId win over the ambient one', () => {
      runWithRequestContext({ requestId: 'ambient' }, () => {
        loggerFor().log('explicit', { requestId: 'explicit' });
      });

      expect(lastJson()).toMatchObject({ requestId: 'explicit' });
    });
  });

  describe('redaction', () => {
    it('should mask sensitive params', () => {
      loggerFor().log('login', { email: 'ada@example.com', password: 'hunter2' });

      const written = stdout.mock.calls[0][0] as string;

      expect(written).not.toContain('hunter2');
      expect(lastJson()).toMatchObject({
        email: 'ada@example.com',
        password: REDACTED,
      });
    });

    it('should mask sensitive keys inside a message object', () => {
      loggerFor().log({ accessToken: 'hunter2', ok: true });

      expect(stdout.mock.calls[0][0] as string).not.toContain('hunter2');
    });

    it('should redact in pretty format too', () => {
      loggerFor({ format: 'pretty' }).log('login', { password: 'hunter2' });

      expect(stdout.mock.calls[0][0] as string).not.toContain('hunter2');
    });

    it('should not corrupt a stack trace', () => {
      const error = new Error('boom');

      loggerFor().error(error.message, error.stack);

      expect(lastJson(stderr).stack).toBe(error.stack);
    });
  });

  describe('level filtering', () => {
    it('should suppress levels below the configured minimum', () => {
      const logger = loggerFor({ level: 'warn' });

      logger.log('suppressed');
      logger.debug('suppressed');
      logger.verbose('suppressed');

      expect(stdout).not.toHaveBeenCalled();
    });

    it('should emit the configured level and above', () => {
      const logger = loggerFor({ level: 'warn' });

      logger.warn('kept');
      logger.error('kept');

      expect(stdout).toHaveBeenCalledOnce();
      expect(stderr).toHaveBeenCalledOnce();
    });
  });

  describe('pretty format', () => {
    it('should emit human-readable text rather than json', () => {
      loggerFor({ format: 'pretty' }).log('Connected', 'PrismaService');

      const written = stdout.mock.calls[0][0] as string;

      expect(() => JSON.parse(written)).toThrow();
      expect(written).toContain('Connected');
      expect(written).toContain('PrismaService');
    });

    it('should still carry the requestId', () => {
      runWithRequestContext({ requestId: 'req-1' }, () => {
        loggerFor({ format: 'pretty' }).log('inside');
      });

      expect(stdout.mock.calls[0][0] as string).toContain('req-1');
    });
  });
});
