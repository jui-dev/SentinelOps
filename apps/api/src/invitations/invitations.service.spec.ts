import { HttpException } from '@nestjs/common';

import { AuthErrorCode } from '../auth/auth.errors.js';
import { hashOpaqueToken } from '../common/opaque-token.js';
import type { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { TenancyErrorCode } from '../tenancy/tenancy.errors.js';
import { InvitationsErrorCode } from './invitations.errors.js';
import {
  INVITATION_TTL_DAYS,
  InvitationsService,
} from './invitations.service.js';

const ORG = '0199a1b2-c3d4-7000-8000-00000000000a';
const USER = '0199a1b2-c3d4-7000-8000-000000000001';
const INVITATION = '0199a1b2-c3d4-7000-8000-0000000000c1';
const NOW = new Date('2026-09-17T12:00:00.000Z');
const LATER = new Date('2026-09-24T12:00:00.000Z');
const EARLIER = new Date('2026-09-10T12:00:00.000Z');

const invitationRow = {
  id: INVITATION,
  email: 'grace@example.com',
  role: 'RESPONDER',
  expiresAt: LATER,
  createdAt: NOW,
  invitedBy: { id: USER, name: 'Ada Lovelace' },
};

const resolvedRow = (overrides: Record<string, unknown> = {}) => ({
  id: INVITATION,
  organizationId: ORG,
  email: 'grace@example.com',
  role: 'RESPONDER',
  expiresAt: LATER,
  acceptedAt: null,
  revokedAt: null,
  organization: {
    id: ORG,
    name: 'Acme Operations',
    slug: 'acme-ops',
    createdAt: EARLIER,
    deletedAt: null,
  },
  invitedBy: { name: 'Ada Lovelace' },
  ...overrides,
});

const membershipRow = {
  id: 'membership-1',
  role: 'RESPONDER',
  organization: {
    id: ORG,
    name: 'Acme Operations',
    slug: 'acme-ops',
    createdAt: EARLIER,
  },
};

const uniqueViolation = (index: string) =>
  new Prisma.PrismaClientKnownRequestError('unique', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { driverAdapterError: { cause: { constraint: { index } } } },
  });

/** One mock client, used both directly and as the transaction client. */
const serviceWith = () => {
  const prisma = {
    organization: { findFirst: vi.fn().mockResolvedValue({ id: ORG }) },
    user: { findFirst: vi.fn(), findUnique: vi.fn().mockResolvedValue(null) },
    membership: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue(membershipRow),
    },
    invitation: {
      findUnique: vi.fn().mockResolvedValue(resolvedRow()),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn().mockResolvedValue(invitationRow),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    $transaction: vi.fn(),
  };

  prisma.$transaction.mockImplementation((work: (tx: unknown) => unknown) =>
    work(prisma),
  );

  const service = new InvitationsService(prisma as unknown as PrismaService);

  return { service, prisma };
};

const rejection = async (promise: Promise<unknown>): Promise<HttpException> => {
  const caught = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );

  expect(caught).toBeInstanceOf(HttpException);

  return caught as HttpException;
};

const expectCode = async (
  promise: Promise<unknown>,
  status: number,
  code: string,
) => {
  const error = await rejection(promise);

  expect(error.getStatus()).toBe(status);
  expect(error.errorCode).toBe(code);
};

