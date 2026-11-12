import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { recordActivity } from './../src/activity/activity.recorder.js';
import { ACTIVITY_PAGE_SIZE } from './../src/activity/activity.service.js';
import { AppModule } from './../src/app.module.js';
import { TokenService } from './../src/auth/token.service.js';
import { PrismaService } from './../src/database/prisma.service.js';
import type {
  ActivityAction,
  ActivityArea,
} from './../src/generated/prisma/enums.js';
import { leakedKeys } from './leaks.js';
import { resolveTestDatabaseUrl } from './test-database.js';

/**
 * The activity log against a real database and through the real routes.
 *
 * Organization A: Alice is the Admin, Ben an Incident Manager. Organization
 * B has its own Admin, Bob. Entries are written directly — the changes that
 * write them come in later stages — at chosen times, so order is certain.
 *
 * Proven here: only the Admin reads it; the two views, the filters and the
 * area counts; paging; one entry with its earlier history and whether its
 * subject still exists; one organization never sees another's; and an entry,
 * once written, cannot be changed — by the database itself.
 */
describe('activity log (integration)', () => {
  const prisma = new PrismaService({ url: resolveTestDatabaseUrl() });
  let app: INestApplication;
  let tokens: TokenService;
  let fx: {
    orgA: string;
    orgB: string;
    alice: string;
    ben: string;
    bob: string;
  };

  const call = async (
    path: string,
    userId: string,
  ): Promise<request.Response> => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/organizations/${path}`)
      .set('Authorization', `Bearer ${await tokens.signAccessToken(userId)}`);

    expect(leakedKeys(response.body)).toEqual([]);

    return response;
  };

  const AREA: Record<string, ActivityArea> = {
    ROLE_CHANGED: 'PEOPLE',
    MEMBER_ADDED: 'PEOPLE',
    TEAM_CREATED: 'TEAMS',
    TEAM_UPDATED: 'TEAMS',
    SERVICE_UPDATED: 'SERVICES',
    ORGANIZATION_UPDATED: 'ORGANIZATION',
    SIGNED_IN: 'SECURITY',
    SIGN_IN_FAILED: 'SECURITY',
  };

  /** One entry, `minutesAgo` before a fixed moment. */
  const entry = async (
    action: ActivityAction,
    minutesAgo: number,
    extra: {
      organizationId?: string;
      actorId?: string;
      actorName?: string;
      subjectType?: 'TEAM' | 'MEMBERSHIP' | 'SERVICE' | 'ORGANIZATION';
      subjectId?: string;
      subjectName?: string;
    } = {},
  ) =>
    (
      await prisma.activityEntry.create({
        data: {
          organizationId: extra.organizationId ?? fx.orgA,
          action,
          area: AREA[action]!,
          actorId: extra.actorId ?? fx.alice,
          actorName: extra.actorName ?? 'Alice',
          // A named subject always has a type and an id, as recorded ones do.
          subjectType: extra.subjectType ?? (extra.subjectName ? 'TEAM' : null),
          subjectId:
            extra.subjectId ?? (extra.subjectName ? randomUUID() : null),
          subjectName: extra.subjectName ?? null,
          createdAt: new Date(
            Date.parse('2026-11-12T12:00:00.000Z') - minutesAgo * 60_000,
          ),
        },
      })
    ).id;

  const list = async (query = '', userId = fx.alice) => {
    const response = await call(`${fx.orgA}/activity${query}`, userId);

    expect(response.status).toBe(200);

    return response.body as {
      entries: {
        id: string;
        action: string;
        area: string;
        actor: { name: string };
        subject: { name: string } | null;
      }[];
      nextCursor: string | null;
      areaCounts: Record<string, number> | null;
    };
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

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE activity_entries, services, team_memberships, teams, invitations, refresh_tokens, memberships, users, organizations RESTART IDENTITY CASCADE',
    );

    const org = async (slug: string) =>
      (await prisma.organization.create({ data: { name: slug, slug } })).id;
    const user = async (name: string) =>
      (
        await prisma.user.create({
          data: { email: `${name}@example.com`, name },
        })
      ).id;
    const orgA = await org('acme');
    const orgB = await org('bravo');
    const [alice, ben, bob] = [
      await user('Alice'),
      await user('Ben'),
      await user('Bob'),
    ];

    await prisma.membership.createMany({
      data: [
        { organizationId: orgA, userId: alice, role: 'ADMIN' },
        { organizationId: orgA, userId: ben, role: 'INCIDENT_MANAGER' },
        { organizationId: orgB, userId: bob, role: 'ADMIN' },
      ],
    });

    fx = { orgA, orgB, alice, ben, bob };
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('should let only the Admin read the log or an entry', async () => {
    const id = await entry('TEAM_CREATED', 5);

    for (const response of [
      await call(`${fx.orgA}/activity`, fx.ben),
      await call(`${fx.orgA}/activity/${id}`, fx.ben),
    ]) {
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('PERMISSION_DENIED');
    }

    expect((await call(`${fx.orgA}/activity/${id}`, fx.alice)).status).toBe(
      200,
    );
  });

  it('should keep changes and sign-ins on separate views, newest first, with area counts', async () => {
    await entry('TEAM_CREATED', 30, { subjectName: 'Risk' });
    await entry('SIGNED_IN', 20);
    await entry('ROLE_CHANGED', 10, { subjectName: 'Sam Okafor' });
    await entry('SERVICE_UPDATED', 5, { subjectName: 'Checkout API' });
    await entry('SIGN_IN_FAILED', 1);

    const changes = await list();

    expect(changes.entries.map((e) => e.action)).toEqual([
      'SERVICE_UPDATED',
      'ROLE_CHANGED',
      'TEAM_CREATED',
    ]);
    expect(changes.areaCounts).toEqual({
      PEOPLE: 1,
      TEAMS: 1,
      SERVICES: 1,
      KNOWN_ISSUES: 0,
      ORGANIZATION: 0,
    });
    expect(changes.nextCursor).toBeNull();

    const security = await list('?view=security');

    expect(security.entries.map((e) => e.action)).toEqual([
      'SIGN_IN_FAILED',
      'SIGNED_IN',
    ]);
    expect(security.areaCounts).toBeNull();
  });

  it('should filter by area, person, search and period — counting areas under all but the area', async () => {
    await entry('TEAM_CREATED', 60 * 24 * 10, { subjectName: 'Old team' });
    await entry('TEAM_UPDATED', 40, { subjectName: 'Risk' });
    await entry('ROLE_CHANGED', 30, {
      actorId: fx.ben,
      actorName: 'Ben',
      subjectName: 'Sam Okafor',
    });
    await entry('ORGANIZATION_UPDATED', 20, { subjectName: 'Acme Payments' });

    expect((await list('?area=TEAMS')).entries.map((e) => e.action)).toEqual([
      'TEAM_UPDATED',
      'TEAM_CREATED',
    ]);

    const byBen = await list(`?actorId=${fx.ben}`);

    expect(byBen.entries.map((e) => e.actor.name)).toEqual(['Ben']);

    // A search matches who did it or what it was done to, in any case.
    expect((await list('?q=SAM')).entries.map((e) => e.subject?.name)).toEqual([
      'Sam Okafor',
    ]);
    expect((await list('?q=ben')).entries).toHaveLength(1);

    const lastWeek = await list(
      `?area=TEAMS&since=${encodeURIComponent('2026-11-05T12:00:00.000Z')}`,
    );

    expect(lastWeek.entries.map((e) => e.subject?.name)).toEqual(['Risk']);
    expect(lastWeek.areaCounts).toEqual({
      PEOPLE: 1,
      TEAMS: 1,
      SERVICES: 0,
      KNOWN_ISSUES: 0,
      ORGANIZATION: 1,
    });
  });

  it('should page through the log, and refuse a cursor it did not make', async () => {
    for (let minute = 1; minute <= ACTIVITY_PAGE_SIZE + 5; minute += 1) {
      await entry('TEAM_UPDATED', minute, { subjectName: `Team ${minute}` });
    }

    const first = await list();

    expect(first.entries).toHaveLength(ACTIVITY_PAGE_SIZE);
    expect(first.entries[0]!.subject?.name).toBe('Team 1');
    expect(first.nextCursor).not.toBeNull();

    const second = await list(
      `?cursor=${encodeURIComponent(first.nextCursor!)}`,
    );

    expect(second.entries.map((e) => e.subject?.name)).toEqual([
      'Team 51',
      'Team 52',
      'Team 53',
      'Team 54',
      'Team 55',
    ]);
    expect(second.nextCursor).toBeNull();

    const bad = await call(`${fx.orgA}/activity?cursor=nonsense`, fx.alice);

    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('INVALID_CURSOR');
  });

  it('should show one entry with its earlier history, and whether its subject still exists', async () => {
    const risk = await prisma.team.create({
      data: { organizationId: fx.orgA, name: 'Risk', slug: 'risk' },
    });
    const about = {
      subjectType: 'TEAM' as const,
      subjectId: risk.id,
      subjectName: 'Risk',
    };

    for (const minutesAgo of [50, 40, 30, 20]) {
      await entry('TEAM_UPDATED', minutesAgo, about);
    }
    await entry('TEAM_CREATED', 60, about);
    await entry('TEAM_UPDATED', 15, { subjectName: 'Another team' });
    const id = await entry('TEAM_UPDATED', 10, about);
    await entry('TEAM_UPDATED', 1, about);

    const response = await call(`${fx.orgA}/activity/${id}`, fx.alice);

    expect(response.status).toBe(200);
    expect(response.body.reference).toMatch(/^ACT-[0-9A-F]{4}-[0-9A-F]{4}$/);
    // The three before it, about the same team, newest first.
    expect(
      (response.body.history as { occurredAt: string }[]).map(
        (h) => h.occurredAt,
      ),
    ).toEqual([
      '2026-11-12T11:40:00.000Z',
      '2026-11-12T11:30:00.000Z',
      '2026-11-12T11:20:00.000Z',
    ]);
    expect(response.body.subjectNow).toEqual({ exists: true, slug: 'risk' });

    await prisma.team.delete({ where: { id: risk.id } });

    expect(
      (await call(`${fx.orgA}/activity/${id}`, fx.alice)).body.subjectNow,
    ).toEqual({ exists: false, slug: null });
  });

  it("should never show one organization another's entries", async () => {
    const theirs = await entry('TEAM_CREATED', 5, {
      organizationId: fx.orgB,
      actorId: fx.bob,
      actorName: 'Bob',
    });

    expect((await list()).entries).toEqual([]);

    for (const id of [theirs, 'not-an-id']) {
      const response = await call(`${fx.orgA}/activity/${id}`, fx.alice);

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('ACTIVITY_ENTRY_NOT_FOUND');
    }
  });

  it('should refuse to change an entry, in the database itself', async () => {
    const id = await entry('ROLE_CHANGED', 5, { subjectName: 'Sam Okafor' });

    await expect(
      prisma.activityEntry.update({
        where: { id },
        data: { subjectName: 'Someone else' },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.$executeRawUnsafe(
        `UPDATE activity_entries SET subject_name = 'Someone else' WHERE id = '${id}'`,
      ),
    ).rejects.toThrow(/permanent/);

    expect(
      (await prisma.activityEntry.findUniqueOrThrow({ where: { id } }))
        .subjectName,
    ).toBe('Sam Okafor');
  });

  it('should be saved with the change that wrote it, or not at all', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await recordActivity(tx, {
          organizationId: fx.orgA,
          action: 'TEAM_CREATED',
          actorId: fx.alice,
          subject: { type: 'TEAM', id: fx.orgA, name: 'Rolled back' },
        });
        throw new Error('the change failed');
      }),
    ).rejects.toThrow('the change failed');

    expect(await prisma.activityEntry.count()).toBe(0);

    await prisma.$transaction((tx) =>
      recordActivity(tx, {
        organizationId: fx.orgA,
        action: 'TEAM_CREATED',
        actorId: fx.alice,
        subject: { type: 'TEAM', id: fx.orgA, name: 'Kept' },
      }),
    );

    const [kept] = (await list()).entries;

    expect(kept).toMatchObject({
      action: 'TEAM_CREATED',
      area: 'TEAMS',
      actor: { name: 'Alice' },
      subject: { name: 'Kept' },
    });
  });
});
