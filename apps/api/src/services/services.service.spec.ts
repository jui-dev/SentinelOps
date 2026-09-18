import { HttpException } from '@nestjs/common';

import type { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { TeamsErrorCode } from '../teams/teams.errors.js';
import { TenancyErrorCode } from '../tenancy/tenancy.errors.js';
import { ServicesErrorCode } from './services.errors.js';
import { fallbackServiceSlug, ServicesService } from './services.service.js';

const ORG = '0199a1b2-c3d4-7000-8000-00000000000a';
const TEAM = '0199a1b2-c3d4-7000-8000-0000000000c1';
const OTHER_TEAM = '0199a1b2-c3d4-7000-8000-0000000000c2';
const SERVICE = '0199a1b2-c3d4-7000-8000-0000000000d1';
const CREATED = new Date('2026-09-18T12:00:00.000Z');

const serviceRow = {
  id: SERVICE,
  name: 'Payment API',
  slug: 'payment-api',
  description: null,
  criticality: 'NORMAL' as const,
  createdAt: CREATED,
  updatedAt: CREATED,
  ownerTeam: { id: TEAM, name: 'Payments', slug: 'payments' },
};

const knownError = (code: string, index?: string) =>
  new Prisma.PrismaClientKnownRequestError(code, {
    code,
    clientVersion: 'test',
    meta: index
      ? { driverAdapterError: { cause: { constraint: { index } } } }
      : undefined,
  });

/** One mock client, used both directly and as the transaction client. */
const serviceWith = () => {
  const prisma = {
    organization: { findFirst: vi.fn().mockResolvedValue({ id: ORG }) },
    team: { findFirst: vi.fn().mockResolvedValue({ id: TEAM }) },
    service: {
      findMany: vi.fn().mockResolvedValue([serviceRow]),
      findFirst: vi.fn().mockResolvedValue(serviceRow),
      create: vi.fn().mockResolvedValue(serviceRow),
      update: vi.fn().mockResolvedValue(serviceRow),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: vi.fn(),
  };

  prisma.$transaction.mockImplementation((work: (tx: unknown) => unknown) =>
    work(prisma),
  );

  const service = new ServicesService(prisma as unknown as PrismaService);

  return { service, prisma };
};

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

const OWNER_KEY = 'services_organization_id_owner_team_id_fkey';

describe('ServicesService', () => {
  describe('list', () => {
    it('should scope by the organization and order by name, then id', async () => {
      const { service, prisma } = serviceWith();

      await expect(service.list(ORG)).resolves.toEqual([
        expect.objectContaining({
          id: SERVICE,
          ownerTeam: serviceRow.ownerTeam,
        }),
      ]);

      expect(prisma.service.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: ORG, organization: { deletedAt: null } },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        }),
      );
    });
  });

  describe('get', () => {
    it('should look the service up by id and organization together', async () => {
      const { service, prisma } = serviceWith();

      await service.get(ORG, SERVICE);

      expect(prisma.service.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: SERVICE,
            organizationId: ORG,
            organization: { deletedAt: null },
          },
        }),
      );
    });

    it('should answer a malformed id with 404 without querying', async () => {
      const { service, prisma } = serviceWith();

      await expectCode(
        service.get(ORG, 'not-a-uuid'),
        404,
        ServicesErrorCode.SERVICE_NOT_FOUND,
      );
      expect(prisma.service.findFirst).not.toHaveBeenCalled();
    });

    it('should answer a service outside the organization with 404', async () => {
      const { service, prisma } = serviceWith();
      prisma.service.findFirst.mockResolvedValue(null);

      await expectCode(
        service.get(ORG, SERVICE),
        404,
        ServicesErrorCode.SERVICE_NOT_FOUND,
      );
    });
  });

  describe('create', () => {
    it('should look the owner up within the organization and insert scalar ids with a derived slug', async () => {
      const { service, prisma } = serviceWith();

      await service.create(ORG, {
        name: 'Payment API',
        ownerTeamId: TEAM,
        criticality: 'CRITICAL',
      });

      expect(prisma.team.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: TEAM,
            organizationId: ORG,
            organization: { deletedAt: null },
          },
        }),
      );
      expect(prisma.service.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            organizationId: ORG,
            name: 'Payment API',
            slug: 'payment-api',
            description: null,
            ownerTeamId: TEAM,
            criticality: 'CRITICAL',
          },
        }),
      );
    });

    it('should leave an omitted criticality to the database default', async () => {
      const { service, prisma } = serviceWith();

      await service.create(ORG, { name: 'Payment API', ownerTeamId: TEAM });

      expect(prisma.service.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ criticality: undefined }),
        }),
      );
    });

    it('should answer an owner outside the organization with 404 TEAM_NOT_FOUND and insert nothing', async () => {
      const { service, prisma } = serviceWith();
      prisma.team.findFirst.mockResolvedValue(null);

      await expectCode(
        service.create(ORG, { name: 'Payment API', ownerTeamId: TEAM }),
        404,
        TeamsErrorCode.TEAM_NOT_FOUND,
      );
      expect(prisma.service.create).not.toHaveBeenCalled();
    });

    it('should answer the owner key refusing the insert with the same 404', async () => {
      const { service, prisma } = serviceWith();
      prisma.service.create.mockRejectedValue(knownError('P2003', OWNER_KEY));

      await expectCode(
        service.create(ORG, { name: 'Payment API', ownerTeamId: TEAM }),
        404,
        TeamsErrorCode.TEAM_NOT_FOUND,
      );
    });

    it('should give a name with no sluggable characters an opaque slug', async () => {
      const { service, prisma } = serviceWith();

      await service.create(
        ORG,
        { name: '決済サービス', ownerTeamId: TEAM },
        () => 'service-0a1b2c3d',
      );

      expect(prisma.service.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ slug: 'service-0a1b2c3d' }),
        }),
      );
    });

    it('should retry a colliding fallback slug once with a fresh one', async () => {
      const { service, prisma } = serviceWith();
      const slugs = ['service-00000001', 'service-00000002'];
      prisma.service.create.mockRejectedValueOnce(
        knownError('P2002', 'services_organization_id_slug_key'),
      );

      await service.create(ORG, { name: '決済', ownerTeamId: TEAM }, () =>
        slugs.shift()!,
      );

      expect(prisma.service.create).toHaveBeenCalledTimes(2);
      expect(prisma.service.create).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ slug: 'service-00000002' }),
        }),
      );
    });

    it('should never retry a derived slug: a collision means a similar name exists', async () => {
      const { service, prisma } = serviceWith();
      prisma.service.create.mockRejectedValue(
        knownError('P2002', 'services_organization_id_slug_key'),
      );

      await expectCode(
        service.create(ORG, { name: 'payment api!', ownerTeamId: TEAM }),
        409,
        ServicesErrorCode.SERVICE_NAME_TAKEN,
      );
      expect(prisma.service.create).toHaveBeenCalledTimes(1);
    });

    it('should answer an exact name collision with 409', async () => {
      const { service, prisma } = serviceWith();
      prisma.service.create.mockRejectedValue(
        knownError('P2002', 'services_organization_id_name_key'),
      );

      await expectCode(
        service.create(ORG, { name: 'Payment API', ownerTeamId: TEAM }),
        409,
        ServicesErrorCode.SERVICE_NAME_TAKEN,
      );
    });

    it('should rethrow a violation of a constraint it does not know', async () => {
      const { service, prisma } = serviceWith();
      const unknown = knownError('P2003', 'services_organization_id_fkey');
      prisma.service.create.mockRejectedValue(unknown);

      await expect(
        service.create(ORG, { name: 'Payment API', ownerTeamId: TEAM }),
      ).rejects.toBe(unknown);
    });

    it('should refuse to create a service in an organization deleted since admission', async () => {
      const { service, prisma } = serviceWith();
      prisma.organization.findFirst.mockResolvedValue(null);

      await expectCode(
        service.create(ORG, { name: 'Payment API', ownerTeamId: TEAM }),
        404,
        TenancyErrorCode.ORGANIZATION_NOT_FOUND,
      );
      expect(prisma.service.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should update through the (organization, id) compound key, never the slug', async () => {
      const { service, prisma } = serviceWith();

      await service.update(ORG, SERVICE, { name: 'Payments API' });

      expect(prisma.service.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId_id: { organizationId: ORG, id: SERVICE },
            organization: { deletedAt: null },
          },
          data: {
            name: 'Payments API',
            description: undefined,
            ownerTeamId: undefined,
            criticality: undefined,
          },
        }),
      );
      expect(prisma.team.findFirst).not.toHaveBeenCalled();
    });

    it('should look a new owner up within the organization', async () => {
      const { service, prisma } = serviceWith();

      await service.update(ORG, SERVICE, { ownerTeamId: OTHER_TEAM });

      expect(prisma.team.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: OTHER_TEAM,
            organizationId: ORG,
            organization: { deletedAt: null },
          },
        }),
      );
    });

    it('should judge the service before the owner', async () => {
      const { service, prisma } = serviceWith();
      prisma.service.findFirst.mockResolvedValue(null);
      prisma.team.findFirst.mockResolvedValue(null);

      await expectCode(
        service.update(ORG, SERVICE, { ownerTeamId: OTHER_TEAM }),
        404,
        ServicesErrorCode.SERVICE_NOT_FOUND,
      );
      expect(prisma.team.findFirst).not.toHaveBeenCalled();
      expect(prisma.service.update).not.toHaveBeenCalled();
    });

    it('should answer a new owner outside the organization with 404 and change nothing', async () => {
      const { service, prisma } = serviceWith();
      prisma.team.findFirst.mockResolvedValue(null);

      await expectCode(
        service.update(ORG, SERVICE, { ownerTeamId: OTHER_TEAM }),
        404,
        TeamsErrorCode.TEAM_NOT_FOUND,
      );
      expect(prisma.service.update).not.toHaveBeenCalled();
    });

    it('should answer the owner key refusing the update with 404 TEAM_NOT_FOUND', async () => {
      const { service, prisma } = serviceWith();
      prisma.service.update.mockRejectedValue(knownError('P2003', OWNER_KEY));

      await expectCode(
        service.update(ORG, SERVICE, { ownerTeamId: OTHER_TEAM }),
        404,
        TeamsErrorCode.TEAM_NOT_FOUND,
      );
    });

    it('should answer a service gone before the write with 404', async () => {
      const { service, prisma } = serviceWith();
      prisma.service.update.mockRejectedValue(knownError('P2025'));

      await expectCode(
        service.update(ORG, SERVICE, { name: 'Payments API' }),
        404,
        ServicesErrorCode.SERVICE_NOT_FOUND,
      );
    });

    it('should answer a malformed id with 404 without querying', async () => {
      const { service, prisma } = serviceWith();

      await expectCode(
        service.update(ORG, 'nope', { name: 'Payments API' }),
        404,
        ServicesErrorCode.SERVICE_NOT_FOUND,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('should answer a name collision with 409', async () => {
      const { service, prisma } = serviceWith();
      prisma.service.update.mockRejectedValue(
        knownError('P2002', 'services_organization_id_name_key'),
      );

      await expectCode(
        service.update(ORG, SERVICE, { name: 'Checkout' }),
        409,
        ServicesErrorCode.SERVICE_NAME_TAKEN,
      );
    });
  });

  describe('delete', () => {
    it('should delete only within the organization', async () => {
      const { service, prisma } = serviceWith();

      await service.delete(ORG, SERVICE);

      expect(prisma.service.deleteMany).toHaveBeenCalledWith({
        where: {
          id: SERVICE,
          organizationId: ORG,
          organization: { deletedAt: null },
        },
      });
    });

    it('should answer a service it did not delete with 404', async () => {
      const { service, prisma } = serviceWith();
      prisma.service.deleteMany.mockResolvedValue({ count: 0 });

      await expectCode(
        service.delete(ORG, SERVICE),
        404,
        ServicesErrorCode.SERVICE_NOT_FOUND,
      );
    });

    it('should answer a malformed id with 404 without deleting', async () => {
      const { service, prisma } = serviceWith();

      await expectCode(
        service.delete(ORG, 'nope'),
        404,
        ServicesErrorCode.SERVICE_NOT_FOUND,
      );
      expect(prisma.service.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('fallbackServiceSlug', () => {
    it('should produce a service-prefixed opaque slug', () => {
      expect(fallbackServiceSlug()).toMatch(/^service-[0-9a-f]{8}$/);
    });
  });
});
