import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from './../src/app.module.js';
import { PrismaService } from './../src/database/prisma.service.js';

// The default, stated explicitly so a developer's .env cannot change what
// this suite proves. Hoisted, so it is set before configuration is read.
vi.hoisted(() => {
  process.env.REGISTRATION_ENABLED = 'false';
});

/**
 * With registration switched off — the default — nobody can create an
 * organization from the website: `POST /auth/register` answers exactly as a
 * path that was never declared does, and nothing behind it runs. Signing in
 * is untouched.
 */
const comparable = (body: Record<string, unknown>) => {
  const {
    requestId: _requestId,
    timestamp: _timestamp,
    path: _path,
    message: _message,
    ...rest
  } = body;

  return rest;
};

describe('Registration, switched off (e2e)', () => {
  let app: INestApplication;

  const prisma = {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    user: { findFirst: vi.fn(), create: vi.fn() },
    organization: { create: vi.fn() },
    membership: { create: vi.fn(), findFirst: vi.fn() },
  };

  const registration = {
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    password: 'correct-horse-battery',
    organizationName: 'Acme Operations',
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

  it('should answer a registration as an unknown path does, creating nothing', async () => {
    const unknown = await request(app.getHttpServer())
      .post('/api/v1/does-not-exist')
      .send(registration);
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send(registration);

    expect(response.status).toBe(404);
    expect(comparable(response.body)).toEqual(comparable(unknown.body));
    expect(response.body.message).toBe('Cannot POST /api/v1/auth/register');
    expect(response.body).not.toHaveProperty('code');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.organization.create).not.toHaveBeenCalled();
  });

  it('should answer even a malformed registration with the same 404, reading no body', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ nonsense: true });

    expect(response.status).toBe(404);
    expect(response.body).not.toHaveProperty('code');
  });

  it('should leave signing in in place', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    const response = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'ada@example.com', password: 'wrong-password-123' });

    expect(response.status).toBe(401);
    expect(response.body.code).toBe('INVALID_CREDENTIALS');
  });
});
