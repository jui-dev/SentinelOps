import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from './../src/app.module.js';
import { TokenService } from './../src/auth/token.service.js';
import { PrismaService } from './../src/database/prisma.service.js';
import { AppLogger } from './../src/logger/app.logger.js';
import { resolveTestDatabaseUrl } from './test-database.js';

// Invitations are off unless switched on, and this suite exercises them.
// Hoisted, so the flag is set before any configuration is read.
vi.hoisted(() => {
  process.env.INVITATIONS_ENABLED = 'true';
});

/**
 * What the server writes while invitations are used, against a real database
 * and with the production logger in JSON at `debug`: every invitation route,
 * successful and failing, and not one line carrying a token or an invitee's
 * address.
 *
 * Its own file, with its own application, so the capture is scoped to it.
 */
describe('invitation logging (integration)', () => {
  const prisma = new PrismaService({ url: resolveTestDatabaseUrl() });
  let app: INestApplication;
  let raw: string[];
  let stdout: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;

  const NEW_EMAIL = 'grace@new.example';
  const EXISTING_EMAIL = 'erin@bravo.example';

  beforeAll(async () => {
    vi.stubEnv('LOG_FORMAT', 'json');
    vi.stubEnv('LOG_LEVEL', 'debug');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleRef.createNestApplication({ bufferLogs: true });
    app.setGlobalPrefix('/api/v1');
    app.useLogger(app.get(AppLogger));

    raw = [];
    const capture = (write: unknown) => {
      if (typeof write === 'string') raw.push(write);

      return true;
    };
    stdout = vi.spyOn(process.stdout, 'write').mockImplementation(capture);
    stderr = vi.spyOn(process.stderr, 'write').mockImplementation(capture);

    await app.init();

    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE incidents, services, team_memberships, teams, invitations, refresh_tokens, memberships, users, organizations RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    stdout.mockRestore();
    stderr.mockRestore();
    vi.unstubAllEnvs();
    await app.close();
  });

  it('should log every invitation route without a token or an invitee email', async () => {
    const organization = await prisma.organization.create({
      data: { name: 'Acme Operations', slug: 'acme-operations' },
    });
    const alice = await prisma.user.create({
      data: { email: 'alice@acme.example', name: 'Alice Anders' },
    });
    const erin = await prisma.user.create({
      data: { email: EXISTING_EMAIL, name: 'Erin Ekström' },
    });
    await prisma.membership.create({
      data: {
        organizationId: organization.id,
        userId: alice.id,
        role: 'ADMIN',
      },
    });

    const tokens = app.get(TokenService);
    const server = () => request(app.getHttpServer());
    const as = async (userId: string) =>
      `Bearer ${await tokens.signAccessToken(userId)}`;
    const path = `/api/v1/organizations/${organization.id}/invitations`;

    const forNew = await server()
      .post(path)
      .set('Authorization', await as(alice.id))
      .send({ email: NEW_EMAIL, role: 'MEMBER' });
    const forExisting = await server()
      .post(path)
      .set('Authorization', await as(alice.id))
      .send({ email: EXISTING_EMAIL, role: 'ADMIN' });
    const secrets: string[] = [forNew.body.token, forExisting.body.token];

    expect(secrets.every((token) => typeof token === 'string')).toBe(true);

    // A mix of successes and failures on every route.
    await server()
      .post(path)
      .set('Authorization', await as(alice.id))
      .send({ email: EXISTING_EMAIL, role: 'OWNER' });
    await server()
      .get(path)
      .set('Authorization', await as(alice.id));
    await server()
      .post('/api/v1/invitations/lookup')
      .send({ token: secrets[0] });
    await server()
      .post('/api/v1/invitations/lookup')
      .send({ token: 'z'.repeat(43) });
    await server()
      .post('/api/v1/invitations/accept')
      .set('Authorization', await as(alice.id))
      .send({ token: secrets[1] });
    const accepted = await server()
      .post('/api/v1/invitations/accept')
      .set('Authorization', await as(erin.id))
      .send({ token: secrets[1] });
    await server()
      .post('/api/v1/invitations/accept')
      .set('Authorization', await as(erin.id))
      .send({ token: secrets[1] });
    const registered = await server()
      .post('/api/v1/auth/register/invitation')
      .send({
        token: secrets[0],
        name: 'Grace Hopper',
        password: 'a sufficiently long passphrase',
      });
    await server().post('/api/v1/auth/register/invitation').send({
      token: secrets[0],
      name: 'Grace Again',
      password: 'a sufficiently long passphrase',
    });

    expect(accepted.status).toBe(200);
    expect(registered.status).toBe(201);

    const output = raw.join('');
    const lines = raw.flatMap((write) => {
      try {
        return [JSON.parse(write) as Record<string, unknown>];
      } catch {
        return [];
      }
    });

    // The capture saw the traffic, so its silence below means something.
    const httpPaths = lines
      .filter((line) => line.context === 'HTTP')
      .map((line) => `${line.statusCode} ${line.path}`);

    expect(httpPaths).toEqual(
      expect.arrayContaining([
        `201 ${path}`,
        `400 ${path}`,
        `200 ${path}`,
        '200 /api/v1/invitations/lookup',
        '404 /api/v1/invitations/lookup',
        '403 /api/v1/invitations/accept',
        '200 /api/v1/invitations/accept',
        '404 /api/v1/invitations/accept',
        '201 /api/v1/auth/register/invitation',
        '404 /api/v1/auth/register/invitation',
      ]),
    );
    expect(
      lines.filter((line) => line.message === 'Invitation created'),
    ).toHaveLength(2);
    expect(
      lines.filter((line) => line.message === 'Invitation accepted'),
    ).toHaveLength(2);

    for (const secret of secrets) {
      expect(output).not.toContain(secret);
    }
    expect(output).not.toContain(NEW_EMAIL);
    expect(output).not.toContain(EXISTING_EMAIL);
  });
});
