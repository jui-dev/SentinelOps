import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from './../src/app.module.js';
import { TokenService } from './../src/auth/token.service.js';
import { PrismaService } from './../src/database/prisma.service.js';
import type { Role } from './../src/generated/prisma/enums.js';

/**
 * Notification routes wired through the real AppModule, with Prisma mocked.
 *
 * Proves the wiring: every route is admitted and authorized for both roles,
 * refuses a caller still on a one-time password, validates before it reads,
 * and takes the recipient from admission alone — a recipient named anywhere
 * in the request is never used. Behaviour against real rows and tenant
 * isolation are proven in notifications.integration-spec.ts.
 */
const USER_ID = '0199a1b2-c3d4-7000-8000-000000000001';
const ORG_ID = '0199a1b2-c3d4-7000-8000-00000000000a';
const OTHER_ORG_ID = '0199a1b2-c3d4-7000-8000-00000000000b';
const MEMBERSHIP_ID = '0199a1b2-c3d4-7000-8000-0000000000aa';
const SOMEONE_ELSE = '0199a1b2-c3d4-7000-8000-0000000000bb';
const NOTIFICATION_ID = '0199a1b2-c3d4-7000-8000-0000000000e1';
const CREATED = new Date('2026-09-18T12:00:00.000Z');

const notificationRow = {
  id: NOTIFICATION_ID,
  type: 'TEAM_MEMBERSHIP_ADDED',
  createdAt: CREATED,
  readAt: null,
  actor: { id: USER_ID, name: 'Ada' },
  activity: null,
  team: { id: '0199a1b2-c3d4-7000-8000-0000000000c1', name: 'Payments' },
};

const base = (organizationId = ORG_ID) =>
  `/api/v1/organizations/${organizationId}/notifications`;

/** Every route, each with a request that would otherwise succeed. */
const ROUTES = (organizationId = ORG_ID) =>
  [
    { method: 'get', path: base(organizationId) },
    { method: 'get', path: `${base(organizationId)}/unread-count` },
    {
      method: 'post',
      path: `${base(organizationId)}/${NOTIFICATION_ID}/read`,
    },
    {
      method: 'post',
      path: `${base(organizationId)}/read`,
      body: { through: NOTIFICATION_ID },
    },
  ] as const;

