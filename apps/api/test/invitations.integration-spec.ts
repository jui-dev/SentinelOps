import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from './../src/app.module.js';
import { REFRESH_COOKIE_NAME } from './../src/auth/auth-cookie.js';
import { TokenService } from './../src/auth/token.service.js';
import { hashOpaqueToken } from './../src/common/opaque-token.js';
import { PrismaService } from './../src/database/prisma.service.js';
import type { Prisma } from './../src/generated/prisma/client.js';
import { InvitationsService } from './../src/invitations/invitations.service.js';
import { leakedKeys } from './leaks.js';
import { resolveTestDatabaseUrl } from './test-database.js';

/**
 * Invitations against a real database.
 *
 * Two tenants. In A: Alice (OWNER), Carol (ADMIN), Dave (MEMBER). In B: Bob
 * (OWNER) and Erin (MEMBER) — Erin is an existing account that A invites.
 *
 * Beyond the HTTP flows, this suite forces each race the design depends on,
 * deterministically, by holding a transaction open until the request under
 * test is observed waiting on its lock:
 *
 *   - a concurrent create that takes the open slot first    → 409, one open row;
 *   - a concurrent acceptance that claims first              → 404, no grant;
 *   - a membership or account that appears after the claim   → 409, claim rolled back.
 */

type Role = 'OWNER' | 'ADMIN' | 'MEMBER';

interface Fixture {
  orgA: string;
  orgB: string;
  alice: string;
  bob: string;
  carol: string;
  dave: string;
  erin: string;
}

const NEW_EMAIL = 'grace@new.example';
const PASSWORD = 'a sufficiently long passphrase';

const comparable = (body: Record<string, unknown>) => {
  const {
    requestId: _requestId,
    timestamp: _timestamp,
    path: _path,
    ...rest
  } = body;

  return rest;
};

