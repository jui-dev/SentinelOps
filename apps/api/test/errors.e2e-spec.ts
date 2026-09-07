import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from './../src/database/prisma.service.js';

/**
 * Exercises the error contract through the real AppModule, so this proves the
 * global wiring is actually in place — not just that the units behave.
 */
describe('Error contract (e2e)', () => {
  let app: INestApplication;
  const queryRaw = vi.fn();

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue({ $queryRaw: queryRaw })
      .compile();

    app = moduleFixture.createNestApplication();
    // Mirrors the global prefix applied in main.ts. The filter, pipe, and
    // middleware need no such mirroring — they are registered inside
    // CommonModule, so importing AppModule brings them along.
    app.setGlobalPrefix('/api/v1');
    await app.init();
  });

  afterEach(async () => {
    await app.close();
    vi.resetAllMocks();
  });

  describe('unmatched routes', () => {
    it('should return the error contract for an unknown path', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/does-not-exist')
        .expect(404);

      expect(response.body).toMatchObject({
        statusCode: 404,
        error: 'Not Found',
        message: expect.stringContaining('/api/v1/does-not-exist'),
        path: '/api/v1/does-not-exist',
      });
      expect(typeof response.body.message).toBe('string');
      expect(response.body.requestId).toEqual(expect.any(String));
      expect(new Date(response.body.timestamp).toISOString()).toBe(
        response.body.timestamp,
      );
    });

    it('should not include a details key when the error is not field-scoped', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/does-not-exist')
        .expect(404);

      expect(response.body).not.toHaveProperty('details');
      expect(response.body).not.toHaveProperty('code');
    });
  });

  describe('request correlation', () => {
    it('should return a request id header matching the body', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/does-not-exist')
        .expect(404);

      expect(response.headers['x-request-id']).toBeDefined();
      expect(response.headers['x-request-id']).toBe(response.body.requestId);
    });

    it('should correlate successful responses too', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/health')
        .expect(200);

      expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('should echo a well-formed inbound request id', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/does-not-exist')
        .set('X-Request-Id', 'client-trace-42')
        .expect(404);

      expect(response.headers['x-request-id']).toBe('client-trace-42');
      expect(response.body.requestId).toBe('client-trace-42');
    });

    it('should replace an unsafe inbound request id', async () => {
      const hostile = 'a'.repeat(200);

      const response = await request(app.getHttpServer())
        .get('/api/v1/does-not-exist')
        .set('X-Request-Id', hostile)
        .expect(404);

      expect(response.body.requestId).not.toBe(hostile);
      expect(response.body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe('health readiness', () => {
    it('should keep the success body unwrapped', async () => {
      queryRaw.mockResolvedValue([{ '?column?': 1 }]);

      const response = await request(app.getHttpServer())
        .get('/api/v1/health/ready')
        .expect(200);

      expect(response.body).toEqual({ status: 'ok', database: 'up' });
    });

    it('should return the error contract when the database is unreachable', async () => {
      queryRaw.mockRejectedValue(new Error('connection refused'));

      const response = await request(app.getHttpServer())
        .get('/api/v1/health/ready')
        .expect(503);

      expect(response.body).toMatchObject({
        statusCode: 503,
        error: 'Service Unavailable',
        message: 'Database is not reachable',
        path: '/api/v1/health/ready',
      });
      expect(response.body.requestId).toEqual(expect.any(String));
    });

    it('should not leak the underlying driver error', async () => {
      queryRaw.mockRejectedValue(
        new Error('connect ECONNREFUSED 127.0.0.1:5432'),
      );

      const response = await request(app.getHttpServer())
        .get('/api/v1/health/ready')
        .expect(503);

      expect(JSON.stringify(response.body)).not.toContain('ECONNREFUSED');
    });
  });
});
