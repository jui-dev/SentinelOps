import { Logger } from '@nestjs/common';

import type { PasswordService } from '../auth/password.service.js';
import type { PrismaService } from '../database/prisma.service.js';
import { DEV_PASSWORD } from './dev-account.js';
import { DevAccountService } from './dev-account.service.js';

const serviceIn = (environment: 'development' | 'test' | 'production') => {
  // An organization that already exists: ensure() then restores logins only.
  const prisma = {
    organization: {
      findUnique: vi.fn().mockResolvedValue({ id: 'org-1' }),
      update: vi.fn().mockResolvedValue({ id: 'org-1' }),
    },
    user: { upsert: vi.fn().mockResolvedValue({ id: 'user-1' }) },
    membership: { upsert: vi.fn().mockResolvedValue({ id: 'membership-1' }) },
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

  it('should run in development', async () => {
    const { service, prisma, passwords } = serviceIn('development');

    await service.onApplicationBootstrap();

    expect(passwords.hash).toHaveBeenCalledWith(DEV_PASSWORD);
    expect(prisma.$transaction).toHaveBeenCalledOnce();
  });

  it('should never log the password', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    const { service } = serviceIn('development');

    await service.ensure();

    expect(JSON.stringify(log.mock.calls)).not.toContain(DEV_PASSWORD);
    log.mockRestore();
  });
});
