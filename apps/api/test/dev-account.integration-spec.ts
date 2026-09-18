import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from './../src/app.module.js';
import { PrismaService } from './../src/database/prisma.service.js';
import { DEV_ACCOUNT } from './../src/dev/dev-account.js';
import { DevAccountService } from './../src/dev/dev-account.service.js';
import { resolveTestDatabaseUrl } from './test-database.js';

/**
 * TEMPORARY — the development account against a real database: ensuring it
 * is idempotent, restores what was changed, and yields credentials that log
 * in. Delete with src/dev/.
 */
describe('development account (integration)', () => {
  const prisma = new PrismaService({ url: resolveTestDatabaseUrl() });
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('/api/v1');
    await app.init();
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

  it('should not be created outside development', async () => {
    // Booting the application above ran the hook in the test environment.
    expect(await prisma.user.count()).toBe(0);
  });

  it('should be ensured idempotently, restored when changed, and log in as OWNER', async () => {
    const devAccount = app.get(DevAccountService);

    await devAccount.ensure();
    await prisma.user.update({
      where: { email: DEV_ACCOUNT.email },
      data: { deletedAt: new Date(), passwordHash: null },
    });
    await devAccount.ensure();

    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.organization.count()).toBe(1);
    expect(
      await prisma.membership.findFirstOrThrow({ select: { role: true } }),
    ).toEqual({ role: 'OWNER' });

    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: DEV_ACCOUNT.email, password: DEV_ACCOUNT.password });

    expect(login.status).toBe(200);
  });
});
