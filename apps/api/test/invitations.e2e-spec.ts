import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from './../src/app.module.js';
import { PasswordService } from './../src/auth/password.service.js';
import { TokenService } from './../src/auth/token.service.js';
import { PrismaService } from './../src/database/prisma.service.js';
import type { Role } from './../src/generated/prisma/enums.js';

/**
 * Invitation routes wired through the real AppModule, with Prisma mocked.
 *
 * Proves where each check sits — authentication, admission, authorization,
 * validation — and that the token routes are reachable exactly as intended:
 * lookup and signup without a session, acceptance only with one. What the
 * routes do to real rows is proven in invitations.integration-spec.ts.
 */
const USER_ID = '0199a1b2-c3d4-7000-8000-000000000001';
const ORG_ID = '0199a1b2-c3d4-7000-8000-00000000000a';
const MEMBERSHIP_ID = '0199a1b2-c3d4-7000-8000-0000000000aa';
const INVITATION_ID = '0199a1b2-c3d4-7000-8000-0000000000c1';
const TOKEN = 'a'.repeat(43);

const ADMIN_ROUTES = [
  ['POST', `/api/v1/organizations/${ORG_ID}/invitations`],
  ['GET', `/api/v1/organizations/${ORG_ID}/invitations`],
  ['DELETE', `/api/v1/organizations/${ORG_ID}/invitations/${INVITATION_ID}`],
] as const;