describe('InvitationsService', () => {
  describe('create', () => {
    const input = { email: 'grace@example.com', role: 'RESPONDER' } as const;

    it('should revoke the open invitation for the address, then insert its replacement', async () => {
      const { service, prisma } = serviceWith();

      const response = await service.create(ORG, { userId: USER }, input, NOW);

      expect(prisma.invitation.updateMany).toHaveBeenCalledExactlyOnceWith({
        where: {
          organizationId: ORG,
          email: 'grace@example.com',
          acceptedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: NOW },
      });

      const [createArgs] = prisma.invitation.create.mock.calls[0] as [
        { data: Record<string, unknown> },
      ];

      expect(createArgs.data).toEqual({
        organizationId: ORG,
        email: 'grace@example.com',
        role: 'RESPONDER',
        tokenHash: hashOpaqueToken(response.token),
        invitedById: USER,
        expiresAt: new Date(
          NOW.getTime() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000,
        ),
      });
      expect(response.replacedExisting).toBe(true);
      expect(response.invitation.status).toBe('pending');
    });

    it('should say when there was nothing to replace', async () => {
      const { service, prisma } = serviceWith();
      prisma.invitation.updateMany.mockResolvedValue({ count: 0 });

      const response = await service.create(ORG, { userId: USER }, input, NOW);

      expect(response.replacedExisting).toBe(false);
    });

    it('should never store the token it returns', async () => {
      const { service, prisma } = serviceWith();

      const { token } = await service.create(ORG, { userId: USER }, input, NOW);

      expect(JSON.stringify(prisma.invitation.create.mock.calls)).not.toContain(
        token,
      );
    });

    it('should refuse a current member before writing anything', async () => {
      const { service, prisma } = serviceWith();
      prisma.membership.findFirst.mockResolvedValue({ id: 'membership-1' });

      await expectCode(
        service.create(ORG, { userId: USER }, input, NOW),
        409,
        InvitationsErrorCode.ALREADY_A_MEMBER,
      );
      expect(prisma.membership.findFirst).toHaveBeenCalledWith({
        where: {
          organizationId: ORG,
          user: { email: 'grace@example.com', deletedAt: null },
        },
        select: { id: true },
      });
      expect(prisma.invitation.updateMany).not.toHaveBeenCalled();
      expect(prisma.invitation.create).not.toHaveBeenCalled();
    });

    it('should answer the admission 404 for an organization that no longer exists', async () => {
      const { service, prisma } = serviceWith();
      prisma.organization.findFirst.mockResolvedValue(null);

      await expectCode(
        service.create(ORG, { userId: USER }, input, NOW),
        404,
        TenancyErrorCode.ORGANIZATION_NOT_FOUND,
      );
      expect(prisma.invitation.create).not.toHaveBeenCalled();
    });

    it('should answer 409 when a concurrent create won the open slot', async () => {
      const { service, prisma } = serviceWith();
      prisma.invitation.create.mockRejectedValue(
        uniqueViolation('invitations_open_organization_email_key'),
      );

      await expectCode(
        service.create(ORG, { userId: USER }, input, NOW),
        409,
        InvitationsErrorCode.INVITATION_ALREADY_PENDING,
      );
    });

    it('should not disguise any other unique violation as a conflict', async () => {
      const { service, prisma } = serviceWith();
      const error = uniqueViolation('invitations_token_hash_key');
      prisma.invitation.create.mockRejectedValue(error);

      await expect(
        service.create(ORG, { userId: USER }, input, NOW),
      ).rejects.toBe(error);
    });
  });

  describe('listOpen', () => {
    it('should list only open invitations of this organization, newest first', async () => {
      const { service, prisma } = serviceWith();
      prisma.invitation.findMany.mockResolvedValue([
        invitationRow,
        { ...invitationRow, id: 'expired', expiresAt: EARLIER },
      ]);

      const listed = await service.listOpen(ORG, NOW);

      expect(prisma.invitation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: ORG,
            acceptedAt: null,
            revokedAt: null,
            organization: { deletedAt: null },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
      );
      expect(listed.map(({ status }) => status)).toEqual([
        'pending',
        'expired',
      ]);
    });
  });

  describe('revoke', () => {
    it('should revoke with one statement scoped by organization', async () => {
      const { service, prisma } = serviceWith();

      await service.revoke(ORG, INVITATION, NOW);

      expect(prisma.invitation.updateMany).toHaveBeenCalledExactlyOnceWith({
        where: {
          id: INVITATION,
          organizationId: ORG,
          organization: { deletedAt: null },
          acceptedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: NOW },
      });
      expect(prisma.invitation.findFirst).not.toHaveBeenCalled();
    });

    it('should answer 404 for a malformed id without querying', async () => {
      const { service, prisma } = serviceWith();

      await expectCode(
        service.revoke(ORG, 'not-a-uuid', NOW),
        404,
        InvitationsErrorCode.INVITATION_NOT_FOUND,
      );
      expect(prisma.invitation.updateMany).not.toHaveBeenCalled();
    });

    it('should answer 404 for an invitation outside this organization', async () => {
      const { service, prisma } = serviceWith();
      prisma.invitation.updateMany.mockResolvedValue({ count: 0 });
      prisma.invitation.findFirst.mockResolvedValue(null);

      await expectCode(
        service.revoke(ORG, INVITATION, NOW),
        404,
        InvitationsErrorCode.INVITATION_NOT_FOUND,
      );
      expect(prisma.invitation.findFirst).toHaveBeenCalledWith({
        where: {
          id: INVITATION,
          organizationId: ORG,
          organization: { deletedAt: null },
        },
        select: { id: true },
      });
    });

    it('should answer 409 for an invitation that is no longer open', async () => {
      const { service, prisma } = serviceWith();
      prisma.invitation.updateMany.mockResolvedValue({ count: 0 });
      prisma.invitation.findFirst.mockResolvedValue({ id: INVITATION });

      await expectCode(
        service.revoke(ORG, INVITATION, NOW),
        409,
        InvitationsErrorCode.INVITATION_NOT_PENDING,
      );
    });
  });

  describe('lookup', () => {
    it('should describe a usable invitation', async () => {
      const { service } = serviceWith();

      await expect(service.lookup('token', NOW)).resolves.toEqual({
        organization: { id: ORG, name: 'Acme Operations', slug: 'acme-ops' },
        email: 'grace@example.com',
        role: 'RESPONDER',
        expiresAt: LATER.toISOString(),
        invitedBy: { name: 'Ada Lovelace' },
      });
    });

    it.each([
      ['unknown', null],
      ['expired', resolvedRow({ expiresAt: EARLIER })],
      ['accepted', resolvedRow({ acceptedAt: EARLIER })],
      ['revoked', resolvedRow({ revokedAt: EARLIER })],
      [
        'in a deleted organization',
        resolvedRow({
          organization: { ...resolvedRow().organization, deletedAt: EARLIER },
        }),
      ],
    ])(
      'should answer the same 404 for an invitation that is %s',
      async (_label, row) => {
        const { service, prisma } = serviceWith();
        prisma.invitation.findUnique.mockResolvedValue(row);

        await expectCode(
          service.lookup('token', NOW),
          404,
          InvitationsErrorCode.INVITATION_NOT_FOUND,
        );
      },
    );
  });

  describe('accept', () => {
    const acceptingCaller = () => {
      const context = serviceWith();
      context.prisma.user.findFirst.mockResolvedValue({
        id: USER,
        email: 'grace@example.com',
      });

      return context;
    };

    it('should claim the invitation, then grant the offered membership', async () => {
      const { service, prisma } = acceptingCaller();

      await expect(service.accept('token', USER, NOW)).resolves.toEqual({
        id: 'membership-1',
        role: 'RESPONDER',
        organization: {
          id: ORG,
          name: 'Acme Operations',
          slug: 'acme-ops',
          createdAt: EARLIER.toISOString(),
        },
      });

      expect(prisma.invitation.updateMany).toHaveBeenCalledExactlyOnceWith({
        where: {
          id: INVITATION,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: NOW },
        },
        data: { acceptedAt: NOW },
      });
      expect(prisma.membership.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { organizationId: ORG, userId: USER, role: 'RESPONDER' },
        }),
      );

      const claimOrder =
        prisma.invitation.updateMany.mock.invocationCallOrder[0];
      const grantOrder = prisma.membership.create.mock.invocationCallOrder[0];

      expect(claimOrder).toBeLessThan(grantOrder as number);
    });

    it('should refuse a mismatched email before claiming anything', async () => {
      const { service, prisma } = serviceWith();
      prisma.user.findFirst.mockResolvedValue({
        id: USER,
        email: 'someone-else@example.com',
      });

      await expectCode(
        service.accept('token', USER, NOW),
        403,
        InvitationsErrorCode.INVITATION_EMAIL_MISMATCH,
      );
      expect(prisma.invitation.updateMany).not.toHaveBeenCalled();
      expect(prisma.membership.create).not.toHaveBeenCalled();
    });

    it('should refuse an existing member before claiming anything', async () => {
      const { service, prisma } = acceptingCaller();
      prisma.membership.findUnique.mockResolvedValue({ id: 'membership-1' });

      await expectCode(
        service.accept('token', USER, NOW),
        409,
        InvitationsErrorCode.ALREADY_A_MEMBER,
      );
      expect(prisma.invitation.updateMany).not.toHaveBeenCalled();
    });

    it('should refuse a deleted caller with 401 before claiming anything', async () => {
      const { service, prisma } = serviceWith();
      prisma.user.findFirst.mockResolvedValue(null);

      await expectCode(
        service.accept('token', USER, NOW),
        401,
        AuthErrorCode.UNAUTHENTICATED,
      );
      expect(prisma.invitation.updateMany).not.toHaveBeenCalled();
    });

    it('should refuse an unusable invitation before looking at the caller', async () => {
      const { service, prisma } = acceptingCaller();
      prisma.invitation.findUnique.mockResolvedValue(
        resolvedRow({ revokedAt: EARLIER }),
      );

      await expectCode(
        service.accept('token', USER, NOW),
        404,
        InvitationsErrorCode.INVITATION_NOT_FOUND,
      );
      expect(prisma.user.findFirst).not.toHaveBeenCalled();
      expect(prisma.invitation.updateMany).not.toHaveBeenCalled();
    });

    it('should answer 404 and grant nothing when the claim loses a race', async () => {
      const { service, prisma } = acceptingCaller();
      prisma.invitation.updateMany.mockResolvedValue({ count: 0 });

      await expectCode(
        service.accept('token', USER, NOW),
        404,
        InvitationsErrorCode.INVITATION_NOT_FOUND,
      );
      expect(prisma.membership.create).not.toHaveBeenCalled();
    });

    it('should turn a membership conflict after the claim into 409, inside the transaction', async () => {
      const { service, prisma } = acceptingCaller();
      prisma.membership.create.mockRejectedValue(
        uniqueViolation('memberships_organization_id_user_id_key'),
      );

      await expectCode(
        service.accept('token', USER, NOW),
        409,
        InvitationsErrorCode.ALREADY_A_MEMBER,
      );
      // Thrown from within the transaction callback, which is what rolls the
      // claim back.
      expect(prisma.$transaction).toHaveBeenCalledOnce();
    });
  });

  describe('acceptAsNewAccount', () => {
    it("should create the account with the invitation's email, after the claim", async () => {
      const { service, prisma } = serviceWith();
      const createAccount = vi.fn().mockResolvedValue({ id: USER });

      const result = await service.acceptAsNewAccount(
        'token',
        createAccount,
        NOW,
      );

      expect(createAccount).toHaveBeenCalledExactlyOnceWith(
        prisma,
        'grace@example.com',
      );
      expect(
        prisma.invitation.updateMany.mock.invocationCallOrder[0],
      ).toBeLessThan(createAccount.mock.invocationCallOrder[0] as number);
      expect(prisma.membership.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { organizationId: ORG, userId: USER, role: 'RESPONDER' },
        }),
      );
      expect(result.account).toEqual({ id: USER });
      expect(result.membership.organization.slug).toBe('acme-ops');
    });

    it('should refuse an address that already has an account before claiming anything', async () => {
      const { service, prisma } = serviceWith();
      prisma.user.findUnique.mockResolvedValue({ id: 'existing' });
      const createAccount = vi.fn();

      await expectCode(
        service.acceptAsNewAccount('token', createAccount, NOW),
        409,
        AuthErrorCode.EMAIL_ALREADY_REGISTERED,
      );
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'grace@example.com' },
        select: { id: true },
      });
      expect(prisma.invitation.updateMany).not.toHaveBeenCalled();
      expect(createAccount).not.toHaveBeenCalled();
    });

    it('should create no account for an unusable invitation', async () => {
      const { service, prisma } = serviceWith();
      prisma.invitation.findUnique.mockResolvedValue(null);
      const createAccount = vi.fn();

      await expectCode(
        service.acceptAsNewAccount('token', createAccount, NOW),
        404,
        InvitationsErrorCode.INVITATION_NOT_FOUND,
      );
      expect(createAccount).not.toHaveBeenCalled();
    });

    it('should create no account when the claim loses a race', async () => {
      const { service, prisma } = serviceWith();
      prisma.invitation.updateMany.mockResolvedValue({ count: 0 });
      const createAccount = vi.fn();

      await expectCode(
        service.acceptAsNewAccount('token', createAccount, NOW),
        404,
        InvitationsErrorCode.INVITATION_NOT_FOUND,
      );
      expect(createAccount).not.toHaveBeenCalled();
    });
  });
});
