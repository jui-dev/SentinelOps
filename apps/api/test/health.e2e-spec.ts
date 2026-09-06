import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from './../src/database/prisma.service.js';

describe('HealthController (e2e)', () => {
  let app: INestApplication;
  const queryRaw = vi.fn();

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      // Stubbed so readiness behaviour is exercised without requiring a running
      // PostgreSQL instance.
      .overrideProvider(PrismaService)
      .useValue({ $queryRaw: queryRaw })
      .compile();

    app = moduleFixture.createNestApplication();
    // Mirrors the global prefix applied in main.ts.
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  it('/api/v1/health/ready (GET) reports the database as up', () => {
    queryRaw.mockResolvedValue([{ '?column?': 1 }]);

    return request(app.getHttpServer())
      .get('/api/v1/health/ready')
      .expect(200)
      .expect({ status: 'ok', database: 'up' });
  });

  it('/api/v1/health/ready (GET) returns 503 when the database is unreachable', () => {
    queryRaw.mockRejectedValue(new Error('connection refused'));

    return request(app.getHttpServer())
      .get('/api/v1/health/ready')
      .expect(503)
      .expect({ status: 'error', database: 'down' });
  });

  afterEach(async () => {
    await app.close();
    vi.resetAllMocks();
  });
});
