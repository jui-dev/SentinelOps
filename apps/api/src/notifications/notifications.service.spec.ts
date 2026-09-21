import { HttpException } from '@nestjs/common';

import type { PrismaService } from '../database/prisma.service.js';
import { NotificationsErrorCode } from './notifications.errors.js';
import {
  NOTIFICATION_PAGE_SIZE,
  NotificationsService,
} from './notifications.service.js';

const ORG = '0199a1b2-c3d4-7000-8000-00000000000a';
const RECIPIENT = '0199a1b2-c3d4-7000-8000-0000000000b1';
const NOTIFICATION = '0199a1b2-c3d4-7000-8000-0000000000e1';
const CREATED = new Date('2026-09-18T12:00:00.000Z');

/** The scope every query must carry: this organization, this recipient. */
const OWN = {
  organizationId: ORG,
  recipientMembershipId: RECIPIENT,
  organization: { deletedAt: null },
};

const row = (id: string, createdAt = CREATED) => ({
  id,
  type: 'TEAM_MEMBERSHIP_ADDED' as const,
  createdAt,
  readAt: null,
  actor: { id: 'user-1', name: 'Ada' },
  activity: null,
  team: { id: 'team-1', name: 'Payments' },
});

/** Numbered ids that sort as the numbers do. */
const idOf = (n: number) =>
  `0199a1b2-c3d4-7000-8000-${String(n).padStart(12, '0')}`;

const expectCode = async (
  promise: Promise<unknown>,
  status: number,
  code: string,
) => {
  const caught = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );

  expect(caught).toBeInstanceOf(HttpException);
  expect((caught as HttpException).getStatus()).toBe(status);
  expect((caught as HttpException).errorCode).toBe(code);
};

/** One mock client, used both directly and as the transaction client. */
const serviceWith = () => {
  const prisma = {
    notification: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(row(NOTIFICATION)),
      count: vi.fn().mockResolvedValue(0),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: vi.fn(),
  };

  prisma.$transaction.mockImplementation((work: (tx: unknown) => unknown) =>
    work(prisma),
  );

  const service = new NotificationsService(prisma as unknown as PrismaService);

  return { service, prisma };
};

/** Every where clause any notification query was given. */
const everyWhere = (prisma: ReturnType<typeof serviceWith>['prisma']) =>
  Object.values(prisma.notification).flatMap((method) =>
    method.mock.calls.map(
      ([args]) => (args as { where: Record<string, unknown> }).where,
    ),
  );

