import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from './../src/app.module.js';
import { TokenService } from './../src/auth/token.service.js';
import { PrismaService } from './../src/database/prisma.service.js';

// The default, stated explicitly so a developer's .env cannot change what
// this suite proves. Hoisted, so it is set before configuration is read.
vi.hoisted(() => {
  process.env.INVITATIONS_ENABLED = 'false';
});

/**
 * With invitations switched off, every invitation route answers exactly as a
 * path that was never declared does — whoever asks, however they ask — and
 * nothing behind it runs.
 */
const USER_ID = '0199a1b2-c3d4-7000-8000-000000000001';
const ORG_ID = '0199a1b2-c3d4-7000-8000-00000000000a';
const INVITATION_ID = '0199a1b2-c3d4-7000-8000-0000000000c1';

const ROUTES = [
  ['POST', `/api/v1/organizations/${ORG_ID}/invitations`],
  ['GET', `/api/v1/organizations/${ORG_ID}/invitations`],
  ['DELETE', `/api/v1/organizations/${ORG_ID}/invitations/${INVITATION_ID}`],
  ['POST', '/api/v1/invitations/lookup'],
  ['POST', '/api/v1/invitations/accept'],
  ['POST', '/api/v1/auth/register/invitation'],
] as const;

/** The error body with the per-request fields removed, for comparison. */
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

describe('Invitations, switched off (e2e)', () => {
  let app: INestApplication;
  let tokens: TokenService;

  const prisma = {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    membership: { findFirst: vi.fn() },
    invitation: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn() },
    user: { findFirst: vi.fn(), create: vi.fn() },
  };

  const send = (method: string, path: string, authorization?: string) => {
    const server = request(app.getHttpServer());
    const pending =
      method === 'GET'
        ? server.get(path)
        : method === 'POST'
          ? server.post(path)
          : server.delete(path);

    if (authorization) pending.set('Authorization', authorization);

    return pending.send({ token: 'a'.repeat(43), email: 'x@example.com' });
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('/api/v1');
    await app.init();

    tokens = app.get(TokenService);
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(ROUTES)(
    'should answer an anonymous %s %s as an unknown path does',
    async (method, path) => {
      const unknown = await send(method, '/api/v1/does-not-exist');
      const response = await send(method, path);

      expect(response.status).toBe(404);
      expect(comparable(response.body)).toEqual(comparable(unknown.body));
      expect(response.body.message).toBe(`Cannot ${method} ${path}`);
      expect(response.body).not.toHaveProperty('code');
    },
  );

  it.each(ROUTES)(
    'should answer an authenticated %s %s with the same 404, touching nothing',
    async (method, path) => {
      const bearer = `Bearer ${await tokens.signAccessToken(USER_ID)}`;

      const response = await send(method, path, bearer);

      expect(response.status).toBe(404);
      expect(response.body).not.toHaveProperty('code');
      for (const model of [prisma.membership, prisma.invitation, prisma.user]) {
        for (const mock of Object.values(model)) {
          expect(mock).not.toHaveBeenCalled();
        }
      }
    },
  );

  it('should leave the query string out of the message', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/invitations/lookup?token=secret')
      .send({});

    expect(response.status).toBe(404);
    expect(response.body.message).toBe(
      'Cannot POST /api/v1/invitations/lookup',
    );
  });
});