describe('Invitations (e2e)', () => {
  let app: INestApplication;
  let tokens: TokenService;

  const prisma = {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    membership: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    organization: { findFirst: vi.fn() },
    user: { findFirst: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
    invitation: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    refreshToken: { create: vi.fn() },
  };

  const passwords = { hash: vi.fn(), verify: vi.fn(), verifyDummy: vi.fn() };

  /** Admission resolves the caller as `role` in ORG_ID, or not at all. */
  const admitAs = (role: Role | null) =>
    prisma.membership.findFirst.mockImplementation(
      (args: { where: Record<string, unknown> }) =>
        role && args.where.userId === USER_ID
          ? {
              id: MEMBERSHIP_ID,
              organizationId: ORG_ID,
              role,
              user: { passwordChangeRequired: false },
            }
          : null,
    );

  const bearer = async () => `Bearer ${await tokens.signAccessToken(USER_ID)}`;

  const send = (
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: object,
    authorization?: string,
  ) => {
    const server = request(app.getHttpServer());
    const pending =
      method === 'GET'
        ? server.get(path)
        : method === 'POST'
          ? server.post(path)
          : server.delete(path);

    if (authorization) pending.set('Authorization', authorization);

    return body === undefined ? pending : pending.send(body);
  };

  const invitationQueries = () =>
    Object.values(prisma.invitation).reduce(
      (total, mock) => total + mock.mock.calls.length,
      0,
    );

  beforeEach(async () => {
    prisma.$transaction.mockImplementation((work: (tx: unknown) => unknown) =>
      work(prisma),
    );
    admitAs(null);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .overrideProvider(PasswordService)
      .useValue(passwords)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('/api/v1');
    await app.init();

    tokens = app.get(TokenService);
  });

  afterEach(async () => {
    vi.resetAllMocks();
    await app.close();
  });

  describe('organization-scoped routes', () => {
    it.each(ADMIN_ROUTES)(
      'should answer %s %s with 401 before anything else',
      async (method, path) => {
        const response = await send(method, path, {});

        expect(response.status).toBe(401);
        expect(prisma.membership.findFirst).not.toHaveBeenCalled();
      },
    );

    it.each(ADMIN_ROUTES)(
      'should answer %s %s with the admission 404 for a non-member',
      async (method, path) => {
        const response = await send(method, path, {}, await bearer());

        expect(response.status).toBe(404);
        expect(response.body.code).toBe('ORGANIZATION_NOT_FOUND');
        expect(invitationQueries()).toBe(0);
      },
    );

    it.each(ADMIN_ROUTES)(
      'should refuse a MEMBER on %s %s with 403, before the body is validated',
      async (method, path) => {
        admitAs('MEMBER');

        // An invalid body, so a 400 would mean validation ran first.
        const response = await send(
          method,
          path,
          { role: 'OWNER' },
          await bearer(),
        );

        expect(response.status).toBe(403);
        expect(response.body.code).toBe('PERMISSION_DENIED');
        expect(invitationQueries()).toBe(0);
      },
    );

    it.each(['ADMIN'] as const)(
      'should validate the body once an %s is authorized',
      async (role) => {
        admitAs(role);

        for (const body of [
          { email: 'grace@example.com', role: 'OWNER' },
          {
            email: 'grace@example.com',
            role: 'MEMBER',
            organizationId: ORG_ID,
          },
          { email: 'not-an-email', role: 'MEMBER' },
          {},
        ]) {
          const response = await send(
            'POST',
            `/api/v1/organizations/${ORG_ID}/invitations`,
            body,
            await bearer(),
          );

          expect(response.status).toBe(400);
        }

        expect(prisma.invitation.create).not.toHaveBeenCalled();
      },
    );

    it('should answer a malformed invitation id with 404, without querying invitations', async () => {
      admitAs('ADMIN');

      const response = await send(
        'DELETE',
        `/api/v1/organizations/${ORG_ID}/invitations/not-a-uuid`,
        undefined,
        await bearer(),
      );

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('INVITATION_NOT_FOUND');
      expect(response.body.message).not.toContain('not-a-uuid');
      expect(invitationQueries()).toBe(0);
    });

    it('should answer a successful revoke with 204 and no body', async () => {
      admitAs('ADMIN');
      prisma.invitation.updateMany.mockResolvedValue({ count: 1 });

      const response = await send(
        'DELETE',
        `/api/v1/organizations/${ORG_ID}/invitations/${INVITATION_ID}`,
        undefined,
        await bearer(),
      );

      expect(response.status).toBe(204);
      expect(response.text).toBe('');
    });
  });

  describe('POST /invitations/lookup', () => {
    it('should be reachable without a session', async () => {
      prisma.invitation.findUnique.mockResolvedValue(null);

      const response = await send('POST', '/api/v1/invitations/lookup', {
        token: TOKEN,
      });

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('INVITATION_NOT_FOUND');
      expect(JSON.stringify(response.body)).not.toContain(TOKEN);
    });

    it('should read the token from the body only', async () => {
      const response = await send(
        'POST',
        `/api/v1/invitations/lookup?token=${TOKEN}`,
        {},
      );

      expect(response.status).toBe(400);
      expect(prisma.invitation.findUnique).not.toHaveBeenCalled();
    });

    it('should not serve the token as a path segment', async () => {
      const response = await send('POST', `/api/v1/invitations/${TOKEN}`, {});

      expect(response.status).toBe(404);
      expect(response.body.code).toBeUndefined();
      expect(prisma.invitation.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('POST /invitations/accept', () => {
    it('should require a session', async () => {
      const response = await send('POST', '/api/v1/invitations/accept', {
        token: TOKEN,
      });

      expect(response.status).toBe(401);
      expect(prisma.invitation.findUnique).not.toHaveBeenCalled();
    });

    it('should validate the body for a signed-in caller', async () => {
      const response = await send(
        'POST',
        '/api/v1/invitations/accept',
        { token: '' },
        await bearer(),
      );

      expect(response.status).toBe(400);
    });

    it('should answer an unusable token with 404 for a signed-in caller', async () => {
      prisma.invitation.findUnique.mockResolvedValue(null);

      const response = await send(
        'POST',
        '/api/v1/invitations/accept',
        { token: TOKEN },
        await bearer(),
      );

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('INVITATION_NOT_FOUND');
    });
  });

  describe('POST /auth/register/invitation', () => {
    const body = {
      token: TOKEN,
      name: 'Grace Hopper',
      password: 'a sufficiently long passphrase',
    };

    it('should refuse an email field — the address comes from the invitation', async () => {
      const response = await send('POST', '/api/v1/auth/register/invitation', {
        ...body,
        email: 'attacker@example.com',
      });

      expect(response.status).toBe(400);
      expect(prisma.invitation.findUnique).not.toHaveBeenCalled();
    });

    it('should answer an unusable token with 404, before hashing a password or setting a cookie', async () => {
      prisma.invitation.findUnique.mockResolvedValue(null);

      const response = await send(
        'POST',
        '/api/v1/auth/register/invitation',
        body,
      );

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('INVITATION_NOT_FOUND');
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(passwords.hash).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });
});
