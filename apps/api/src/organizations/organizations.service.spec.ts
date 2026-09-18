import { NotFoundException } from '@nestjs/common';

import type { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { TenancyErrorCode } from '../tenancy/tenancy.errors.js';
import { OrganizationsErrorCode } from './organizations.errors.js';
import { OrganizationsService } from './organizations.service.js';

const ORG_A = '0199a1b2-c3d4-7000-8000-00000000000a';
const MEMBERSHIP_ID = '0199a1b2-c3d4-7000-8000-0000000000aa';
const CREATED = new Date('2026-09-01T12:00:00.000Z');

const organizationRow = {
  id: ORG_A,
  name: 'Acme Operations',
  slug: 'acme-operations',
  createdAt: CREATED,
};

const membershipRow = {
  id: MEMBERSHIP_ID,
  role: 'ADMIN',
  createdAt: CREATED,
  user: {
    id: '0199a1b2-c3d4-7000-8000-000000000001',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
  },
};

const serviceWith = () => {
  const prisma = {
    organization: { findFirst: vi.fn(), update: vi.fn() },
    membership: { findFirst: vi.fn(), findMany: vi.fn() },
  };
  const service = new OrganizationsService(prisma as unknown as PrismaService);

  return { service, prisma };
};

const errorOf = (promise: Promise<unknown>): Promise<NotFoundException> =>
  promise.then(
    () => {
      throw new Error('Expected a rejection');
    },
    (caught: NotFoundException) => caught,
  );

describe('OrganizationsService', () => {
  describe('getOrganization', () => {
    it('should scope by id and exclude soft-deleted organizations', async () => {
      const { service, prisma } = serviceWith();
      prisma.organization.findFirst.mockResolvedValue(organizationRow);

      await service.getOrganization(ORG_A, {
        membershipId: MEMBERSHIP_ID,
        role: 'ADMIN',
      });

      expect(prisma.organization.findFirst).toHaveBeenCalledExactlyOnceWith({
        where: { id: ORG_A, deletedAt: null },
        select: { id: true, name: true, slug: true, createdAt: true },
      });
    });

    it("should return the organization with the caller's membership", async () => {
      const { service, prisma } = serviceWith();
      prisma.organization.findFirst.mockResolvedValue(organizationRow);

      await expect(
        service.getOrganization(ORG_A, {
          membershipId: MEMBERSHIP_ID,
          role: 'ADMIN',
        }),
      ).resolves.toEqual({
        id: ORG_A,
        name: 'Acme Operations',
        slug: 'acme-operations',
        createdAt: '2026-09-01T12:00:00.000Z',
        membership: {
          id: MEMBERSHIP_ID,
          role: 'ADMIN',
          permissions: [
            'invitations:manage',
            'invitations:read',
            'memberships:read',
            'organization:read',
            'organization:update',
            'teams:manage',
            'teams:read',
          ],
        },
      });
    });

    it('should answer the admission 404 when the organization vanished after admission', async () => {
      const { service, prisma } = serviceWith();
      prisma.organization.findFirst.mockResolvedValue(null);

      const error = await errorOf(
        service.getOrganization(ORG_A, {
          membershipId: MEMBERSHIP_ID,
          role: 'ADMIN',
        }),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.errorCode).toBe(TenancyErrorCode.ORGANIZATION_NOT_FOUND);
    });
  });

  describe('updateOrganization', () => {
    const knownError = (code: string) =>
      new Prisma.PrismaClientKnownRequestError('Prisma failure', {
        code,
        clientVersion: 'test',
      });

    it('should update by id with soft-deleted organizations excluded, in one statement', async () => {
      const { service, prisma } = serviceWith();
      prisma.organization.update.mockResolvedValue(organizationRow);

      await service.updateOrganization(ORG_A, { name: 'Renamed' });

      expect(prisma.organization.update).toHaveBeenCalledExactlyOnceWith({
        where: { id: ORG_A, deletedAt: null },
        data: { name: 'Renamed' },
        select: { id: true, name: true, slug: true, createdAt: true },
      });
      expect(prisma.organization.findFirst).not.toHaveBeenCalled();
    });

    it('should write the name and nothing else, whatever the input carries', async () => {
      // The strict body schema already refuses extra keys; the service does
      // not rely on that.
      const { service, prisma } = serviceWith();
      prisma.organization.update.mockResolvedValue(organizationRow);

      await service.updateOrganization(ORG_A, {
        name: 'Renamed',
        slug: 'hijacked',
        deletedAt: null,
      } as unknown as { name: string });

      const [args] = prisma.organization.update.mock.calls[0];

      expect(args.data).toEqual({ name: 'Renamed' });
    });

    it('should take the organization and the input, and no caller', () => {
      expect(OrganizationsService.prototype.updateOrganization).toHaveLength(2);
    });

    it('should return the updated organization', async () => {
      const { service, prisma } = serviceWith();
      prisma.organization.update.mockResolvedValue({
        ...organizationRow,
        name: 'Renamed',
      });

      await expect(
        service.updateOrganization(ORG_A, { name: 'Renamed' }),
      ).resolves.toEqual({
        id: ORG_A,
        name: 'Renamed',
        slug: 'acme-operations',
        createdAt: '2026-09-01T12:00:00.000Z',
      });
    });

    it('should answer the admission 404 when no live organization matched', async () => {
      const { service, prisma } = serviceWith();
      prisma.organization.update.mockRejectedValue(knownError('P2025'));

      const error = await errorOf(
        service.updateOrganization(ORG_A, { name: 'Renamed' }),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.errorCode).toBe(TenancyErrorCode.ORGANIZATION_NOT_FOUND);
      expect(JSON.stringify(error.getResponse())).not.toContain(ORG_A);
    });

    it.each([
      ['a different known Prisma error', knownError('P2002')],
      ['an unexpected error', new Error('connection reset')],
    ])('should rethrow %s unchanged', async (_label, thrown) => {
      const { service, prisma } = serviceWith();
      prisma.organization.update.mockRejectedValue(thrown);

      await expect(
        service.updateOrganization(ORG_A, { name: 'Renamed' }),
      ).rejects.toBe(thrown);
    });
  });

  describe('listMemberships', () => {
    it('should scope by organization and exclude soft-deleted parents', async () => {
      const { service, prisma } = serviceWith();
      prisma.membership.findMany.mockResolvedValue([]);

      await service.listMemberships(ORG_A);

      const [args] = prisma.membership.findMany.mock.calls[0];

      expect(args.where).toEqual({
        organizationId: ORG_A,
        organization: { deletedAt: null },
        user: { deletedAt: null },
      });
      expect(args.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
    });

    it("should never select a member's other memberships", async () => {
      const { service, prisma } = serviceWith();
      prisma.membership.findMany.mockResolvedValue([]);

      await service.listMemberships(ORG_A);

      const [args] = prisma.membership.findMany.mock.calls[0];

      expect(args.select).toEqual({
        id: true,
        role: true,
        createdAt: true,
        user: { select: { id: true, name: true, email: true } },
      });
    });

    it('should map each row to a membership response', async () => {
      const { service, prisma } = serviceWith();
      prisma.membership.findMany.mockResolvedValue([membershipRow]);

      await expect(service.listMemberships(ORG_A)).resolves.toEqual([
        {
          id: MEMBERSHIP_ID,
          role: 'ADMIN',
          createdAt: '2026-09-01T12:00:00.000Z',
          user: membershipRow.user,
        },
      ]);
    });
  });

  describe('getMembership', () => {
    it('should look the membership up by id and organization together', async () => {
      // The resource-isolation pattern: the organization is part of the
      // predicate, not a check applied to a row fetched by id alone.
      const { service, prisma } = serviceWith();
      prisma.membership.findFirst.mockResolvedValue(membershipRow);

      await service.getMembership(ORG_A, MEMBERSHIP_ID);

      const [args] = prisma.membership.findFirst.mock.calls[0];

      expect(args.where).toEqual({
        id: MEMBERSHIP_ID,
        organizationId: ORG_A,
        organization: { deletedAt: null },
        user: { deletedAt: null },
      });
    });

    it('should answer 404 when no membership matches within the organization', async () => {
      const { service, prisma } = serviceWith();
      prisma.membership.findFirst.mockResolvedValue(null);

      const error = await errorOf(service.getMembership(ORG_A, MEMBERSHIP_ID));

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.errorCode).toBe(OrganizationsErrorCode.MEMBERSHIP_NOT_FOUND);
      expect(JSON.stringify(error.getResponse())).not.toContain(MEMBERSHIP_ID);
    });

    it.each(['not-a-uuid', `${MEMBERSHIP_ID}x`, "' OR 1=1 --"])(
      'should answer 404 without querying for the malformed id %j',
      async (membershipId) => {
        const { service, prisma } = serviceWith();

        const error = await errorOf(service.getMembership(ORG_A, membershipId));

        expect(error.errorCode).toBe(
          OrganizationsErrorCode.MEMBERSHIP_NOT_FOUND,
        );
        expect(prisma.membership.findFirst).not.toHaveBeenCalled();
      },
    );
  });
});
