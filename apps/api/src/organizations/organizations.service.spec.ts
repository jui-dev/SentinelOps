import { ConflictException, Logger, NotFoundException } from '@nestjs/common';

import { AuthErrorCode } from '../auth/auth.errors.js';
import type { PasswordService } from '../auth/password.service.js';

import type { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { TeamsErrorCode } from '../teams/teams.errors.js';
import { TenancyErrorCode } from '../tenancy/tenancy.errors.js';
import { OrganizationsErrorCode } from './organizations.errors.js';
import { OrganizationsService } from './organizations.service.js';

const ORG_A = '0199a1b2-c3d4-7000-8000-00000000000a';
const MEMBERSHIP_ID = '0199a1b2-c3d4-7000-8000-0000000000aa';
const ADMIN_READER = { membershipId: MEMBERSHIP_ID, role: 'ADMIN' as const };
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
    passwordChangeRequired: false,
  },
  teamMemberships: [
    {
      team: {
        id: '0199a1b2-c3d4-7000-8000-0000000000d1',
        name: 'Payments',
        slug: 'payments',
      },
    },
  ],
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
    organization: { findFirst: vi.fn(), update: vi.fn() },
    user: { create: vi.fn() },
    membership: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    team: { findMany: vi.fn() },
    teamMembership: { createMany: vi.fn() },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation((work: (tx: unknown) => unknown) =>
    work(prisma),
  );
  const passwords = { hash: vi.fn().mockResolvedValue('$argon2id$hashed') };
  const service = new OrganizationsService(
    prisma as unknown as PrismaService,
    passwords as unknown as PasswordService,
  );

  return { service, prisma, passwords };
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
            'incident-analyses:write',
            'incidents:manage',
            'incidents:read',
            'incidents:read-all',
            'incidents:respond',
            'invitations:manage',
            'invitations:read',
            'members:manage',
            'memberships:read',
            'memberships:read-all',
            'notifications:read',
            'organization:read',
            'organization:update',
            'services:manage',
            'services:read',
            'teams:manage',
            'teams:read',
            'teams:read-all',
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

      await service.listMemberships(ORG_A, ADMIN_READER);

      const [args] = prisma.membership.findMany.mock.calls[0];

      expect(args.where).toEqual({
        organizationId: ORG_A,
        organization: { deletedAt: null },
        user: { deletedAt: null },
      });
      expect(args.orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
    });

    it("should never select a member's other memberships, and select each team as identity only, by name", async () => {
      const { service, prisma } = serviceWith();
      prisma.membership.findMany.mockResolvedValue([]);

      await service.listMemberships(ORG_A, ADMIN_READER);

      const [args] = prisma.membership.findMany.mock.calls[0];

      expect(args.select).toEqual({
        id: true,
        role: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            passwordChangeRequired: true,
          },
        },
        teamMemberships: {
          select: { team: { select: { id: true, name: true, slug: true } } },
          orderBy: { team: { name: 'asc' } },
        },
      });
    });

    it('should map each row to a membership response', async () => {
      const { service, prisma } = serviceWith();
      prisma.membership.findMany.mockResolvedValue([membershipRow]);

      await expect(
        service.listMemberships(ORG_A, ADMIN_READER),
      ).resolves.toEqual([
        {
          id: MEMBERSHIP_ID,
          role: 'ADMIN',
          createdAt: '2026-09-01T12:00:00.000Z',
          user: membershipRow.user,
          teams: [
            {
              id: '0199a1b2-c3d4-7000-8000-0000000000d1',
              name: 'Payments',
              slug: 'payments',
            },
          ],
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

      await service.getMembership(ORG_A, MEMBERSHIP_ID, ADMIN_READER);

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

      const error = await errorOf(
        service.getMembership(ORG_A, MEMBERSHIP_ID, ADMIN_READER),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.errorCode).toBe(OrganizationsErrorCode.MEMBERSHIP_NOT_FOUND);
      expect(JSON.stringify(error.getResponse())).not.toContain(MEMBERSHIP_ID);
    });

    it.each(['not-a-uuid', `${MEMBERSHIP_ID}x`, "' OR 1=1 --"])(
      'should answer 404 without querying for the malformed id %j',
      async (membershipId) => {
        const { service, prisma } = serviceWith();

        const error = await errorOf(
          service.getMembership(ORG_A, membershipId, ADMIN_READER),
        );

        expect(error.errorCode).toBe(
          OrganizationsErrorCode.MEMBERSHIP_NOT_FOUND,
        );
        expect(prisma.membership.findFirst).not.toHaveBeenCalled();
      },
    );
  });

  describe('createMember', () => {
    const input = {
      name: 'Grace Hopper',
      email: 'grace@example.com',
      temporaryPassword: 'one-time-password-123',
    };

    const newMembershipRow = {
      id: MEMBERSHIP_ID,
      role: 'MEMBER',
      createdAt: CREATED,
      user: {
        id: '0199a1b2-c3d4-7000-8000-000000000002',
        name: 'Grace Hopper',
        email: 'grace@example.com',
        passwordChangeRequired: true,
      },
      teamMemberships: [],
    };

    const ready = () => {
      const context = serviceWith();
      context.prisma.organization.findFirst.mockResolvedValue({ id: ORG_A });
      context.prisma.user.create.mockResolvedValue({
        id: newMembershipRow.user.id,
      });
      context.prisma.membership.create.mockResolvedValue({ id: MEMBERSHIP_ID });
      context.prisma.membership.findUniqueOrThrow.mockResolvedValue(
        newMembershipRow,
      );

      return context;
    };

    const PAYMENTS = '0199a1b2-c3d4-7000-8000-0000000000d1';
    const PLATFORM = '0199a1b2-c3d4-7000-8000-0000000000d2';

    it('should hash the one-time password before the transaction opens', async () => {
      const { service, prisma, passwords } = ready();

      await service.createMember(ORG_A, input);

      expect(passwords.hash).toHaveBeenCalledExactlyOnceWith(
        input.temporaryPassword,
      );
      expect(passwords.hash.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.$transaction.mock.invocationCallOrder[0],
      );
    });

    it('should create the account flagged for a password change, and never store the plain password', async () => {
      const { service, prisma } = ready();

      await service.createMember(ORG_A, input);

      expect(prisma.user.create).toHaveBeenCalledExactlyOnceWith({
        data: {
          email: 'grace@example.com',
          name: 'Grace Hopper',
          passwordHash: '$argon2id$hashed',
          passwordChangeRequired: true,
        },
        select: { id: true },
      });
      expect(JSON.stringify(prisma.user.create.mock.calls)).not.toContain(
        input.temporaryPassword,
      );
    });

    it('should place the account in the admitted organization, always as a MEMBER', async () => {
      const { service, prisma } = ready();

      await service.createMember(ORG_A, input);

      expect(prisma.membership.create).toHaveBeenCalledExactlyOnceWith({
        data: {
          organizationId: ORG_A,
          userId: newMembershipRow.user.id,
          role: 'MEMBER',
        },
        select: { id: true },
      });
    });

    it('should touch no team when none is asked for, and read the membership back whole', async () => {
      const { service, prisma } = ready();

      await service.createMember(ORG_A, { ...input, teamIds: [] });

      expect(prisma.team.findMany).not.toHaveBeenCalled();
      expect(prisma.teamMembership.createMany).not.toHaveBeenCalled();
      expect(
        prisma.membership.findUniqueOrThrow,
      ).toHaveBeenCalledExactlyOnceWith({
        where: { id: MEMBERSHIP_ID },
        select: expect.objectContaining({
          teamMemberships: expect.any(Object),
        }),
      });
    });

    it('should look the teams up within the organization, then place the member on each', async () => {
      const { service, prisma } = ready();
      prisma.team.findMany.mockResolvedValue([
        { id: PAYMENTS },
        { id: PLATFORM },
      ]);

      await service.createMember(ORG_A, {
        ...input,
        teamIds: [PAYMENTS, PLATFORM],
      });

      expect(prisma.team.findMany).toHaveBeenCalledExactlyOnceWith({
        where: { organizationId: ORG_A, id: { in: [PAYMENTS, PLATFORM] } },
        select: { id: true },
      });
      expect(prisma.teamMembership.createMany).toHaveBeenCalledExactlyOnceWith({
        data: [
          {
            organizationId: ORG_A,
            teamId: PAYMENTS,
            membershipId: MEMBERSHIP_ID,
          },
          {
            organizationId: ORG_A,
            teamId: PLATFORM,
            membershipId: MEMBERSHIP_ID,
          },
        ],
      });
      expect(
        prisma.teamMembership.createMany.mock.invocationCallOrder[0],
      ).toBeLessThan(
        prisma.membership.findUniqueOrThrow.mock.invocationCallOrder[0],
      );
    });

    it('should answer 404 TEAM_NOT_FOUND, placing no one, when a team is not in the organization', async () => {
      const { service, prisma } = ready();
      // Only one of the two was found within ORG_A.
      prisma.team.findMany.mockResolvedValue([{ id: PAYMENTS }]);

      const error = await errorOf(
        service.createMember(ORG_A, {
          ...input,
          teamIds: [PAYMENTS, PLATFORM],
        }),
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect(error.errorCode).toBe(TeamsErrorCode.TEAM_NOT_FOUND);
      expect(prisma.teamMembership.createMany).not.toHaveBeenCalled();
    });

    it('should answer 404 TEAM_NOT_FOUND when a team key refuses the placement', async () => {
      // A team deleted between the lookup and the insert.
      const { service, prisma } = ready();
      prisma.team.findMany.mockResolvedValue([{ id: PAYMENTS }]);
      prisma.teamMembership.createMany.mockRejectedValue(
        knownError('P2003', 'team_memberships_organization_id_team_id_fkey'),
      );

      const error = await errorOf(
        service.createMember(ORG_A, { ...input, teamIds: [PAYMENTS] }),
      );

      expect(error.errorCode).toBe(TeamsErrorCode.TEAM_NOT_FOUND);
    });

    it('should answer with the membership as the list shows one, and no password', async () => {
      const { service } = ready();

      const response = await service.createMember(ORG_A, input);

      expect(response).toEqual({
        id: MEMBERSHIP_ID,
        role: 'MEMBER',
        createdAt: '2026-09-01T12:00:00.000Z',
        user: newMembershipRow.user,
        teams: [],
      });
      expect(JSON.stringify(response)).not.toContain(input.temporaryPassword);
    });

    it('should answer with the teams the member was placed on', async () => {
      const { service, prisma } = ready();
      prisma.team.findMany.mockResolvedValue([{ id: PAYMENTS }]);
      prisma.membership.findUniqueOrThrow.mockResolvedValue({
        ...newMembershipRow,
        teamMemberships: [
          { team: { id: PAYMENTS, name: 'Payments', slug: 'payments' } },
        ],
      });

      const response = await service.createMember(ORG_A, {
        ...input,
        teamIds: [PAYMENTS],
      });

      expect(response.teams).toEqual([
        { id: PAYMENTS, name: 'Payments', slug: 'payments' },
      ]);
      expect(JSON.stringify(response)).not.toContain(input.temporaryPassword);
    });

    it('should answer the admission 404 and create nothing when the organization vanished after admission', async () => {
      const { service, prisma } = ready();
      prisma.organization.findFirst.mockResolvedValue(null);

      const error = await errorOf(service.createMember(ORG_A, input));

      expect(error.errorCode).toBe(TenancyErrorCode.ORGANIZATION_NOT_FOUND);
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.membership.create).not.toHaveBeenCalled();
    });

    it('should answer 409 EMAIL_ALREADY_REGISTERED when the email already has an account', async () => {
      const { service, prisma } = ready();
      prisma.user.create.mockRejectedValue(
        knownError('P2002', 'users_email_key'),
      );

      const error = await service
        .createMember(ORG_A, input)
        .catch((caught: ConflictException) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).errorCode).toBe(
        AuthErrorCode.EMAIL_ALREADY_REGISTERED,
      );
      expect(prisma.membership.create).not.toHaveBeenCalled();
    });

    it('should rethrow anything that is not an email conflict', async () => {
      const { service, prisma } = ready();
      const fault = new Error('connection lost');
      prisma.membership.create.mockRejectedValue(fault);

      await expect(service.createMember(ORG_A, input)).rejects.toBe(fault);
    });

    it('should never log the password or the email', async () => {
      const log = vi
        .spyOn(Logger.prototype, 'log')
        .mockImplementation(() => {});
      const { service } = ready();

      await service.createMember(ORG_A, input);

      const logged = JSON.stringify(log.mock.calls);
      expect(logged).not.toContain(input.temporaryPassword);
      expect(logged).not.toContain(input.email);
      log.mockRestore();
    });
  });
});