describe('invitations (integration)', () => {
  const prisma = new PrismaService({ url: resolveTestDatabaseUrl() });
  let app: INestApplication;
  let tokens: TokenService;
  let fx: Fixture;

  const checked = (response: request.Response): request.Response => {
    expect(leakedKeys(response.body)).toEqual([]);

    return response;
  };

  const bearer = async (userId: string) =>
    `Bearer ${await tokens.signAccessToken(userId)}`;

  const invitationsPath = (organizationId: string) =>
    `/api/v1/organizations/${organizationId}/invitations`;

  const invite = async (
    organizationId: string,
    actor: string,
    email: string,
    role: string = 'MEMBER',
  ) =>
    checked(
      await request(app.getHttpServer())
        .post(invitationsPath(organizationId))
        .set('Authorization', await bearer(actor))
        .send({ email, role }),
    );

  /** Creates an invitation and returns its token, failing loudly otherwise. */
  const issue = async (
    email: string,
    role: string = 'MEMBER',
    organizationId = fx.orgA,
    actor = fx.alice,
  ): Promise<{ id: string; token: string }> => {
    const response = await invite(organizationId, actor, email, role);

    expect(response.status).toBe(201);

    return { id: response.body.invitation.id, token: response.body.token };
  };

  const list = async (organizationId: string, actor: string) =>
    checked(
      await request(app.getHttpServer())
        .get(invitationsPath(organizationId))
        .set('Authorization', await bearer(actor)),
    );

  const revoke = async (organizationId: string, actor: string, id: string) =>
    checked(
      await request(app.getHttpServer())
        .delete(`${invitationsPath(organizationId)}/${id}`)
        .set('Authorization', await bearer(actor)),
    );

  const lookup = async (token: string) =>
    checked(
      await request(app.getHttpServer())
        .post('/api/v1/invitations/lookup')
        .send({ token }),
    );

  const accept = async (token: string, userId: string) =>
    checked(
      await request(app.getHttpServer())
        .post('/api/v1/invitations/accept')
        .set('Authorization', await bearer(userId))
        .send({ token }),
    );

  const signup = async (token: string, name = 'Grace Hopper') =>
    checked(
      await request(app.getHttpServer())
        .post('/api/v1/auth/register/invitation')
        .send({ token, name, password: PASSWORD }),
    );

  const stateOf = (id: string) =>
    prisma.invitation.findUniqueOrThrow({
      where: { id },
      select: { acceptedAt: true, revokedAt: true },
    });

  const expectOpen = async (id: string) =>
    expect(await stateOf(id)).toEqual({ acceptedAt: null, revokedAt: null });

  const openRowsFor = (organizationId: string, email: string) =>
    prisma.invitation.count({
      where: { organizationId, email, acceptedAt: null, revokedAt: null },
    });

  const membershipOf = (organizationId: string, userId: string) =>
    prisma.membership.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { role: true },
    });

  const expectCode = (
    response: request.Response,
    status: number,
    code: string,
  ) => {
    expect(response.status).toBe(status);
    expect(response.body.code).toBe(code);
  };

  /**
   * Opens a transaction, runs `work` in it, and keeps it open until released —
   * so a concurrent request can be made to wait on the locks it holds.
   */
  const hold = async (
    work: (tx: Prisma.TransactionClient) => Promise<unknown>,
  ) => {
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const started = new Promise<void>((resolve) => (ready = resolve));

    const done = prisma.$transaction(
      async (tx) => {
        await work(tx);
        ready();
        await gate;
      },
      { timeout: 20_000 },
    );

    await started;

    return { release, done };
  };

  /** Resolves once some other session in this database is waiting on a lock. */
  const someoneIsWaitingOnALock = async () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const [{ waiting }] = await prisma.$queryRaw<{ waiting: number }[]>`
        SELECT count(*)::int AS waiting
        FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock'`;

      if (waiting > 0) return;

      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    throw new Error('No session started waiting on a lock');
  };

  /** Starts a supertest request without awaiting its completion. */
  const inFlight = (pending: Promise<request.Response>) => {
    const settled = pending.then(checked);
    // Avoids an unhandled rejection if the test fails before awaiting it.
    settled.catch(() => undefined);

    return settled;
  };

  const seed = async (): Promise<Fixture> => {
    const organization = async (name: string, slug: string) =>
      (
        await prisma.organization.create({
          data: { name, slug },
          select: { id: true },
        })
      ).id;
    const user = async (email: string, name: string) =>
      (
        await prisma.user.create({
          data: { email, name },
          select: { id: true },
        })
      ).id;
    const grant = (organizationId: string, userId: string, role: Role) =>
      prisma.membership.create({ data: { organizationId, userId, role } });

    const orgA = await organization('Acme Operations', 'acme-operations');
    const orgB = await organization('Bravo Reliability', 'bravo-reliability');
    const fixture = {
      orgA,
      orgB,
      alice: await user('alice@acme.example', 'Alice Anders'),
      bob: await user('bob@bravo.example', 'Bob Brandt'),
      carol: await user('carol@acme.example', 'Carol Chen'),
      dave: await user('dave@acme.example', 'Dave Duarte'),
      erin: await user('erin@bravo.example', 'Erin Ekström'),
    };

    await grant(orgA, fixture.alice, 'OWNER');
    await grant(orgA, fixture.carol, 'ADMIN');
    await grant(orgA, fixture.dave, 'MEMBER');
    await grant(orgB, fixture.bob, 'OWNER');
    await grant(orgB, fixture.erin, 'MEMBER');

    return fixture;
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
      'TRUNCATE TABLE invitations, refresh_tokens, memberships, users, organizations RESTART IDENTITY CASCADE',
    );

    fx = await seed();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('managing invitations', () => {
    it.each(['alice', 'carol'] as const)(
      'should let %s invite, list, and revoke',
      async (who) => {
        const created = await invite(fx.orgA, fx[who], NEW_EMAIL, 'ADMIN');

        expect(created.status).toBe(201);
        expect(created.body).toEqual({
          invitation: {
            id: expect.any(String),
            email: NEW_EMAIL,
            role: 'ADMIN',
            status: 'pending',
            expiresAt: expect.any(String),
            createdAt: expect.any(String),
            invitedBy: { id: fx[who], name: expect.any(String) },
          },
          token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
          replacedExisting: false,
        });

        const days =
          (Date.parse(created.body.invitation.expiresAt) -
            Date.parse(created.body.invitation.createdAt)) /
          (24 * 60 * 60 * 1000);

        expect(days).toBeCloseTo(7, 2);

        const listed = await list(fx.orgA, fx[who]);

        expect(listed.status).toBe(200);
        expect(listed.body).toEqual([created.body.invitation]);
        expect(JSON.stringify(listed.body)).not.toContain(created.body.token);

        const revoked = await revoke(
          fx.orgA,
          fx[who],
          created.body.invitation.id,
        );

        expect(revoked.status).toBe(204);
        expect((await list(fx.orgA, fx[who])).body).toEqual([]);
      },
    );

    it('should store only the hash of the token', async () => {
      const { id, token } = await issue(NEW_EMAIL);

      const row = await prisma.invitation.findUniqueOrThrow({ where: { id } });

      expect(row.tokenHash).toBe(hashOpaqueToken(token));
      expect(JSON.stringify(row)).not.toContain(token);
    });

    it('should refuse a MEMBER with 403 and write nothing', async () => {
      const { id } = await issue(NEW_EMAIL);

      expectCode(
        await invite(fx.orgA, fx.dave, 'someone@new.example'),
        403,
        'PERMISSION_DENIED',
      );
      expectCode(await list(fx.orgA, fx.dave), 403, 'PERMISSION_DENIED');
      expectCode(await revoke(fx.orgA, fx.dave, id), 403, 'PERMISSION_DENIED');

      expect(await prisma.invitation.count()).toBe(1);
      await expectOpen(id);
    });

    it("should answer another tenant's OWNER with the admission 404", async () => {
      const { id } = await issue(NEW_EMAIL);
      const foreign = await list(fx.orgA, fx.bob);
      const missing = await list(randomUUID(), fx.bob);

      expectCode(foreign, 404, 'ORGANIZATION_NOT_FOUND');
      expect(comparable(foreign.body)).toEqual(comparable(missing.body));
      expectCode(
        await revoke(fx.orgA, fx.bob, id),
        404,
        'ORGANIZATION_NOT_FOUND',
      );
      await expectOpen(id);
    });

    it('should answer an invitation from another organization with 404 and leave it open', async () => {
      const foreign = await issue(NEW_EMAIL, 'MEMBER', fx.orgB, fx.bob);

      const response = await revoke(fx.orgA, fx.alice, foreign.id);

      expectCode(response, 404, 'INVITATION_NOT_FOUND');
      expect(comparable(response.body)).toEqual(
        comparable((await revoke(fx.orgA, fx.alice, randomUUID())).body),
      );
      await expectOpen(foreign.id);
      expect((await list(fx.orgA, fx.alice)).body).toEqual([]);
    });

    it('should answer 409 for revoking an invitation that is no longer open', async () => {
      const revoked = await issue(NEW_EMAIL);
      await revoke(fx.orgA, fx.alice, revoked.id);

      expectCode(
        await revoke(fx.orgA, fx.alice, revoked.id),
        409,
        'INVITATION_NOT_PENDING',
      );

      const accepted = await issue('erin@bravo.example');
      expect((await accept(accepted.token, fx.erin)).status).toBe(200);

      expectCode(
        await revoke(fx.orgA, fx.alice, accepted.id),
        409,
        'INVITATION_NOT_PENDING',
      );
    });

    it('should refuse to invite a current member', async () => {
      const response = await invite(fx.orgA, fx.alice, 'dave@acme.example');

      expectCode(response, 409, 'ALREADY_A_MEMBER');
      expect(await prisma.invitation.count()).toBe(0);
    });

    it("should invite a member of another organization — membership elsewhere is not this tenant's business", async () => {
      expect(
        (await invite(fx.orgA, fx.alice, 'bob@bravo.example')).status,
      ).toBe(201);
    });

    it('should refuse a body that tries to set more than the email and role', async () => {
      for (const body of [
        { email: NEW_EMAIL, role: 'OWNER' },
        { email: NEW_EMAIL, role: 'MEMBER', organizationId: fx.orgB },
        { email: NEW_EMAIL, role: 'MEMBER', invitedById: fx.dave },
      ]) {
        const response = await request(app.getHttpServer())
          .post(invitationsPath(fx.orgA))
          .set('Authorization', await bearer(fx.alice))
          .send(body);

        expect(response.status).toBe(400);
      }

      expect(await prisma.invitation.count()).toBe(0);
    });

    it('should list open invitations only, newest first, marking expired ones', async () => {
      const first = await issue('first@new.example');
      const expired = await issue('expired@new.example');
      const revoked = await issue('revoked@new.example');
      const accepted = await issue('erin@bravo.example');
      const newest = await issue('newest@new.example');

      await prisma.invitation.update({
        where: { id: expired.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await revoke(fx.orgA, fx.alice, revoked.id);
      await accept(accepted.token, fx.erin);

      const listed = await list(fx.orgA, fx.carol);

      expect(
        listed.body.map((item: { id: string; status: string }) => [
          item.id,
          item.status,
        ]),
      ).toEqual([
        [newest.id, 'pending'],
        [expired.id, 'expired'],
        [first.id, 'pending'],
      ]);
    });

    it('should keep naming an inviter who has since been soft-deleted', async () => {
      await issue(NEW_EMAIL, 'MEMBER', fx.orgA, fx.carol);
      await prisma.user.update({
        where: { id: fx.carol },
        data: { deletedAt: new Date() },
      });

      const listed = await list(fx.orgA, fx.alice);

      expect(listed.body[0].invitedBy).toEqual({
        id: fx.carol,
        name: 'Carol Chen',
      });
    });
  });

  describe('one open invitation per organization and email', () => {
    it('should replace an open invitation, and say so', async () => {
      const first = await issue(NEW_EMAIL, 'MEMBER');
      const second = await invite(fx.orgA, fx.carol, NEW_EMAIL, 'ADMIN');

      expect(second.status).toBe(201);
      expect(second.body.replacedExisting).toBe(true);
      expect((await stateOf(first.id)).revokedAt).not.toBeNull();
      expect(await openRowsFor(fx.orgA, NEW_EMAIL)).toBe(1);
      expectCode(await lookup(first.token), 404, 'INVITATION_NOT_FOUND');
      expect((await lookup(second.body.token)).body.role).toBe('ADMIN');
    });

    it('should replace an expired invitation that nobody revoked', async () => {
      const expired = await issue(NEW_EMAIL);
      await prisma.invitation.update({
        where: { id: expired.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const replacement = await invite(fx.orgA, fx.alice, NEW_EMAIL);

      expect(replacement.body.replacedExisting).toBe(true);
      expect((await stateOf(expired.id)).revokedAt).not.toBeNull();
    });

    it('should allow a new invitation once the previous one was accepted or revoked', async () => {
      const revoked = await issue(NEW_EMAIL);
      await revoke(fx.orgA, fx.alice, revoked.id);

      const next = await invite(fx.orgA, fx.alice, NEW_EMAIL);

      expect(next.status).toBe(201);
      expect(next.body.replacedExisting).toBe(false);
    });

    it('should keep the same address independent across organizations', async () => {
      await issue(NEW_EMAIL, 'MEMBER', fx.orgA, fx.alice);
      const inB = await invite(fx.orgB, fx.bob, NEW_EMAIL);

      expect(inB.body.replacedExisting).toBe(false);
      expect(await openRowsFor(fx.orgA, NEW_EMAIL)).toBe(1);
      expect(await openRowsFor(fx.orgB, NEW_EMAIL)).toBe(1);
    });

    it('should be enforced by the database itself', async () => {
      await issue(NEW_EMAIL);

      await expect(
        prisma.invitation.create({
          data: {
            organizationId: fx.orgA,
            email: NEW_EMAIL,
            role: 'MEMBER',
            tokenHash: 'a-second-open-invitation',
            invitedById: fx.alice,
            expiresAt: new Date(Date.now() + 60_000),
          },
        }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('should answer 409 to a create that loses the open slot to a concurrent one', async () => {
      // The winner has inserted its row but not committed. The loser sees no
      // open invitation to replace, inserts, and waits on the index entry.
      const winner = await hold((tx) =>
        tx.invitation.create({
          data: {
            organizationId: fx.orgA,
            email: NEW_EMAIL,
            role: 'ADMIN',
            tokenHash: hashOpaqueToken('winner'),
            invitedById: fx.carol,
            expiresAt: new Date(Date.now() + 60_000),
          },
        }),
      );

      const loser = inFlight(
        request(app.getHttpServer())
          .post(invitationsPath(fx.orgA))
          .set('Authorization', await bearer(fx.alice))
          .send({ email: NEW_EMAIL, role: 'MEMBER' }),
      );

      await someoneIsWaitingOnALock();
      winner.release();
      await winner.done;

      const response = await loser;

      expectCode(response, 409, 'INVITATION_ALREADY_PENDING');
      expect(response.body).not.toHaveProperty('token');
      expect(await openRowsFor(fx.orgA, NEW_EMAIL)).toBe(1);
      expect(
        (
          await prisma.invitation.findFirstOrThrow({
            where: { email: NEW_EMAIL },
          })
        ).tokenHash,
      ).toBe(hashOpaqueToken('winner'));
    });

    it('should leave exactly one open invitation, and one working link, after a burst of concurrent creates', async () => {
      const actors = [fx.alice, fx.carol];
      const responses = await Promise.all(
        Array.from({ length: 12 }, (_, index) =>
          invite(fx.orgA, actors[index % 2] as string, NEW_EMAIL),
        ),
      );

      const created = responses.filter((response) => response.status === 201);
      const conflicted = responses.filter(
        (response) => response.status === 409,
      );

      expect(created.length + conflicted.length).toBe(responses.length);
      expect(created.length).toBeGreaterThanOrEqual(1);
      for (const response of conflicted) {
        expect(response.body.code).toBe('INVITATION_ALREADY_PENDING');
      }
      expect(await openRowsFor(fx.orgA, NEW_EMAIL)).toBe(1);

      const usable = [];

      for (const response of created) {
        if ((await lookup(response.body.token)).status === 200) {
          usable.push(response.body.token);
        }
      }

      expect(usable).toHaveLength(1);

      console.info(
        `[invitations] concurrent creates: ${created.length} created (${created.length - 1} superseded), ${conflicted.length} refused with 409`,
      );
    });
  });

  describe('looking an invitation up', () => {
    it('should describe a usable invitation to its holder', async () => {
      const { token } = await issue(NEW_EMAIL, 'ADMIN');

      const response = await lookup(token);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        organization: {
          id: fx.orgA,
          name: 'Acme Operations',
          slug: 'acme-operations',
        },
        email: NEW_EMAIL,
        role: 'ADMIN',
        expiresAt: expect.any(String),
        invitedBy: { name: 'Alice Anders' },
      });
      expect(JSON.stringify(response.body)).not.toContain(token);
    });

    it('should answer every unusable invitation identically', async () => {
      const unknown = await lookup('x'.repeat(43));

      const expired = await issue('expired@new.example');
      await prisma.invitation.update({
        where: { id: expired.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const revoked = await issue('revoked@new.example');
      await revoke(fx.orgA, fx.alice, revoked.id);

      const accepted = await issue('erin@bravo.example');
      await accept(accepted.token, fx.erin);

      const orphaned = await issue(NEW_EMAIL, 'MEMBER', fx.orgB, fx.bob);
      await prisma.organization.update({
        where: { id: fx.orgB },
        data: { deletedAt: new Date() },
      });

      expectCode(unknown, 404, 'INVITATION_NOT_FOUND');

      for (const token of [
        expired.token,
        revoked.token,
        accepted.token,
        orphaned.token,
      ]) {
        const response = await lookup(token);

        expect(response.status).toBe(404);
        expect(comparable(response.body)).toEqual(comparable(unknown.body));
      }
    });
  });

  describe('accepting as an existing account', () => {
    it('should grant the offered role, visible at once', async () => {
      const { id, token } = await issue('erin@bravo.example', 'ADMIN');
      const erin = await bearer(fx.erin);

      const response = await accept(token, fx.erin);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        id: expect.any(String),
        role: 'ADMIN',
        organization: {
          id: fx.orgA,
          name: 'Acme Operations',
          slug: 'acme-operations',
          createdAt: expect.any(String),
        },
      });
      expect(await membershipOf(fx.orgA, fx.erin)).toEqual({ role: 'ADMIN' });
      expect((await stateOf(id)).acceptedAt).not.toBeNull();

      const me = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', erin);

      expect(
        me.body.memberships.map(
          (m: { organization: { slug: string } }) => m.organization.slug,
        ),
      ).toEqual(['bravo-reliability', 'acme-operations']);

      const detail = await request(app.getHttpServer())
        .get(`/api/v1/organizations/${fx.orgA}`)
        .set('Authorization', erin);

      expect(detail.status).toBe(200);
      expect(detail.body.membership.permissions).toContain(
        'invitations:manage',
      );
    });

    it('should work exactly once', async () => {
      const { token } = await issue('erin@bravo.example');

      expect((await accept(token, fx.erin)).status).toBe(200);
      expectCode(await accept(token, fx.erin), 404, 'INVITATION_NOT_FOUND');
    });

    it('should refuse a caller with a different email and leave the invitation open', async () => {
      const { id, token } = await issue('erin@bravo.example');

      const response = await accept(token, fx.bob);

      expectCode(response, 403, 'INVITATION_EMAIL_MISMATCH');
      expect(JSON.stringify(response.body)).not.toMatch(/erin|bob@/);
      expect(await membershipOf(fx.orgA, fx.bob)).toBeNull();
      await expectOpen(id);
      expect((await accept(token, fx.erin)).status).toBe(200);
    });

    it('should refuse an existing member and leave the invitation open', async () => {
      // Dave became a member after the invitation was issued.
      await prisma.membership.deleteMany({
        where: { organizationId: fx.orgA, userId: fx.dave },
      });
      const { id, token } = await issue('dave@acme.example', 'ADMIN');
      await prisma.membership.create({
        data: { organizationId: fx.orgA, userId: fx.dave, role: 'MEMBER' },
      });

      expectCode(await accept(token, fx.dave), 409, 'ALREADY_A_MEMBER');
      expect(await membershipOf(fx.orgA, fx.dave)).toEqual({ role: 'MEMBER' });
      await expectOpen(id);
    });

    it('should refuse a soft-deleted caller with 401 and leave the invitation open', async () => {
      const { id, token } = await issue('erin@bravo.example');
      const erin = await bearer(fx.erin);
      await prisma.user.update({
        where: { id: fx.erin },
        data: { deletedAt: new Date() },
      });

      const response = await request(app.getHttpServer())
        .post('/api/v1/invitations/accept')
        .set('Authorization', erin)
        .send({ token });

      expect(response.status).toBe(401);
      await expectOpen(id);
    });

    it('should not accept for a soft-deleted organization', async () => {
      const { id, token } = await issue('erin@bravo.example');
      await prisma.organization.update({
        where: { id: fx.orgA },
        data: { deletedAt: new Date() },
      });

      expectCode(await accept(token, fx.erin), 404, 'INVITATION_NOT_FOUND');
      expect(await membershipOf(fx.orgA, fx.erin)).toBeNull();
      await expectOpen(id);
    });

    it('should answer 404 and grant nothing when a concurrent acceptance claims first', async () => {
      const { id, token } = await issue('erin@bravo.example');

      // Another request has claimed the row and not yet committed. This one
      // passes every check, reaches the claim, and waits.
      const other = await hold((tx) =>
        tx.invitation.update({
          where: { id },
          data: { acceptedAt: new Date() },
        }),
      );

      const loser = inFlight(
        request(app.getHttpServer())
          .post('/api/v1/invitations/accept')
          .set('Authorization', await bearer(fx.erin))
          .send({ token }),
      );

      await someoneIsWaitingOnALock();
      other.release();
      await other.done;

      expectCode(await loser, 404, 'INVITATION_NOT_FOUND');
      expect(await membershipOf(fx.orgA, fx.erin)).toBeNull();
    });

    it('should roll the claim back when the membership appears after it', async () => {
      const { id, token } = await issue('erin@bravo.example', 'ADMIN');

      // A membership for Erin, inserted but not committed: the request's
      // pre-check cannot see it, so it claims, then waits on the insert.
      const other = await hold((tx) =>
        tx.membership.create({
          data: { organizationId: fx.orgA, userId: fx.erin, role: 'MEMBER' },
        }),
      );

      const pending = inFlight(
        request(app.getHttpServer())
          .post('/api/v1/invitations/accept')
          .set('Authorization', await bearer(fx.erin))
          .send({ token }),
      );

      await someoneIsWaitingOnALock();
      other.release();
      await other.done;

      expectCode(await pending, 409, 'ALREADY_A_MEMBER');
      expect(await membershipOf(fx.orgA, fx.erin)).toEqual({ role: 'MEMBER' });
      await expectOpen(id);
    });

    it('should grant exactly one membership when the same token is accepted concurrently', async () => {
      const { id, token } = await issue('erin@bravo.example');

      const responses = await Promise.all(
        Array.from({ length: 10 }, () => accept(token, fx.erin)),
      );

      const statuses = responses.map((response) => response.status);

      expect(statuses.filter((status) => status === 200)).toHaveLength(1);
      for (const response of responses.filter((r) => r.status !== 200)) {
        expect([
          [404, 'INVITATION_NOT_FOUND'],
          [409, 'ALREADY_A_MEMBER'],
        ]).toContainEqual([response.status, response.body.code]);
      }
      expect(
        await prisma.membership.count({
          where: { organizationId: fx.orgA, userId: fx.erin },
        }),
      ).toBe(1);
      expect((await stateOf(id)).acceptedAt).not.toBeNull();

      console.info(`[invitations] concurrent accepts: ${statuses.join(', ')}`);
    });

    it('should settle an acceptance racing a revocation one way or the other', async () => {
      for (let round = 0; round < 5; round += 1) {
        await prisma.membership.deleteMany({
          where: { organizationId: fx.orgA, userId: fx.erin },
        });
        const { id, token } = await issue('erin@bravo.example');

        const [accepted, revoked] = await Promise.all([
          accept(token, fx.erin),
          revoke(fx.orgA, fx.alice, id),
        ]);
        const state = await stateOf(id);
        const membership = await membershipOf(fx.orgA, fx.erin);

        if (accepted.status === 200) {
          expectCode(revoked, 409, 'INVITATION_NOT_PENDING');
          expect(state).toEqual({
            acceptedAt: expect.any(Date),
            revokedAt: null,
          });
          expect(membership).not.toBeNull();
        } else {
          expectCode(accepted, 404, 'INVITATION_NOT_FOUND');
          expect(revoked.status).toBe(204);
          expect(state).toEqual({
            acceptedAt: null,
            revokedAt: expect.any(Date),
          });
          expect(membership).toBeNull();
        }
      }
    });

    it('should not be steered into another organization by the request', async () => {
      const { token } = await issue('erin@bravo.example');

      const response = await request(app.getHttpServer())
        .post(`/api/v1/invitations/accept?organizationId=${fx.orgB}`)
        .set('Authorization', await bearer(fx.erin))
        .set('X-Organization-Id', fx.orgB)
        .send({ token });

      expect(response.status).toBe(200);
      expect(response.body.organization.id).toBe(fx.orgA);
    });
  });

  describe('accepting by creating an account', () => {
    it("should create the account with the invitation's email, sign it in, and grant the role", async () => {
      const { id, token } = await issue(NEW_EMAIL, 'ADMIN');

      const response = await signup(token);

      expect(response.status).toBe(201);
      expect(response.body).toEqual({
        accessToken: expect.any(String),
        expiresIn: 900,
        tokenType: 'Bearer',
        user: {
          id: expect.any(String),
          email: NEW_EMAIL,
          name: 'Grace Hopper',
          createdAt: expect.any(String),
        },
      });
      expect(String(response.headers['set-cookie'])).toMatch(
        new RegExp(`^${REFRESH_COOKIE_NAME}=.+HttpOnly`, 'i'),
      );

      const userId = response.body.user.id as string;

      expect(await membershipOf(fx.orgA, userId)).toEqual({ role: 'ADMIN' });
      expect((await stateOf(id)).acceptedAt).not.toBeNull();
      expect(await prisma.organization.count()).toBe(2);

      const me = await request(app.getHttpServer())
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${response.body.accessToken}`);

      expect(me.body.memberships).toEqual([
        expect.objectContaining({
          role: 'ADMIN',
          organization: expect.objectContaining({ slug: 'acme-operations' }),
        }),
      ]);

      const login = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: NEW_EMAIL, password: PASSWORD });

      expect(login.status).toBe(200);
    });

    it('should work exactly once', async () => {
      const { token } = await issue(NEW_EMAIL);

      expect((await signup(token)).status).toBe(201);
      expectCode(
        await signup(token, 'Someone Else'),
        404,
        'INVITATION_NOT_FOUND',
      );
      expect(await prisma.user.count({ where: { email: NEW_EMAIL } })).toBe(1);
    });

    it('should refuse an address that already has an account and leave the invitation open', async () => {
      const { id, token } = await issue('erin@bravo.example');

      const response = await signup(token);

      expectCode(response, 409, 'EMAIL_ALREADY_REGISTERED');
      expect(response.headers['set-cookie']).toBeUndefined();
      await expectOpen(id);
      expect(await prisma.user.count()).toBe(5);
    });

    it('should count a soft-deleted account as holding its address', async () => {
      const { id, token } = await issue('erin@bravo.example');
      await prisma.user.update({
        where: { id: fx.erin },
        data: { deletedAt: new Date() },
      });

      expectCode(await signup(token), 409, 'EMAIL_ALREADY_REGISTERED');
      await expectOpen(id);
    });

    it('should create nothing for an unusable invitation', async () => {
      const { token } = await issue(NEW_EMAIL);
      await prisma.invitation.updateMany({ data: { revokedAt: new Date() } });

      const response = await signup(token);

      expectCode(response, 404, 'INVITATION_NOT_FOUND');
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(await prisma.user.count()).toBe(5);
      expect(await prisma.refreshToken.count()).toBe(0);
    });

    it('should roll the claim back when the address is registered after it', async () => {
      const { id, token } = await issue(NEW_EMAIL);

      // An account for the address, inserted but not committed: the request's
      // pre-check cannot see it, so it claims, then waits on its own insert.
      const other = await hold((tx) =>
        tx.user.create({
          data: { email: NEW_EMAIL, name: 'Registered First' },
        }),
      );

      const pending = inFlight(
        request(app.getHttpServer())
          .post('/api/v1/auth/register/invitation')
          .send({ token, name: 'Grace Hopper', password: PASSWORD }),
      );

      await someoneIsWaitingOnALock();
      other.release();
      await other.done;

      const response = await pending;

      expectCode(response, 409, 'EMAIL_ALREADY_REGISTERED');
      expect(response.headers['set-cookie']).toBeUndefined();
      await expectOpen(id);
      expect(await prisma.user.count({ where: { email: NEW_EMAIL } })).toBe(1);
      expect(
        await prisma.membership.count({ where: { organizationId: fx.orgA } }),
      ).toBe(3);
    });

    it('should create exactly one account when the same token is used concurrently', async () => {
      const { token } = await issue(NEW_EMAIL);

      const responses = await Promise.all(
        Array.from({ length: 8 }, (_, index) =>
          signup(token, `Grace ${index}`),
        ),
      );
      const statuses = responses.map((response) => response.status);

      expect(statuses.filter((status) => status === 201)).toHaveLength(1);
      for (const response of responses.filter((r) => r.status !== 201)) {
        expect([
          [404, 'INVITATION_NOT_FOUND'],
          [409, 'EMAIL_ALREADY_REGISTERED'],
        ]).toContainEqual([response.status, response.body.code]);
        expect(response.headers['set-cookie']).toBeUndefined();
      }
      expect(await prisma.user.count({ where: { email: NEW_EMAIL } })).toBe(1);
      expect(
        await prisma.membership.count({ where: { organizationId: fx.orgA } }),
      ).toBe(4);

      console.info(`[invitations] concurrent signups: ${statuses.join(', ')}`);
    });
  });

  describe('the identity and history model', () => {
    it('should create no user when an invitation is issued', async () => {
      const before = await prisma.user.count();

      await issue(NEW_EMAIL);

      expect(await prisma.user.count()).toBe(before);
      expect(
        await prisma.user.findUnique({ where: { email: NEW_EMAIL } }),
      ).toBeNull();
    });

    it('should keep the inviter reference through a soft delete', async () => {
      const { id } = await issue(NEW_EMAIL, 'MEMBER', fx.orgA, fx.carol);
      await prisma.user.update({
        where: { id: fx.carol },
        data: { deletedAt: new Date() },
      });

      expect(
        (await prisma.invitation.findUniqueOrThrow({ where: { id } }))
          .invitedById,
      ).toBe(fx.carol);
    });

    it('should refuse to physically delete a user who has sent invitations', async () => {
      await issue(NEW_EMAIL, 'MEMBER', fx.orgA, fx.carol);

      await expect(
        prisma.user.delete({ where: { id: fx.carol } }),
      ).rejects.toThrow();
      expect(await prisma.user.count({ where: { id: fx.carol } })).toBe(1);
    });

    it("should remove an organization's invitations when the organization is physically deleted", async () => {
      await issue(NEW_EMAIL);
      await issue(NEW_EMAIL, 'MEMBER', fx.orgB, fx.bob);

      await prisma.organization.delete({ where: { id: fx.orgA } });

      expect(await prisma.invitation.count()).toBe(1);
    });
  });

  describe('the service, with no guard in front of it', () => {
    const service = () => app.get(InvitationsService);

    it('should list only the organization it is given', async () => {
      await issue(NEW_EMAIL, 'MEMBER', fx.orgA, fx.alice);
      await issue('other@new.example', 'MEMBER', fx.orgB, fx.bob);

      const listed = await service().listOpen(fx.orgB);

      expect(listed.map((item) => item.email)).toEqual(['other@new.example']);
    });

    it('should not revoke an invitation of another organization', async () => {
      const inA = await issue(NEW_EMAIL);

      await expect(service().revoke(fx.orgB, inA.id)).rejects.toMatchObject({
        errorCode: 'INVITATION_NOT_FOUND',
      });
      await expectOpen(inA.id);
    });

    it('should not create an invitation for a soft-deleted organization', async () => {
      await prisma.organization.update({
        where: { id: fx.orgA },
        data: { deletedAt: new Date() },
      });

      await expect(
        service().create(
          fx.orgA,
          { userId: fx.alice },
          { email: NEW_EMAIL, role: 'MEMBER' },
        ),
      ).rejects.toMatchObject({ errorCode: 'ORGANIZATION_NOT_FOUND' });
      expect(await prisma.invitation.count()).toBe(0);
    });

    it('should only consider members of the given organization as already members', async () => {
      // Bob is a member of B, not of A.
      const created = await service().create(
        fx.orgA,
        { userId: fx.alice },
        { email: 'bob@bravo.example', role: 'MEMBER' },
      );

      expect(created.invitation.email).toBe('bob@bravo.example');
    });
  });
});