describe('NotificationsService', () => {
  describe('list', () => {
    it('should read only the recipient’s own, newest first, one more than a page', async () => {
      const { service, prisma } = serviceWith();

      await service.list(ORG, RECIPIENT, {});

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: OWN,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: NOTIFICATION_PAGE_SIZE + 1,
        }),
      );
    });

    it('should issue a cursor at the last item when there is more', async () => {
      const { service, prisma } = serviceWith();
      const rows = Array.from({ length: NOTIFICATION_PAGE_SIZE + 1 }, (_, i) =>
        row(idOf(100 - i)),
      );
      prisma.notification.findMany.mockResolvedValue(rows);

      const page = await service.list(ORG, RECIPIENT, {});

      expect(page.items).toHaveLength(NOTIFICATION_PAGE_SIZE);
      expect(page.page).toEqual({
        cursor: `${CREATED.toISOString()}~${idOf(100 - NOTIFICATION_PAGE_SIZE + 1)}`,
        hasMore: true,
      });
    });

    it('should issue no cursor on the last page', async () => {
      const { service, prisma } = serviceWith();
      prisma.notification.findMany.mockResolvedValue([row(NOTIFICATION)]);

      expect((await service.list(ORG, RECIPIENT, {})).page).toEqual({
        cursor: null,
        hasMore: false,
      });
    });

    it('should continue strictly past the cursor, still within the recipient’s own', async () => {
      const { service, prisma } = serviceWith();

      await service.list(ORG, RECIPIENT, {
        cursor: `${CREATED.toISOString()}~${NOTIFICATION}`,
      });

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            ...OWN,
            OR: [
              { createdAt: { lt: CREATED } },
              { createdAt: CREATED, id: { lt: NOTIFICATION } },
            ],
          },
        }),
      );
    });

    it('should refuse a malformed cursor with 400 before reading anything', async () => {
      const { service, prisma } = serviceWith();

      await expectCode(
        service.list(ORG, RECIPIENT, { cursor: 'page-2' }),
        400,
        NotificationsErrorCode.INVALID_CURSOR,
      );
      expect(prisma.notification.findMany).not.toHaveBeenCalled();
    });
  });

  describe('unreadCount', () => {
    it('should count only the recipient’s own unread', async () => {
      const { service, prisma } = serviceWith();
      prisma.notification.count.mockResolvedValue(3);

      expect(await service.unreadCount(ORG, RECIPIENT)).toEqual({ count: 3 });
      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: { ...OWN, readAt: null },
      });
    });
  });

  describe('markRead', () => {
    it('should write readAt only while it is unread, and return the notification', async () => {
      const { service, prisma } = serviceWith();

      const response = await service.markRead(ORG, RECIPIENT, NOTIFICATION);

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { id: NOTIFICATION, ...OWN, readAt: null },
        data: { readAt: expect.any(Date) },
      });
      expect(prisma.notification.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: NOTIFICATION, ...OWN } }),
      );
      expect(response.id).toBe(NOTIFICATION);
    });

    it('should answer 200 when it was already read, changing nothing', async () => {
      const { service, prisma } = serviceWith();
      prisma.notification.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.markRead(ORG, RECIPIENT, NOTIFICATION),
      ).resolves.toEqual(expect.objectContaining({ id: NOTIFICATION }));
    });

    it('should answer 404 for one that is not the recipient’s to see', async () => {
      const { service, prisma } = serviceWith();
      prisma.notification.updateMany.mockResolvedValue({ count: 0 });
      prisma.notification.findFirst.mockResolvedValue(null);

      await expectCode(
        service.markRead(ORG, RECIPIENT, NOTIFICATION),
        404,
        NotificationsErrorCode.NOTIFICATION_NOT_FOUND,
      );
    });

    it('should answer a malformed id with the same 404, without a query', async () => {
      const { service, prisma } = serviceWith();

      await expectCode(
        service.markRead(ORG, RECIPIENT, 'not-a-uuid'),
        404,
        NotificationsErrorCode.NOTIFICATION_NOT_FOUND,
      );
      expect(prisma.notification.updateMany).not.toHaveBeenCalled();
      expect(prisma.notification.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('markReadThrough', () => {
    it('should resolve the bound among the recipient’s own, read up to it, and count what remains', async () => {
      const { service, prisma } = serviceWith();
      prisma.notification.findFirst.mockResolvedValue({
        id: NOTIFICATION,
        createdAt: CREATED,
      });
      prisma.notification.updateMany.mockResolvedValue({ count: 4 });
      prisma.notification.count.mockResolvedValue(2);

      expect(
        await service.markReadThrough(ORG, RECIPIENT, NOTIFICATION),
      ).toEqual({ count: 2 });
      expect(prisma.notification.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: NOTIFICATION, ...OWN } }),
      );
      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: {
          ...OWN,
          readAt: null,
          OR: [
            { createdAt: { lt: CREATED } },
            { createdAt: CREATED, id: { lte: NOTIFICATION } },
          ],
        },
        data: { readAt: expect.any(Date) },
      });
      expect(prisma.notification.count).toHaveBeenCalledWith({
        where: { ...OWN, readAt: null },
      });
    });

    it('should answer 404 for a bound that is not the recipient’s, reading nothing', async () => {
      const { service, prisma } = serviceWith();
      prisma.notification.findFirst.mockResolvedValue(null);

      await expectCode(
        service.markReadThrough(ORG, RECIPIENT, NOTIFICATION),
        404,
        NotificationsErrorCode.NOTIFICATION_NOT_FOUND,
      );
      expect(prisma.notification.updateMany).not.toHaveBeenCalled();
    });
  });

  it('should scope every query it makes by the organization and the recipient', async () => {
    const { service, prisma } = serviceWith();
    prisma.notification.findFirst.mockImplementation(
      (args: { where: { id: string } }) => ({
        ...row(args.where.id),
        createdAt: CREATED,
      }),
    );

    await service.list(ORG, RECIPIENT, {
      cursor: `${CREATED.toISOString()}~${NOTIFICATION}`,
    });
    await service.unreadCount(ORG, RECIPIENT);
    await service.markRead(ORG, RECIPIENT, NOTIFICATION);
    await service.markReadThrough(ORG, RECIPIENT, NOTIFICATION);

    const wheres = everyWhere(prisma);

    expect(wheres.length).toBeGreaterThanOrEqual(6);
    for (const where of wheres) {
      expect(where).toEqual(expect.objectContaining(OWN));
    }
  });
});