describe('Notifications (e2e)', () => {
  let app: INestApplication;
  let tokens: TokenService;

  const prisma = {
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
    membership: { findFirst: vi.fn() },
    notification: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
    },
  };

  /** Admission resolves the caller as `role` in ORG_ID, and nowhere else. */
  const admitAs = (role: Role, passwordChangeRequired = false) =>
    prisma.membership.findFirst.mockImplementation(
      (args: { where: { organizationId: string } }) =>
        args.where.organizationId === ORG_ID
          ? {
              id: MEMBERSHIP_ID,
              organizationId: ORG_ID,
              role,
              user: { passwordChangeRequired },
            }
          : null,
    );

  /** Sends `route` as the caller and asserts the status it answers with. */
  const send = async (
    route: { method: 'get' | 'post'; path: string; body?: object },
    status: number,
  ) => {
    const pending = request(app.getHttpServer())
      [route.method](route.path)
      .set('Authorization', `Bearer ${await tokens.signAccessToken(USER_ID)}`);
    const response = await (route.body === undefined
      ? pending
      : pending.send(route.body));

    expect(response.status).toBe(status);

    return response;
  };

  const noNotificationQueries = () => {
    for (const method of Object.values(prisma.notification)) {
      expect(method).not.toHaveBeenCalled();
    }
  };

  /** Every where clause a notification query was given. */
  const everyWhere = () =>
    Object.values(prisma.notification).flatMap((method) =>
      method.mock.calls.map(
        ([args]) => (args as { where: Record<string, unknown> }).where,
      ),
    );

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('/api/v1');
    await app.init();

    tokens = app.get(TokenService);

    prisma.$transaction.mockImplementation((work: (tx: unknown) => unknown) =>
      work(prisma),
    );
    prisma.membership.findFirst.mockResolvedValue(null);
    prisma.notification.findMany.mockResolvedValue([notificationRow]);
    prisma.notification.findFirst.mockResolvedValue(notificationRow);
    prisma.notification.count.mockResolvedValue(2);
    prisma.notification.updateMany.mockResolvedValue({ count: 1 });
  });

  afterEach(async () => {
    await app.close();
    vi.resetAllMocks();
  });

  describe.each(['ADMIN', 'RESPONDER'] as const)('as %s', (role) => {
    beforeEach(() => admitAs(role));

    it('should list the caller’s notifications in the page envelope', async () => {
      const response = await send(ROUTES()[0], 200);

      expect(response.body).toEqual({
        items: [
          {
            id: NOTIFICATION_ID,
            type: 'TEAM_MEMBERSHIP_ADDED',
            createdAt: '2026-09-18T12:00:00.000Z',
            readAt: null,
            actor: { id: USER_ID, name: 'Ada' },
            incident: null,
            change: null,
            team: {
              id: '0199a1b2-c3d4-7000-8000-0000000000c1',
              name: 'Payments',
            },
          },
        ],
        page: { cursor: null, hasMore: false },
      });
    });

    it('should count the caller’s unread notifications', async () => {
      const response = await send(ROUTES()[1], 200);

      expect(response.body).toEqual({ count: 2 });
    });

    it('should acknowledge one notification with 200 and return it', async () => {
      const response = await send(ROUTES()[2], 200);

      expect(response.body.id).toBe(NOTIFICATION_ID);
    });

    it('should acknowledge through a notification with 200 and the unread left', async () => {
      const response = await send(ROUTES()[3], 200);

      expect(response.body).toEqual({ count: 2 });
    });
  });

  describe('the recipient', () => {
    beforeEach(() => admitAs('RESPONDER'));

    it('should be the admitted membership on every route, whatever the request names', async () => {
      const elsewhere = `recipientMembershipId=${SOMEONE_ELSE}&membershipId=${SOMEONE_ELSE}`;

      await send({ method: 'get', path: `${base()}?${elsewhere}` }, 200);
      await send(
        {
          method: 'get',
          path: `${base()}/unread-count?${elsewhere}`,
        },
        200,
      );
      await send(
        {
          method: 'post',
          path: `${base()}/${NOTIFICATION_ID}/read?${elsewhere}`,
        },
        200,
      );
      await send(
        {
          method: 'post',
          path: `${base()}/read?${elsewhere}`,
          body: { through: NOTIFICATION_ID },
        },
        200,
      );

      const wheres = everyWhere();

      expect(wheres.length).toBeGreaterThanOrEqual(6);
      for (const where of wheres) {
        expect(where).toEqual(
          expect.objectContaining({
            organizationId: ORG_ID,
            recipientMembershipId: MEMBERSHIP_ID,
          }),
        );
      }
    });

    it('should refuse a recipient in the read-through body with 400, reading nothing', async () => {
      const response = await send(
        {
          method: 'post',
          path: `${base()}/read`,
          body: {
            through: NOTIFICATION_ID,
            recipientMembershipId: SOMEONE_ELSE,
          },
        },
        400,
      );

      expect(response.body.details).toEqual(
        expect.arrayContaining([expect.objectContaining({ field: '' })]),
      );
      noNotificationQueries();
    });
  });

  describe('validation', () => {
    beforeEach(() => admitAs('RESPONDER'));

    it.each([
      ['no bound', {}],
      ['a malformed bound', { through: 'latest' }],
    ])(
      'should refuse read-through with %s as 400, reading nothing',
      async (_case, body) => {
        await send({ method: 'post', path: `${base()}/read`, body }, 400);
        noNotificationQueries();
      },
    );

    it('should refuse a malformed cursor with 400 INVALID_CURSOR, reading nothing', async () => {
      const response = await send(
        {
          method: 'get',
          path: `${base()}?cursor=page-2`,
        },
        400,
      );

      expect(response.body.code).toBe('INVALID_CURSOR');
      noNotificationQueries();
    });

    it('should answer a malformed notification id with 404 NOTIFICATION_NOT_FOUND, reading nothing', async () => {
      const response = await send(
        {
          method: 'post',
          path: `${base()}/not-a-uuid/read`,
        },
        404,
      );

      expect(response.body.code).toBe('NOTIFICATION_NOT_FOUND');
      noNotificationQueries();
    });
  });

  describe('admission', () => {
    it.each(
      ROUTES(OTHER_ORG_ID).map((route) => [route.method, route.path, route]),
    )(
      'should refuse a non-member %s %s with 404, reading nothing',
      async (_method, _path, route) => {
        admitAs('ADMIN');

        const response = await send(route, 404);

        expect(response.body.code).toBe('ORGANIZATION_NOT_FOUND');
        noNotificationQueries();
      },
    );

    it.each(ROUTES().map((route) => [route.method, route.path, route]))(
      'should refuse %s %s with 403 while the password must be changed',
      async (_method, _path, route) => {
        admitAs('RESPONDER', true);

        const response = await send(route, 403);

        expect(response.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
        noNotificationQueries();
      },
    );
  });
});
