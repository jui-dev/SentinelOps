import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from './../src/app.module.js';
import { PasswordService } from './../src/auth/password.service.js';
import { TokenService } from './../src/auth/token.service.js';
import { PrismaService } from './../src/database/prisma.service.js';
import { resolveTestDatabaseUrl } from './test-database.js';

const PASSWORD = 'correct-horse-battery';
const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const FIREFOX =
  'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0';

/**
 * Sign-ins and passwords in the activity log, through the real routes.
 *
 * Alice is the Admin of A. Priya is a member of A and of B. Lee is a member
 * of A, and the one whose password is guessed until the address is blocked
 * — nobody else's sign-in is tried wrongly, because the limiter outlives a
 * test.
 *
 * Proven here: what is recorded and in which organizations, that an address
 * with no account records nothing, the wrong passwords folding into one row
 * with the block after them, the totals, and one sign-in event in full.
 */
describe('activity log: sign-ins and passwords (integration)', () => {
  const prisma = new PrismaService({ url: resolveTestDatabaseUrl() });
  let app: INestApplication;
  let tokens: TokenService;
  let hash: string;
  let fx: {
    orgA: string;
    orgB: string;
    alice: string;
    priya: string;
    lee: string;
  };

  const signIn = (email: string, password = PASSWORD, agent = CHROME) =>
    request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('User-Agent', agent)
      .send({ email, password });

  const read = async (path: string) =>
    request(app.getHttpServer())
      .get(`/api/v1/organizations/${fx.orgA}/activity${path}`)
      .set('Authorization', `Bearer ${await tokens.signAccessToken(fx.alice)}`);

  const logOf = (organizationId: string) =>
    prisma.activityEntry.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('/api/v1');
    await app.init();
    tokens = app.get(TokenService);
    hash = await app.get(PasswordService).hash(PASSWORD);
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE activity_entries, refresh_tokens, memberships, users, organizations RESTART IDENTITY CASCADE',
    );

    const org = async (slug: string) =>
      (await prisma.organization.create({ data: { name: slug, slug } })).id;
    const user = async (name: string, passwordChangeRequired = false) =>
      (
        await prisma.user.create({
          data: {
            email: `${name.toLowerCase()}@example.com`,
            name,
            passwordHash: hash,
            passwordChangeRequired,
          },
        })
      ).id;
    const orgA = await org('acme');
    const orgB = await org('bravo');
    const alice = await user('Alice');
    const priya = await user('Priya', true);
    const lee = await user('Lee');

    await prisma.membership.createMany({
      data: [
        { organizationId: orgA, userId: alice, role: 'ADMIN' },
        { organizationId: orgA, userId: priya, role: 'RESPONDER' },
        { organizationId: orgB, userId: priya, role: 'RESPONDER' },
        { organizationId: orgA, userId: lee, role: 'RESPONDER' },
      ],
    });

    fx = { orgA, orgB, alice, priya, lee };
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('should record a sign-in in every organization the account belongs to, saying when it used a one-time password', async () => {
    expect((await signIn('priya@example.com')).status).toBe(200);

    for (const organizationId of [fx.orgA, fx.orgB]) {
      const [entry] = await logOf(organizationId);

      expect(entry).toMatchObject({
        action: 'SIGNED_IN',
        area: 'SECURITY',
        actorId: fx.priya,
        subjectType: 'MEMBERSHIP',
        subjectName: 'Priya',
        changes: [{ field: 'with', before: null, after: 'ONE_TIME_PASSWORD' }],
        userAgent: CHROME,
      });
    }
  });

  it('should record a password change, and that it replaced a one-time password', async () => {
    const session = await signIn('priya@example.com');

    await request(app.getHttpServer())
      .post('/api/v1/auth/password')
      .set('Authorization', `Bearer ${session.body.accessToken}`)
      .send({ currentPassword: PASSWORD, newPassword: 'a-brand-new-password' })
      .expect(200);

    expect((await logOf(fx.orgA)).at(-1)).toMatchObject({
      action: 'PASSWORD_CHANGED',
      changes: [
        { field: 'replaced', before: null, after: 'ONE_TIME_PASSWORD' },
      ],
    });
  });

  it('should record nothing for an address with no account', async () => {
    expect((await signIn('nobody@example.com', 'wrong')).status).toBe(401);

    // The failure is written without the sign-in waiting; give it the chance.
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(await prisma.activityEntry.count()).toBe(0);
  });

  it('should record each wrong password and the block, fold them into one row, count them, and show them in full', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect((await signIn('lee@example.com', 'wrong', FIREFOX)).status).toBe(
        401,
      );
    }

    await vi.waitFor(async () => {
      expect((await logOf(fx.orgA)).map((entry) => entry.action)).toEqual([
        'SIGN_IN_FAILED',
        'SIGN_IN_FAILED',
        'SIGN_IN_FAILED',
        'SIGN_IN_FAILED',
        'SIGN_IN_FAILED',
        'SIGN_IN_BLOCKED',
      ]);
    });

    const blocked = (await logOf(fx.orgA)).at(-1)!;
    const [until] = blocked.changes as { field: string; after: string }[];

    expect(until!.field).toBe('blockedUntil');
    expect(Date.parse(until!.after)).toBeGreaterThan(Date.now());

    // Blocked: even the right password is refused, and records nothing more.
    expect((await signIn('lee@example.com')).status).toBe(429);

    const page = await read('?view=security');

    expect(page.status).toBe(200);
    expect(
      (
        page.body.entries as {
          action: string;
          repeat: { count: number } | null;
        }[]
      ).map((entry) => [entry.action, entry.repeat?.count ?? 1]),
    ).toEqual([
      ['SIGN_IN_BLOCKED', 1],
      ['SIGN_IN_FAILED', 5],
    ]);
    expect(page.body.securityTotals).toEqual({
      signIns: 0,
      failedSignIns: 5,
      blocked: 1,
    });
    expect(page.body.areaCounts).toBeNull();

    // One kind only; the totals still count them all.
    const blocks = (await read('?view=security&result=SIGN_IN_BLOCKED')).body;

    expect(
      (blocks.entries as { action: string }[]).map((entry) => entry.action),
    ).toEqual(['SIGN_IN_BLOCKED']);
    expect(blocks.securityTotals.failedSignIns).toBe(5);

    // The folded row in full: each attempt, and what happened next.
    const folded = page.body.entries[1] as { id: string };
    const detail = (await read(`/${folded.id}`)).body;

    expect(detail.attempts).toHaveLength(5);
    expect(detail.next).toMatchObject({ action: 'SIGN_IN_BLOCKED' });
    expect(detail.client).toMatchObject({ browser: 'Firefox on Linux' });
    expect(detail.usualClient).toBeNull();
  });

  it('should say where an account usually signs in from', async () => {
    await signIn('alice@example.com');
    await signIn('alice@example.com');
    await signIn('alice@example.com', PASSWORD, FIREFOX);

    const page = await read('?view=security');
    const newest = page.body.entries[0] as { id: string; client: object };

    expect(newest.client).toMatchObject({ browser: 'Firefox on Linux' });
    expect((await read(`/${newest.id}`)).body.usualClient).toMatchObject({
      browser: 'Chrome on Windows',
    });

    // Sign-ins never appear among the changes.
    expect((await read('')).body.entries).toEqual([]);
  });
});
