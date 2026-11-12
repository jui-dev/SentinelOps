import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from './../src/app.module.js';
import { SECURITY_HEADERS } from './../src/common/security-headers.middleware.js';
import { PrismaService } from './../src/database/prisma.service.js';

/**
 * Every response carries the security headers — a success, an error the API
 * answers, and a path that does not exist — and none says which server
 * software answered.
 */
describe('Security headers (e2e)', () => {
  let app: INestApplication;

  const prisma = {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    user: { findFirst: vi.fn() },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('/api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const expectHeaders = (response: request.Response) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(response.headers[name.toLowerCase()]).toBe(value);
    }
    expect(response.headers['x-powered-by']).toBeUndefined();
  };

  it('should send them with a success', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/health');

    expect(response.status).toBe(200);
    expectHeaders(response);
  });

  it('should send them with an error', async () => {
    const response = await request(app.getHttpServer()).get('/api/v1/auth/me');

    expect(response.status).toBe(401);
    expectHeaders(response);
  });

  it('should send them for a path that does not exist', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/v1/does-not-exist',
    );

    expect(response.status).toBe(404);
    expectHeaders(response);
  });

  it('should send exactly the strict set an API answering only JSON needs', () => {
    expect(SECURITY_HEADERS).toEqual({
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-store',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
      'Cross-Origin-Opener-Policy': 'same-origin',
    });
  });
});
