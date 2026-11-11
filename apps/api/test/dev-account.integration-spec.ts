import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from './../src/app.module.js';
import { PrismaService } from './../src/database/prisma.service.js';
import {
  DEV_ORGANIZATION,
  DEV_PASSWORD,
  DEV_PERSONAS,
} from './../src/dev/dev-account.js';
import { DevAccountService } from './../src/dev/dev-account.service.js';
import { resolveTestDatabaseUrl } from './test-database.js';

/**
 * TEMPORARY — the development organization against a real database: set up
 * once, logins restored on every boot, and nothing the application changed
 * put back. Delete with src/dev/.
 */
describe('development organization (integration)', () => {
  const prisma = new PrismaService({ url: resolveTestDatabaseUrl() });
  let app: INestApplication;
  let devAccount: DevAccountService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('/api/v1');
    await app.init();
    devAccount = app.get(DevAccountService);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE incidents, services, team_memberships, teams, invitations, refresh_tokens, memberships, users, organizations RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  const teamsOf = async (email: string) =>
    (
      await prisma.teamMembership.findMany({
        where: { membership: { user: { email } } },
        select: { team: { select: { name: true } } },
        orderBy: { team: { name: 'asc' } },
      })
    ).map(({ team }) => team.name);

  it('should not be created outside development', async () => {
    // Booting the application above ran the hook in the test environment.
    expect(await prisma.user.count()).toBe(0);
  });

  it('should set up the organization, its teams, services, and personas', async () => {
    await devAccount.ensure();

    const organization = await prisma.organization.findUniqueOrThrow({
      where: { slug: DEV_ORGANIZATION.slug },
      select: { name: true },
    });

    expect(organization.name).toBe('AcmePay');
    expect(
      await prisma.membership.findMany({
        select: {
          role: true,
          user: { select: { email: true, passwordChangeRequired: true } },
        },
        orderBy: { user: { email: 'asc' } },
      }),
    ).toEqual(
      [
        ['admin@example.com', 'ADMIN'],
        ['alex@example.com', 'REPORTER'],
        ['ava@example.com', 'INCIDENT_MANAGER'],
        ['jordan@example.com', 'RESPONDER'],
        ['lee@example.com', 'RESPONDER'],
        ['priya@example.com', 'RESPONDER'],
        ['sam@example.com', 'RESPONDER'],
      ].map(([email, role]) => ({
        role,
        user: { email, passwordChangeRequired: false },
      })),
    );
    expect(
      await prisma.service.findMany({
        select: {
          name: true,
          criticality: true,
          ownerTeam: { select: { name: true } },
        },
        orderBy: { name: 'asc' },
      }),
    ).toEqual([
      {
        name: 'Authentication',
        criticality: 'HIGH',
        ownerTeam: { name: 'Platform' },
      },
      {
        name: 'Fraud Detection',
        criticality: 'HIGH',
        ownerTeam: { name: 'Risk' },
      },
      {
        name: 'Payment API',
        criticality: 'CRITICAL',
        ownerTeam: { name: 'Payments' },
      },
    ]);
    expect(await teamsOf('admin@example.com')).toEqual([]);
    expect(await teamsOf('ava@example.com')).toEqual([]);
    expect(await teamsOf('alex@example.com')).toEqual([]);
    expect(await teamsOf('priya@example.com')).toEqual(['Payments']);
    expect(await teamsOf('sam@example.com')).toEqual(['Payments', 'Risk']);
    expect(await teamsOf('lee@example.com')).toEqual(['Platform']);
    expect(await teamsOf('jordan@example.com')).toEqual(['Risk']);
    expect(await prisma.incident.count()).toBe(0);
  });

  it('should leave what the application changed alone on a later boot', async () => {
    await devAccount.ensure();
    await prisma.organization.update({
      where: { slug: DEV_ORGANIZATION.slug },
      data: { name: 'Renamed' },
    });
    await prisma.user.update({
      where: { email: 'sam@example.com' },
      data: { name: 'Samuel Okafor' },
    });
    await prisma.teamMembership.deleteMany({
      where: {
        team: { name: 'Risk' },
        membership: { user: { email: 'sam@example.com' } },
      },
    });

    await devAccount.ensure();

    expect(await prisma.organization.count()).toBe(1);
    expect(await prisma.team.count()).toBe(3);
    expect(await prisma.service.count()).toBe(3);
    expect(await prisma.membership.count()).toBe(DEV_PERSONAS.length);
    expect(
      await prisma.organization.findUniqueOrThrow({
        where: { slug: DEV_ORGANIZATION.slug },
        select: { name: true },
      }),
    ).toEqual({ name: 'Renamed' });
    expect(
      await prisma.user.findUniqueOrThrow({
        where: { email: 'sam@example.com' },
        select: { name: true },
      }),
    ).toEqual({ name: 'Samuel Okafor' });
    expect(await teamsOf('sam@example.com')).toEqual(['Payments']);
  });

  it('should restore a persona that can no longer sign in', async () => {
    await devAccount.ensure();
    await prisma.user.update({
      where: { email: 'priya@example.com' },
      data: {
        deletedAt: new Date(),
        passwordHash: null,
        passwordChangeRequired: true,
      },
    });

    await devAccount.ensure();

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'priya@example.com', password: DEV_PASSWORD });

    expect(login.status).toBe(200);
    expect(login.body.user.passwordChangeRequired).toBe(false);
  });

  it('should let every persona sign in and reach the organization', async () => {
    await devAccount.ensure();

    const { id } = await prisma.organization.findUniqueOrThrow({
      where: { slug: DEV_ORGANIZATION.slug },
      select: { id: true },
    });

    for (const persona of DEV_PERSONAS) {
      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: persona.email, password: DEV_PASSWORD });

      expect(login.status).toBe(200);

      const organization = await request(app.getHttpServer())
        .get(`/api/v1/organizations/${id}`)
        .set('Authorization', `Bearer ${login.body.accessToken}`);

      expect(organization.status).toBe(200);
      expect(organization.body.membership.role).toBe(persona.role);
    }
  });
});
