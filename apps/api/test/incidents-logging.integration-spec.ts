import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from './../src/app.module.js';
import { TokenService } from './../src/auth/token.service.js';
import { PrismaService } from './../src/database/prisma.service.js';
import { AppLogger } from './../src/logger/app.logger.js';
import { resolveTestDatabaseUrl } from './test-database.js';

/**
 * What the server writes while incidents are declared and worked, against a
 * real database and with the production logger in JSON at `debug`: the
 * incident's identifiers and enum values, and never its title, summary, or
 * update messages — free text that can carry customer or system details.
 *
 * Its own file, with its own application, so the capture is scoped to it.
 */
describe('incident logging (integration)', () => {
  const prisma = new PrismaService({ url: resolveTestDatabaseUrl() });
  let app: INestApplication;
  let raw: string[];
  let stdout: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;

  const TITLE = 'Sentinel-title-3f9a: card 4111 declined for customer Ada';
  const SUMMARY = 'Sentinel-summary-7c2e: host db-payments-02 unreachable';
  const NEW_TITLE = 'Sentinel-retitle-51bd';
  const MESSAGE = 'Sentinel-update-9d41: pool on db-payments-02 exhausted';

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

  it('should log declaring, changing, posting updates, and resolving without the free text', async () => {
    const organization = await prisma.organization.create({
      data: { name: 'Acme Operations', slug: 'acme-operations' },
    });
    const dave = await prisma.user.create({
      data: { email: 'dave@acme.example', name: 'Dave Duarte' },
    });
    await prisma.membership.create({
      data: {
        organizationId: organization.id,
        userId: dave.id,
        role: 'ADMIN',
      },
    });
    const team = await prisma.team.create({
      data: {
        organizationId: organization.id,
        name: 'Payments',
        slug: 'payments',
      },
    });
    // Dave is the admin, and also on Payments, so he can respond as well.
    const membership = await prisma.membership.findFirstOrThrow({
      where: { organizationId: organization.id, userId: dave.id },
    });
    await prisma.teamMembership.create({
      data: {
        organizationId: organization.id,
        teamId: team.id,
        membershipId: membership.id,
      },
    });
    const service = await prisma.service.create({
      data: {
        organizationId: organization.id,
        ownerTeamId: team.id,
        name: 'Payment API',
        slug: 'payment-api',
      },
    });

    const tokens = app.get(TokenService);
    const auth = `Bearer ${await tokens.signAccessToken(dave.id)}`;
    const base = `/api/v1/organizations/${organization.id}/incidents`;
    const server = () => request(app.getHttpServer());

    const declared = await server().post(base).set('Authorization', auth).send({
      title: TITLE,
      summary: SUMMARY,
      serviceId: service.id,
      severity: 'SEV1',
    });

    expect(declared.status).toBe(201);

    // A mix of successes and failures on every route.
    await server()
      .patch(`${base}/1`)
      .set('Authorization', auth)
      .send({ title: NEW_TITLE, severity: 'SEV2' });
    await server()
      .post(`${base}/1/updates`)
      .set('Authorization', auth)
      .send({ message: MESSAGE });
    await server().post(`${base}/1/responders/me`).set('Authorization', auth);
    await server()
      .post(`${base}/1/responders/me/complete`)
      .set('Authorization', auth);
    await server()
      .patch(`${base}/1`)
      .set('Authorization', auth)
      .send({ status: 'RESOLVED' });
    await server()
      .patch(`${base}/1`)
      .set('Authorization', auth)
      .send({ summary: SUMMARY });
    await server()
      .post(`${base}/1/updates`)
      .set('Authorization', auth)
      .send({ message: MESSAGE });
    await server().get(`${base}/1/timeline`).set('Authorization', auth);
    await server()
      .post(base)
      .set('Authorization', auth)
      .send({ title: TITLE, summary: SUMMARY, severity: 'SEV9' });
    await server().get(`${base}/1`).set('Authorization', auth);
    await server().get(`${base}?state=resolved`).set('Authorization', auth);

    // Every captured line is searched for secrets; only the logger's JSON
    // lines are parsed (Node writes its own warnings to stderr as text).
    const lines = raw.join('').split('\n').filter(Boolean);
    const entries = lines
      .filter((line) => line.startsWith('{'))
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const messages = entries.map((entry) => entry.message);

    expect(messages).toEqual(
      expect.arrayContaining([
        'Incident declared',
        'Incident updated',
        'Incident update posted',
        'Incident response started',
        'Incident response completed',
        'Incident resolved',
      ]),
    );
    expect(
      entries.find((entry) => entry.message === 'Incident declared'),
    ).toEqual(
      expect.objectContaining({
        incidentNumber: 1,
        serviceId: service.id,
        teamId: team.id,
        severity: 'SEV1',
      }),
    );
    expect(
      entries.find((entry) => entry.message === 'Incident updated'),
    ).toEqual(expect.objectContaining({ changed: ['title', 'severity'] }));

    for (const secret of [TITLE, SUMMARY, NEW_TITLE, MESSAGE, 'Sentinel-']) {
      expect(lines.filter((line) => line.includes(secret))).toEqual([]);
    }
  });
});
