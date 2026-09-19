import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { PasswordService } from '../auth/password.service.js';
import { appConfig } from '../config/configuration.js';
import { PrismaService } from '../database/prisma.service.js';
import { DEV_ACCOUNT } from './dev-account.js';

/**
 * TEMPORARY — ensures the development account exists whenever the API starts
 * in development. See dev-account.ts for what it is and how to remove it.
 *
 * Does nothing in any other environment: `test` (every automated suite) and
 * `production` never create it.
 *
 * Idempotent, and deliberately forceful: every boot resets the account's
 * password and name, restores the user and organization if they were
 * soft-deleted, and makes the user ADMIN of the organization — so the
 * credentials shown on the login page always work.
 */
@Injectable()
export class DevAccountService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DevAccountService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    @Inject(appConfig.KEY)
    private readonly app: ConfigType<typeof appConfig>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.app.environment !== 'development') {
      return;
    }

    await this.ensure();
  }

  /** Creates or restores the account. Separate from the hook for tests. */
  async ensure(): Promise<void> {
    const passwordHash = await this.passwords.hash(DEV_ACCOUNT.password);

    await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.upsert({
        where: { slug: DEV_ACCOUNT.organizationSlug },
        create: {
          name: DEV_ACCOUNT.organizationName,
          slug: DEV_ACCOUNT.organizationSlug,
        },
        update: { deletedAt: null },
        select: { id: true },
      });

      const user = await tx.user.upsert({
        where: { email: DEV_ACCOUNT.email },
        create: {
          email: DEV_ACCOUNT.email,
          name: DEV_ACCOUNT.name,
          passwordHash,
        },
        update: { name: DEV_ACCOUNT.name, passwordHash, deletedAt: null },
        select: { id: true },
      });

      await tx.membership.upsert({
        where: {
          organizationId_userId: {
            organizationId: organization.id,
            userId: user.id,
          },
        },
        create: {
          organizationId: organization.id,
          userId: user.id,
          role: 'ADMIN',
        },
        update: { role: 'ADMIN' },
      });
    });

    // The email only. The password is shown on the login page, never logged.
    this.logger.log('Development account ready', {
      email: DEV_ACCOUNT.email,
      organization: DEV_ACCOUNT.organizationSlug,
    });
  }
}
