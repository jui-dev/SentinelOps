import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { AppModule } from './../src/app.module.js';
import { PrismaService } from './../src/database/prisma.service.js';
import { AppLogger } from './../src/logger/app.logger.js';
import { REDACTED } from './../src/logger/redact.js';

/**
 * Proves the wiring rather than the units: that the id a client is handed in
 * the X-Request-Id header and the error body is the same id that appears in the
 * log lines the server wrote for that request. No unit test can establish that
 * — it is the whole point of the stage.
 */
describe('Logging (e2e)', () => {
  let app: INestApplication;
  let lines: Record<string, unknown>[];

  const queryRaw = vi.fn();
  let stdout: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;

  /** Every JSON line the server emitted, in order. */
  const capture = (write: unknown) => {
    if (typeof write !== 'string') {
      return;
    }

    try {
      lines.push(JSON.parse(write) as Record<string, unknown>);
    } catch {
      // Not a log line — supertest and Nest write plain text too.
    }
  };

  /** The lifecycle record written by HttpLoggerMiddleware. */
  const httpLine = () => lines.find((line) => line.context === 'HTTP');

  /** The diagnostic record written by AllExceptionsFilter. */
  const filterLine = () =>
    lines.find((line) => line.context === 'AllExceptionsFilter');

  beforeEach(async () => {
    // JSON regardless of NODE_ENV, so these assertions read parsed fields
    // rather than scraping the pretty format. debug keeps the filter's 4xx
    // record, which the test environment's default of `warn` would suppress.
    vi.stubEnv('LOG_FORMAT', 'json');
    vi.stubEnv('LOG_LEVEL', 'debug');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ $queryRaw: queryRaw })
      .compile();

    app = moduleFixture.createNestApplication({ bufferLogs: true });
    // Mirrors the global prefix applied in main.ts.
    app.setGlobalPrefix('/api/v1');
    // Mirrors main.ts: this is the seam under test.
    app.useLogger(app.get(AppLogger));

    // Installed before init(), which is where the buffered bootstrap logs are
    // flushed — so those are captured rather than printed over the suite's
    // output. They are ignored by the helpers above, which select by context.
    lines = [];
    stdout = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation((write) => (capture(write), true));
    stderr = vi
      .spyOn(process.stderr, 'write')
      .mockImplementation((write) => (capture(write), true));

    await app.init();
  });

  afterEach(async () => {
    stdout.mockRestore();
    stderr.mockRestore();
    vi.unstubAllEnvs();
    vi.resetAllMocks();
    await app.close();
  });

  describe('the access record', () => {
    it('should log a successful request as one parseable line', async () => {
      queryRaw.mockResolvedValue([{ '?column?': 1 }]);

      await request(app.getHttpServer()).get('/api/v1/health').expect(200);

      expect(httpLine()).toMatchObject({
        level: 'log',
        method: 'GET',
        path: '/api/v1/health',
        statusCode: 200,
      });
      expect(typeof httpLine()?.durationMs).toBe('number');
    });

    it('should correlate the log line with the response header', async () => {
      // The assertion this whole stage exists for.
      const response = await request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(200);

      expect(response.headers['x-request-id']).toBeDefined();
      expect(httpLine()?.requestId).toBe(response.headers['x-request-id']);
    });

    it('should reuse a caller-supplied id in the log line', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/health')
        .set('x-request-id', 'client-trace-42')
        .expect(200);

      expect(response.headers['x-request-id']).toBe('client-trace-42');
      expect(httpLine()?.requestId).toBe('client-trace-42');
    });

    it('should log an unmatched route and correlate it with the error body', async () => {
      // 404s are exactly where an access log earns its keep, and are invisible
      // to an interceptor — which is why this is a middleware.
      const response = await request(app.getHttpServer())
        .get('/api/v1/nope')
        .expect(404);

      expect(httpLine()).toMatchObject({ level: 'warn', statusCode: 404 });
      expect(httpLine()?.requestId).toBe(response.body.requestId);
      expect(httpLine()?.requestId).toBe(response.headers['x-request-id']);
    });

    it('should log a 5xx at error level', async () => {
      queryRaw.mockRejectedValue(new Error('connect ECONNREFUSED'));

      await request(app.getHttpServer())
        .get('/api/v1/health/ready')
        .expect(503);

      expect(httpLine()).toMatchObject({ level: 'error', statusCode: 503 });
    });
  });

  describe('the diagnostic record', () => {
    it('should accompany the access record for a failed request', async () => {
      // Two lines for one failure, on purpose: the filter explains why the
      // request failed, the middleware records that it happened and how long it
      // took. Neither is derivable from the other.
      queryRaw.mockRejectedValue(new Error('connect ECONNREFUSED'));

      const response = await request(app.getHttpServer())
        .get('/api/v1/health/ready')
        .expect(503);

      expect(filterLine()).toBeDefined();
      expect(httpLine()).toBeDefined();
      expect(filterLine()?.requestId).toBe(response.body.requestId);
      expect(httpLine()?.requestId).toBe(response.body.requestId);
    });

    it('should carry the stack and the structured status', async () => {
      queryRaw.mockRejectedValue(new Error('connect ECONNREFUSED'));

      await request(app.getHttpServer())
        .get('/api/v1/health/ready')
        .expect(503);

      expect(filterLine()).toMatchObject({ level: 'error', statusCode: 503 });
      expect(typeof filterLine()?.stack).toBe('string');
    });

    it('should log a 4xx at debug rather than error', async () => {
      await request(app.getHttpServer()).get('/api/v1/nope').expect(404);

      expect(filterLine()).toMatchObject({ level: 'debug', statusCode: 404 });
    });
  });

  describe('sensitive data', () => {
    it('should not log a secret passed in the query string', async () => {
      queryRaw.mockResolvedValue([{ '?column?': 1 }]);

      await request(app.getHttpServer())
        .get('/api/v1/health?token=hunter2&page=2')
        .expect(200);

      expect(JSON.stringify(lines)).not.toContain('hunter2');
      expect(httpLine()?.path).toBe(`/api/v1/health?token=${REDACTED}&page=2`);
    });

    it('should not log request headers', async () => {
      queryRaw.mockResolvedValue([{ '?column?': 1 }]);

      await request(app.getHttpServer())
        .get('/api/v1/health')
        .set('authorization', 'Bearer hunter2')
        .set('cookie', 'session=hunter2')
        .expect(200);

      expect(JSON.stringify(lines)).not.toContain('hunter2');
    });
  });
});
