import { Logger } from '@nestjs/common';

import type { PasswordService } from '../auth/password.service.js';
import type { PrismaService } from '../database/prisma.service.js';
import { DEV_ACCOUNT } from './dev-account.js';
import { DevAccountService } from './dev-account.service.js';

const serviceIn = (environment: 'development' | 'test' | 'production') => {
  const prisma = {
    organization: { upsert: vi.fn().mockResolvedValue({ id: 'org-1' }) },
    user: { upsert: vi.fn().mockResolvedValue({ id: 'user-1' }) },
    membership: { upsert: vi.fn().mockResolvedValue({}) },
    $transaction: vi.fn(),
  };

  prisma.$transaction.mockImplementation((work: (tx: unknown) => unknown) =>
    work(prisma),
  );

  const passwords = { hash: vi.fn().mockResolvedValue('hashed') };
  const service = new DevAccountService(
    prisma as unknown as PrismaService,
    passwords as unknown as PasswordService,
    { environment } as never,
  );

  return { service, prisma, passwords };
};

describe('DevAccountService', () => {
  it.each(['test', 'production'] as const)(
    'should do nothing in %s',
    async (environment) => {
      const { service, prisma, passwords } = serviceIn(environment);

      await service.onApplicationBootstrap();

      expect(passwords.hash).not.toHaveBeenCalled();
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );

  it('should create or restore the account in development, as ADMIN', async () => {
    const { service, prisma, passwords } = serviceIn('development');

    await service.onApplicationBootstrap();

    expect(passwords.hash).toHaveBeenCalledWith(DEV_ACCOUNT.password);
    expect(prisma.organization.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { slug: DEV_ACCOUNT.organizationSlug },
        update: { deletedAt: null },
      }),
    );
    expect(prisma.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: DEV_ACCOUNT.email },
        update: {
          name: DEV_ACCOUNT.name,
          passwordHash: 'hashed',
          deletedAt: null,
        },
      }),
    );
    expect(prisma.membership.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          organizationId_userId: { organizationId: 'org-1', userId: 'user-1' },
        },
        update: { role: 'ADMIN' },
      }),
    );
  });

  it('should never log the password', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const { service } = serviceIn('development');

    await service.ensure();

    expect(JSON.stringify(log.mock.calls)).not.toContain(DEV_ACCOUNT.password);
    log.mockRestore();
  });
});
