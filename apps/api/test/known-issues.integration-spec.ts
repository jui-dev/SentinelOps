import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from './../src/app.module.js';
import { TokenService } from './../src/auth/token.service.js';
import { PrismaService } from './../src/database/prisma.service.js';
import { resolveTestDatabaseUrl } from './test-database.js';

/**
 * Known issues against a real database and through the real routes.
 *
 * Organization A: Alice is the Admin, Ben a member. Payment API and Portal
 * are two services. Organization B has its own Ledger service.
 *
 * Proven here: who may read and change them; the list's order and counts;
 * names unique per service in any case; archiving; merging, which moves the
 * incidents and refuses another service's; and declaring — by choosing one,
 * by saving something new, or neither — including the database's own refusal
 * to link an incident to another service's known issue.
 */
describe('known issues (integration)', () => {
  const prisma = new PrismaService({ url: resolveTestDatabaseUrl() });
  let app: INestApplication;
  let tokens: TokenService;
  let fx: {
    orgA: string;
    orgB: string;
    alice: string;
    ben: string;
    bob: string;
    paymentApi: string;
    portal: string;
    ledgerB: string;
  };

  const call = async (
    method: 'get' | 'post' | 'patch',
    path: string,
    userId: string,
    body?: object,
  ): Promise<request.Response> => {
    const pending = request(app.getHttpServer())
      [method](`/api/v1/organizations/${path}`)
      .set('Authorization', `Bearer ${await tokens.signAccessToken(userId)}`);

    return body === undefined ? pending : pending.send(body);
  };

  const known = async (
    name: string,
    serviceId = fx.paymentApi,
    extra: object = {},
  ) => {
    const response = await call('post', `${fx.orgA}/known-issues`, fx.alice, {
      serviceId,
      name,
      usualSeverity: 'SEV2',
      ...extra,
    });

    expect(response.status).toBe(201);

    return response.body as { id: string; name: string };
  };

  const declare = async (body: object, expected = 201) => {
    const response = await call('post', `${fx.orgA}/incidents`, fx.alice, {
      title: 'Card payments failing',
      serviceId: fx.paymentApi,
      severity: 'SEV1',
      ...body,
    });

    expect(response.status).toBe(expected);

    return response;
  };

  const listed = async (query = '') =>
    (await call('get', `${fx.orgA}/known-issues${query}`, fx.ben)).body as {
      id: string;
      name: string;
      pendingReview: boolean;
      archivedAt: string | null;
      occurrences: {
        total: number;
        lastAt: string | null;
        active: number | null;
      };
    }[];

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
      'TRUNCATE TABLE incidents, known_issues, services, team_memberships, teams, invitations, refresh_tokens, memberships, users, organizations RESTART IDENTITY CASCADE',
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
      await user('alice'),
      await user('ben'),
      await user('bob'),
    ];

    await prisma.membership.createMany({
      data: [
        { organizationId: orgA, userId: alice, role: 'ADMIN' },
        { organizationId: orgA, userId: ben, role: 'MEMBER' },
        { organizationId: orgB, userId: bob, role: 'ADMIN' },
      ],
    });

    const team = async (organizationId: string, name: string) =>
      (
        await prisma.team.create({
          data: { organizationId, name, slug: name.toLowerCase() },
        })
      ).id;
    const service = async (
      organizationId: string,
      ownerTeamId: string,
      name: string,
    ) =>
      (
        await prisma.service.create({
          data: {
            organizationId,
            ownerTeamId,
            name,
            slug: name.toLowerCase().replace(/ /g, '-'),
          },
        })
      ).id;
    const payments = await team(orgA, 'Payments');
    const ledgerTeam = await team(orgB, 'Ledger');

    fx = {
      orgA,
      orgB,
      alice,
      ben,
      bob,
      paymentApi: await service(orgA, payments, 'Payment API'),
      portal: await service(orgA, payments, 'Portal'),
      ledgerB: await service(orgB, ledgerTeam, 'Ledger'),
    };
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  describe('who may do what', () => {
    it('should let every member read them, and only the Admin change them', async () => {
      const issue = await known('Card payments failing at checkout');

      expect(
        (await call('get', `${fx.orgA}/known-issues`, fx.ben)).status,
      ).toBe(200);
      expect(
        (await call('get', `${fx.orgA}/known-issues/${issue.id}`, fx.ben))
          .status,
      ).toBe(200);

      for (const response of [
        await call('post', `${fx.orgA}/known-issues`, fx.ben, {
          serviceId: fx.paymentApi,
          name: 'Something',
          usualSeverity: 'SEV3',
        }),
        await call('patch', `${fx.orgA}/known-issues/${issue.id}`, fx.ben, {
          reviewed: true,
        }),
      ]) {
        expect(response.status).toBe(403);
        expect(response.body.code).toBe('PERMISSION_DENIED');
      }
    });

    it("should answer another organization's known issue as not existing", async () => {
      const issue = await known('Card payments failing at checkout');

      const response = await call(
        'get',
        `${fx.orgB}/known-issues/${issue.id}`,
        fx.bob,
      );

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('KNOWN_ISSUE_NOT_FOUND');
      expect(
        (
          await call('post', `${fx.orgB}/known-issues`, fx.bob, {
            serviceId: fx.paymentApi,
            name: 'Borrowed',
            usualSeverity: 'SEV3',
          })
        ).body.code,
      ).toBe('SERVICE_NOT_FOUND');
    });
  });

  describe('the list', () => {
    it('should put the most frequent first, counting every incident and naming one still active', async () => {
      const rare = await known('Webhook retries backing up');
      const often = await known('Card payments failing at checkout');

      await known('Never happened yet');
      await declare({ knownIssueId: rare.id });
      for (let n = 0; n < 2; n += 1) {
        await declare({ knownIssueId: often.id });
      }
      await prisma.incident.updateMany({
        where: { organizationId: fx.orgA, number: 2 },
        data: { status: 'RESOLVED', resolvedAt: new Date() },
      });

      const list = await listed();

      expect(list.map(({ name }) => name)).toEqual([
        'Card payments failing at checkout',
        'Webhook retries backing up',
        'Never happened yet',
      ]);
      expect(list[0].occurrences).toEqual({
        total: 2,
        lastAt: expect.any(String),
        active: 3,
      });
      expect(list[2].occurrences).toEqual({
        total: 0,
        lastAt: null,
        active: null,
      });
    });

    it('should narrow to one service, and leave archived ones out unless asked', async () => {
      await known('Portal slow', fx.portal);
      const old = await known('Old problem');

      await call('patch', `${fx.orgA}/known-issues/${old.id}`, fx.alice, {
        archived: true,
      });

      expect(
        (await listed(`?serviceId=${fx.portal}`)).map(({ name }) => name),
      ).toEqual(['Portal slow']);
      expect((await listed()).map(({ name }) => name)).toEqual(['Portal slow']);
      expect(
        (await listed('?archived=include')).find(({ id }) => id === old.id)
          ?.archivedAt,
      ).toEqual(expect.any(String));
    });
  });

  describe('making and changing them', () => {
    it('should refuse a name the service already has, in any case, but allow it on another service', async () => {
      await known('Card payments failing');

      const taken = await call('post', `${fx.orgA}/known-issues`, fx.alice, {
        serviceId: fx.paymentApi,
        name: 'CARD PAYMENTS FAILING',
        usualSeverity: 'SEV1',
      });

      expect(taken.status).toBe(409);
      expect(taken.body.code).toBe('KNOWN_ISSUE_NAME_TAKEN');
      await known('Card payments failing', fx.portal);
    });

    it('should refuse an archived service', async () => {
      await prisma.service.update({
        where: { id: fx.portal },
        data: { archivedAt: new Date() },
      });

      const response = await call('post', `${fx.orgA}/known-issues`, fx.alice, {
        serviceId: fx.portal,
        name: 'Anything',
        usualSeverity: 'SEV3',
      });

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('SERVICE_ARCHIVED');
    });

    it('should count any change, or keeping it as it is, as reviewed', async () => {
      await declare({ title: 'Refunds stuck', saveAsKnownIssue: true });
      const [saved] = await listed();

      expect(saved.pendingReview).toBe(true);

      const kept = await call(
        'patch',
        `${fx.orgA}/known-issues/${saved.id}`,
        fx.alice,
        { reviewed: true },
      );

      expect(kept.status).toBe(200);
      expect(kept.body).toMatchObject({
        name: 'Refunds stuck',
        pendingReview: false,
      });

      const renamed = await call(
        'patch',
        `${fx.orgA}/known-issues/${saved.id}`,
        fx.alice,
        { name: 'Refunds stuck in pending', usualSeverity: 'SEV3' },
      );

      expect(renamed.body).toMatchObject({
        name: 'Refunds stuck in pending',
        usualSeverity: 'SEV3',
      });
    });
  });

  describe('merging', () => {
    it("should move the incidents over, remove the merged one, and keep each incident's title", async () => {
      const keep = await known('Card payments failing at checkout');
      const duplicate = await known('Card payment failures for EU');

      await declare({ knownIssueId: keep.id });
      await declare({ title: 'EU cards failing', knownIssueId: duplicate.id });

      const merged = await call(
        'post',
        `${fx.orgA}/known-issues/${duplicate.id}/merge`,
        fx.alice,
        { intoId: keep.id },
      );

      expect(merged.status).toBe(201);
      expect(merged.body.occurrences.total).toBe(2);
      expect(await prisma.knownIssue.count()).toBe(1);
      expect(
        await prisma.incident.findFirst({
          where: { number: 2 },
          select: { title: true, knownIssueId: true },
        }),
      ).toEqual({ title: 'EU cards failing', knownIssueId: keep.id });
    });

    it("should refuse another service's, and itself", async () => {
      const one = await known('Slow');
      const other = await known('Slow', fx.portal);

      const across = await call(
        'post',
        `${fx.orgA}/known-issues/${one.id}/merge`,
        fx.alice,
        { intoId: other.id },
      );
      const itself = await call(
        'post',
        `${fx.orgA}/known-issues/${one.id}/merge`,
        fx.alice,
        { intoId: one.id },
      );

      expect(across.body.code).toBe('KNOWN_ISSUE_OTHER_SERVICE');
      expect(itself.body.code).toBe('KNOWN_ISSUE_MERGE_INTO_ITSELF');
      expect(await prisma.knownIssue.count()).toBe(2);
    });
  });

  describe('declaring', () => {
    it('should link a chosen known issue, and say so on the incident', async () => {
      const issue = await known('Card payments failing at checkout');

      const declared = await declare({ knownIssueId: issue.id });

      expect(declared.body.knownIssue).toEqual({
        id: issue.id,
        name: 'Card payments failing at checkout',
      });
      expect(
        (await call('get', `${fx.orgA}/incidents/1`, fx.alice)).body.knownIssue,
      ).toEqual({ id: issue.id, name: 'Card payments failing at checkout' });
    });

    it("should refuse another service's known issue as not found, and an archived one", async () => {
      const portals = await known('Portal slow', fx.portal);
      const archived = await known('Old problem');

      await call('patch', `${fx.orgA}/known-issues/${archived.id}`, fx.alice, {
        archived: true,
      });

      expect((await declare({ knownIssueId: portals.id }, 404)).body.code).toBe(
        'KNOWN_ISSUE_NOT_FOUND',
      );
      expect(
        (await declare({ knownIssueId: archived.id }, 409)).body.code,
      ).toBe('KNOWN_ISSUE_ARCHIVED');
      expect(await prisma.incident.count()).toBe(0);
    });

    it('should save something new for next time, pending review, from the declaration', async () => {
      const declared = await declare({
        title: 'Refunds stuck in pending',
        summary: 'EU refunds since 09:00.',
        severity: 'SEV2',
        saveAsKnownIssue: true,
      });

      const saved = await prisma.knownIssue.findFirstOrThrow({
        select: {
          id: true,
          name: true,
          description: true,
          usualSeverity: true,
          pendingReview: true,
          serviceId: true,
        },
      });

      expect(saved).toEqual({
        id: declared.body.knownIssue.id,
        name: 'Refunds stuck in pending',
        description: 'EU refunds since 09:00.',
        usualSeverity: 'SEV2',
        pendingReview: true,
        serviceId: fx.paymentApi,
      });
    });

    it('should link to an existing one of the same name rather than refuse', async () => {
      const issue = await known('Refunds stuck');

      const declared = await declare({
        title: 'REFUNDS STUCK',
        saveAsKnownIssue: true,
      });

      expect(declared.body.knownIssue.id).toBe(issue.id);
      expect(await prisma.knownIssue.count()).toBe(1);
    });

    it('should declare a one-off with neither, and refuse both', async () => {
      const issue = await known('Card payments failing at checkout');

      expect((await declare({})).body.knownIssue).toBeNull();
      expect(
        (
          await declare({ knownIssueId: issue.id, saveAsKnownIssue: true }, 400)
        ).body.details.map((d: { field: string }) => d.field),
      ).toEqual(['saveAsKnownIssue']);
    });

    it("should be held by the database to the incident's own service", async () => {
      const portals = await known('Portal slow', fx.portal);

      await declare({});

      await expect(
        prisma.$executeRaw`
          UPDATE incidents SET known_issue_id = ${portals.id}::uuid
          WHERE number = 1`,
      ).rejects.toThrow();
    });
  });
});
