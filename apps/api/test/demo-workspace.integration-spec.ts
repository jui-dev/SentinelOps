import type { INestApplication } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { AppModule } from './../src/app.module.js';
import { appConfig } from './../src/config/configuration.js';
import { PrismaService } from './../src/database/prisma.service.js';
import { DEV_ORGANIZATION, DEV_PERSONAS } from './../src/dev/dev-account.js';
import { DevAccountService } from './../src/dev/dev-account.service.js';
import { DemoHistoryService } from './../src/dev/demo-history/demo-history.service.js';
import type { DemoWorkspaceResponse } from './../src/dev/demo-workspace/demo-workspace.contract.js';
import { DemoWorkspaceService } from './../src/dev/demo-workspace/demo-workspace.service.js';
import { resolveTestDatabaseUrl } from './test-database.js';

/**
 * TEMPORARY — the demo workspace against a real database: what each part
 * counts, generating and removing parts with what they need and what needs
 * them, removing all the demo data with the accounts kept, and resetting —
 * all on the demo organization alone, and only in development. Delete with
 * src/dev/.
 */
describe('demo workspace (integration)', () => {
  const prisma = new PrismaService({ url: resolveTestDatabaseUrl() });
  const now = new Date('2026-11-15T09:12:00.000Z');

  let app: INestApplication;
  let devAccount: DevAccountService;
  let demo: DemoWorkspaceService;
  let organizationId: string;
  let adminId: string;

  const part = (status: DemoWorkspaceResponse, id: string) =>
    status.parts.find((each) => each.id === id)!;
  const loaded = (status: DemoWorkspaceResponse) =>
    status.parts.filter((each) => each.loaded).map((each) => each.id);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      // The workspace answers only in development.
      .overrideProvider(appConfig.KEY)
      .useValue({ ...appConfig(), environment: 'development' })
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    devAccount = app.get(DevAccountService);
    demo = app.get(DemoWorkspaceService);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE demo_workspaces, notifications, activity_entries, incidents, known_issues, services, team_memberships, teams, invitations, refresh_tokens, memberships, users, organizations RESTART IDENTITY CASCADE',
    );
    await devAccount.ensure();
    ({ id: organizationId } = await prisma.organization.findUniqueOrThrow({
      where: { slug: DEV_ORGANIZATION.slug },
      select: { id: true },
    }));
    ({ id: adminId } = await prisma.user.findUniqueOrThrow({
      where: { email: 'admin@example.com' },
      select: { id: true },
    }));
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('should count the essentials of a new demo, and nothing optional yet', async () => {
    const status = await demo.status(organizationId);

    expect(loaded(status)).toEqual(['accounts', 'teams', 'services']);
    expect(part(status, 'accounts')).toMatchObject({
      required: true,
      count: DEV_PERSONAS.length,
      generatable: true,
    });
    expect(part(status, 'history')).toMatchObject({
      required: false,
      needs: ['teams', 'services'],
      count: 0,
      loaded: false,
    });
    expect(status.complete).toBe(false);
    expect(status.lastResetAt).toBeNull();
  });

  it('should reset to the full demo, ending today, and say who reset it when', async () => {
    const status = await demo.reset(organizationId, adminId, now);

    expect(loaded(status)).toEqual([
      'accounts',
      'teams',
      'services',
      'knownIssues',
      'history',
      'live',
      'activity',
    ]);
    expect(part(status, 'live').count).toBe(5);
    expect(status.lastResetAt).toBe(now.toISOString());
    expect(status.lastResetBy).toEqual({ id: adminId, name: 'Dev Admin' });
    expect(status.historyEndsAt).toBe('2026-11-15T00:00:00.000Z');
  });

  it('should reset over whatever was changed, keeping members someone added', async () => {
    await demo.reset(organizationId, adminId, now);
    // Renamed, rehomed, demoted, and someone of their own added.
    await prisma.team.updateMany({
      where: { organizationId, name: 'Risk' },
      data: { name: 'Fraud' },
    });
    await prisma.membership.updateMany({
      where: { organizationId, user: { email: 'ava@example.com' } },
      data: { role: 'RESPONDER' },
    });
    const added = await prisma.user.create({
      data: { email: 'new@example.com', name: 'New Person' },
      select: { id: true },
    });
    await prisma.membership.create({
      data: { organizationId, userId: added.id, role: 'REPORTER' },
    });

    await demo.reset(organizationId, adminId, now);

    expect(
      (
        await prisma.team.findMany({
          where: { organizationId },
          select: { name: true },
          orderBy: { name: 'asc' },
        })
      ).map(({ name }) => name),
    ).toEqual(['Payments', 'Platform', 'Risk']);
    expect(
      await prisma.membership.findFirstOrThrow({
        where: { organizationId, user: { email: 'ava@example.com' } },
        select: { role: true },
      }),
    ).toEqual({ role: 'INCIDENT_MANAGER' });
    expect(
      await prisma.membership.count({
        where: { organizationId, userId: added.id },
      }),
    ).toBe(1);
  });

  it('should remove all the demo data but the organization and its accounts', async () => {
    await demo.reset(organizationId, adminId, now);

    const status = await demo.removeAll(organizationId);

    expect(loaded(status)).toEqual(['accounts']);
    expect(
      await prisma.organization.count({ where: { id: organizationId } }),
    ).toBe(1);
    expect(
      await prisma.membership.count({
        where: { organizationId, removedAt: null },
      }),
    ).toBe(DEV_PERSONAS.length);
    // A demo account can still sign in: its password is kept.
    expect(
      await prisma.user.count({
        where: {
          email: { in: DEV_PERSONAS.map((p) => p.email) },
          passwordHash: { not: null },
        },
      }),
    ).toBe(DEV_PERSONAS.length);
  });

  it('should generate the essentials back, what each needs first', async () => {
    await demo.removeAll(organizationId);

    // Services need teams: asking for services makes both.
    const status = await demo.generate(organizationId, 'services');

    expect(loaded(status)).toEqual(['accounts', 'teams', 'services']);
    expect(part(status, 'teams').count).toBe(3);
    expect(part(status, 'services').count).toBe(3);
    // Each demo account back on its own teams.
    expect(
      await prisma.teamMembership.count({
        where: {
          organizationId,
          membership: { user: { email: 'sam@example.com' } },
        },
      }),
    ).toBe(2);
  });

  it('should remove an optional part with what needs it, and leave what it only used', async () => {
    await demo.reset(organizationId, adminId, now);

    // The history goes with its analyses; the live incidents stay.
    let status = await demo.remove(organizationId, 'history');

    expect(part(status, 'history').loaded).toBe(false);
    expect(part(status, 'live').count).toBe(5);

    // Known issues only named by incidents: the incidents stay.
    status = await demo.remove(organizationId, 'knownIssues');

    expect(part(status, 'knownIssues').loaded).toBe(false);
    expect(part(status, 'live').count).toBe(5);
  });

  it('should refuse to remove a required part on its own', async () => {
    await expect(demo.remove(organizationId, 'teams')).rejects.toMatchObject({
      errorCode: 'DEMO_PART_REQUIRED',
    });
  });

  it('should refuse a part still generated only with the full demo', async () => {
    await expect(
      demo.generate(organizationId, 'history'),
    ).rejects.toMatchObject({
      errorCode: 'DEMO_PART_NOT_GENERATED_ALONE',
    });
  });

  it('should answer as if there were no demo for an organization that is not one', async () => {
    await prisma.organization.update({
      where: { id: organizationId },
      data: { isDemo: false },
    });

    await expect(demo.status(organizationId)).rejects.toMatchObject({
      errorCode: 'DEMO_NOT_FOUND',
    });
  });

  it('should answer as if there were no demo outside development', async () => {
    const outside = new DemoWorkspaceService(
      prisma,
      devAccount,
      app.get(DemoHistoryService),
      { ...appConfig(), environment: 'test' } as ConfigType<typeof appConfig>,
    );

    await expect(outside.status(organizationId)).rejects.toMatchObject({
      errorCode: 'DEMO_NOT_FOUND',
    });
  });
});
