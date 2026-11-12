import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from './../src/app.module.js';
import { TokenService } from './../src/auth/token.service.js';
import { PrismaService } from './../src/database/prisma.service.js';
import { resolveTestDatabaseUrl } from './test-database.js';

const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

/**
 * Every change to an organization's setup, made through the real routes,
 * leaves its entry in the activity log — and a change that fails, or that
 * changes nothing, leaves none.
 *
 * Organization A: Alice is the Admin, Ben a Responder. Organization B has
 * its own Admin, Bob, whose changes never reach A's log.
 */
// Invitations are off unless switched on, and this suite exercises them.
// Hoisted, so the flag is set before any configuration is read.
vi.hoisted(() => {
  process.env.INVITATIONS_ENABLED = 'true';
});

describe('activity log recording (integration)', () => {
  const prisma = new PrismaService({ url: resolveTestDatabaseUrl() });
  let app: INestApplication;
  let tokens: TokenService;
  let fx: {
    orgA: string;
    orgB: string;
    alice: string;
    ben: string;
    benInA: string;
    bob: string;
  };

  const send = async (
    method: 'get' | 'post' | 'patch' | 'put' | 'delete',
    path: string,
    body?: object,
    userId = fx.alice,
  ): Promise<request.Response> => {
    const pending = request(app.getHttpServer())
      [method](`/api/v1/organizations/${path}`)
      .set('Authorization', `Bearer ${await tokens.signAccessToken(userId)}`)
      .set('User-Agent', CHROME);

    return body === undefined ? pending : pending.send(body);
  };

  /** A's entries, oldest first, as stored. */
  const entries = () =>
    prisma.activityEntry.findMany({
      where: { organizationId: fx.orgA },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

  const last = async () => (await entries()).at(-1);

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
      'TRUNCATE TABLE activity_entries, incidents, known_issues, services, team_memberships, teams, invitations, refresh_tokens, memberships, users, organizations RESTART IDENTITY CASCADE',
    );

    const org = async (slug: string) =>
      (await prisma.organization.create({ data: { name: slug, slug } })).id;
    const user = async (name: string) =>
      (
        await prisma.user.create({
          data: { email: `${name.toLowerCase()}@example.com`, name },
        })
      ).id;
    const orgA = await org('Acme');
    const orgB = await org('Bravo');
    const [alice, ben, bob] = [
      await user('Alice'),
      await user('Ben'),
      await user('Bob'),
    ];

    await prisma.membership.createMany({
      data: [
        { organizationId: orgA, userId: alice, role: 'ADMIN' },
        { organizationId: orgB, userId: bob, role: 'ADMIN' },
      ],
    });
    const benInA = (
      await prisma.membership.create({
        data: { organizationId: orgA, userId: ben, role: 'RESPONDER' },
      })
    ).id;

    fx = { orgA, orgB, alice, ben, benInA, bob };
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('should record a rename with its old and new name, by whom, and from where', async () => {
    expect(
      (await send('patch', fx.orgA, { name: 'Acme Payments' })).status,
    ).toBe(200);

    expect(await last()).toMatchObject({
      action: 'ORGANIZATION_UPDATED',
      area: 'ORGANIZATION',
      actorId: fx.alice,
      actorName: 'Alice',
      subjectType: 'ORGANIZATION',
      subjectName: 'Acme Payments',
      changes: [{ field: 'name', before: 'Acme', after: 'Acme Payments' }],
      userAgent: CHROME,
    });
    expect((await last())?.ipAddress).toBeTruthy();
  });

  it('should record nothing for an edit that changes nothing', async () => {
    await send('patch', fx.orgA, { name: 'Acme' });

    expect(await entries()).toEqual([]);
  });

  it('should record members: added, role changed, password reset — never the password', async () => {
    const added = await send('post', `${fx.orgA}/memberships`, {
      email: 'sam@example.com',
      name: 'Sam Okafor',
      role: 'RESPONDER',
      temporaryPassword: 'a-one-time-password-1',
    });

    expect(added.status).toBe(201);

    const samInA = added.body.id as string;

    await send('put', `${fx.orgA}/memberships/${samInA}/role`, {
      role: 'INCIDENT_MANAGER',
    });
    await send('put', `${fx.orgA}/memberships/${samInA}/password`, {
      temporaryPassword: 'another-one-time-password',
    });

    const log = await entries();

    expect(
      log.map(({ action, subjectName, changes }) => ({
        action,
        subjectName,
        changes,
      })),
    ).toEqual([
      {
        action: 'MEMBER_ADDED',
        subjectName: 'Sam Okafor',
        changes: [
          { field: 'email', before: null, after: 'sam@example.com' },
          { field: 'role', before: null, after: 'RESPONDER' },
        ],
      },
      {
        action: 'ROLE_CHANGED',
        subjectName: 'Sam Okafor',
        changes: [
          { field: 'role', before: 'RESPONDER', after: 'INCIDENT_MANAGER' },
        ],
      },
      { action: 'PASSWORD_RESET', subjectName: 'Sam Okafor', changes: [] },
    ]);
    expect(JSON.stringify(log)).not.toContain('one-time-password');
    expect(log.every((entry) => entry.subjectId === samInA)).toBe(true);
  });

  it('should record teams: created, renamed, members on and off, deleted', async () => {
    const team = (await send('post', `${fx.orgA}/teams`, { name: 'Risk' }))
      .body as { id: string };

    await send('patch', `${fx.orgA}/teams/${team.id}`, {
      name: 'Risk & Fraud',
    });
    await send('post', `${fx.orgA}/teams/${team.id}/members`, {
      membershipId: fx.benInA,
    });
    await send('delete', `${fx.orgA}/teams/${team.id}/members/${fx.benInA}`);
    expect((await send('delete', `${fx.orgA}/teams/${team.id}`)).status).toBe(
      204,
    );

    expect(
      (await entries()).map(({ action, subjectName, changes }) => ({
        action,
        subjectName,
        changes,
      })),
    ).toEqual([
      {
        action: 'TEAM_CREATED',
        subjectName: 'Risk',
        changes: [{ field: 'name', before: null, after: 'Risk' }],
      },
      {
        action: 'TEAM_UPDATED',
        subjectName: 'Risk & Fraud',
        changes: [{ field: 'name', before: 'Risk', after: 'Risk & Fraud' }],
      },
      {
        action: 'TEAM_MEMBER_ADDED',
        subjectName: 'Risk & Fraud',
        changes: [{ field: 'member', before: null, after: 'Ben' }],
      },
      {
        action: 'TEAM_MEMBER_REMOVED',
        subjectName: 'Risk & Fraud',
        changes: [{ field: 'member', before: 'Ben', after: null }],
      },
      { action: 'TEAM_DELETED', subjectName: 'Risk & Fraud', changes: [] },
    ]);
  });

  it('should record services and known issues, field by field', async () => {
    const payments = (
      await send('post', `${fx.orgA}/teams`, { name: 'Payments' })
    ).body as { id: string };
    const service = (
      await send('post', `${fx.orgA}/services`, {
        name: 'Checkout API',
        ownerTeamId: payments.id,
        criticality: 'HIGH',
      })
    ).body as { id: string };

    await send('patch', `${fx.orgA}/services/${service.id}`, {
      criticality: 'CRITICAL',
      description: 'Takes card payments',
    });

    const timeouts = (
      await send('post', `${fx.orgA}/known-issues`, {
        serviceId: service.id,
        name: 'Card auth timeouts',
        usualSeverity: 'SEV2',
      })
    ).body as { id: string };
    const slow = (
      await send('post', `${fx.orgA}/known-issues`, {
        serviceId: service.id,
        name: 'Slow card auth',
        usualSeverity: 'SEV3',
      })
    ).body as { id: string };

    await send('post', `${fx.orgA}/known-issues/${slow.id}/merge`, {
      intoId: timeouts.id,
    });

    const log = (await entries()).slice(1); // after the team

    expect(log.map((entry) => entry.action)).toEqual([
      'SERVICE_CREATED',
      'SERVICE_UPDATED',
      'KNOWN_ISSUE_CREATED',
      'KNOWN_ISSUE_CREATED',
      'KNOWN_ISSUE_MERGED',
    ]);
    expect(log[0]?.changes).toEqual([
      { field: 'name', before: null, after: 'Checkout API' },
      { field: 'team', before: null, after: 'Payments' },
      { field: 'criticality', before: null, after: 'HIGH' },
    ]);
    expect(log[1]?.changes).toEqual([
      { field: 'description', before: null, after: 'Takes card payments' },
      { field: 'criticality', before: 'HIGH', after: 'CRITICAL' },
    ]);
    expect(log[4]).toMatchObject({
      subjectName: 'Slow card auth',
      changes: [
        { field: 'mergedInto', before: null, after: 'Card auth timeouts' },
        { field: 'incidentsMoved', before: null, after: '0' },
      ],
    });
  });

  it('should record invitations sent, revoked, and accepted by the person who joins', async () => {
    const sent = (
      await send('post', `${fx.orgA}/invitations`, {
        email: 'jordan@example.com',
        role: 'RESPONDER',
      })
    ).body as { invitation: { id: string } };

    expect(
      (await send('delete', `${fx.orgA}/invitations/${sent.invitation.id}`))
        .status,
    ).toBe(204);

    const again = (
      await send('post', `${fx.orgA}/invitations`, {
        email: 'bob@example.com',
        role: 'REPORTER',
      })
    ).body as { token: string };
    const accepted = await request(app.getHttpServer())
      .post('/api/v1/invitations/accept')
      .set('Authorization', `Bearer ${await tokens.signAccessToken(fx.bob)}`)
      .send({ token: again.token });

    expect(accepted.status).toBe(200);
    expect(
      (await entries()).map(({ action, actorName, subjectName }) => ({
        action,
        actorName,
        subjectName,
      })),
    ).toEqual([
      {
        action: 'INVITATION_SENT',
        actorName: 'Alice',
        subjectName: 'jordan@example.com',
      },
      {
        action: 'INVITATION_REVOKED',
        actorName: 'Alice',
        subjectName: 'jordan@example.com',
      },
      {
        action: 'INVITATION_SENT',
        actorName: 'Alice',
        subjectName: 'bob@example.com',
      },
      { action: 'INVITATION_ACCEPTED', actorName: 'Bob', subjectName: 'Bob' },
    ]);
  });

  it('should record nothing for a change that is refused', async () => {
    await send('post', `${fx.orgA}/teams`, { name: 'Payments' });
    const before = (await entries()).length;

    // A duplicate name, someone without the permission, and the last Admin.
    await send('post', `${fx.orgA}/teams`, { name: 'Payments' });
    await send('post', `${fx.orgA}/teams`, { name: 'Ops' }, fx.ben);

    const aliceInA = await prisma.membership.findFirstOrThrow({
      where: { organizationId: fx.orgA, userId: fx.alice },
    });

    expect(
      (
        await send('put', `${fx.orgA}/memberships/${aliceInA.id}/role`, {
          role: 'RESPONDER',
        })
      ).status,
    ).toBe(409);
    expect(await entries()).toHaveLength(before);
  });

  it("should keep each organization's changes in its own log", async () => {
    await send('post', `${fx.orgB}/teams`, { name: 'Ledger' }, fx.bob);

    expect(await entries()).toEqual([]);
    expect(
      await prisma.activityEntry.count({ where: { organizationId: fx.orgB } }),
    ).toBe(1);
  });
});
