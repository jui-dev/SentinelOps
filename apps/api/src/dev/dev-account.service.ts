import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { PasswordService } from '../auth/password.service.js';
import { opaqueSlug, slugify } from '../common/slug.js';
import { appConfig } from '../config/configuration.js';
import { PrismaService } from '../database/prisma.service.js';
import {
  DEV_ORGANIZATION,
  DEV_PASSWORD,
  DEV_PERSONAS,
  DEV_SERVICES,
  DEV_TEAMS,
} from './dev-account.js';
import type { DevTeam } from './dev-account.js';

/**
 * TEMPORARY — ensures the development organization and its personas whenever
 * the API starts in development. See dev-account.ts for what it is and how to
 * remove it.
 *
 * Does nothing in any other environment: `test` (every automated suite) and
 * `production` never create it.
 *
 * Two different promises, deliberately kept apart:
 *
 *   * Setup, once. When the organization does not exist yet, its teams,
 *     services, and each persona's team places are created with it. After
 *     that they belong to the application: renaming, reassigning, or taking
 *     someone off a team through the app sticks across restarts. To start
 *     over, reset the development database.
 *
 *   * Login, every boot. Each persona can always sign in with the shared
 *     password and reach the organization: its user exists, is not deleted,
 *     has that password, and needs no password change, and it has a
 *     membership. Nothing else about it is restored — not its name, not its
 *     role, not its teams.
 *
 * Never deletes anything.
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

  /** Sets up or restores the organization. Separate from the hook for tests. */
  async ensure(): Promise<void> {
    const passwordHash = await this.passwords.hash(DEV_PASSWORD);

    const created = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.organization.findUnique({
        where: { slug: DEV_ORGANIZATION.slug },
        select: { id: true },
      });

      // A soft-deleted organization would admit nobody; its name is the
      // application's.
      const organization = existing
        ? await tx.organization.update({
            where: { id: existing.id },
            // Always the demo: whatever is in it is generated.
            data: { deletedAt: null, isDemo: true },
            select: { id: true },
          })
        : await tx.organization.create({
            data: { ...DEV_ORGANIZATION, isDemo: true },
            select: { id: true },
          });
      const organizationId = organization.id;

      // Login, every boot: only what signing in and being admitted need.
      const placements: { membershipId: string; team: DevTeam }[] = [];

      for (const persona of DEV_PERSONAS) {
        const user = await tx.user.upsert({
          where: { email: persona.email },
          create: { email: persona.email, name: persona.name, passwordHash },
          update: {
            passwordHash,
            passwordChangeRequired: false,
            deletedAt: null,
          },
          select: { id: true },
        });

        const membership = await tx.membership.upsert({
          where: {
            organizationId_userId: { organizationId, userId: user.id },
          },
          create: { organizationId, userId: user.id, role: persona.role },
          update: {},
          select: { id: true },
        });

        for (const team of persona.teams) {
          placements.push({ membershipId: membership.id, team });
        }
      }

      if (existing) {
        return false;
      }

      // Setup, once. Scalar ids throughout: these relations share
      // organizationId, and it is that shared column the keys check.
      const teamIds = {} as Record<DevTeam, string>;

      for (const name of DEV_TEAMS) {
        const team = await tx.team.create({
          data: {
            organizationId,
            name,
            slug: slugify(name) ?? opaqueSlug('team'),
          },
          select: { id: true },
        });

        teamIds[name] = team.id;
      }

      await tx.service.createMany({
        data: DEV_SERVICES.map((service) => ({
          organizationId,
          name: service.name,
          slug: slugify(service.name) ?? opaqueSlug('service'),
          ownerTeamId: teamIds[service.ownerTeam],
          criticality: service.criticality,
        })),
      });

      await tx.teamMembership.createMany({
        data: placements.map(({ membershipId, team }) => ({
          organizationId,
          teamId: teamIds[team],
          membershipId,
        })),
      });

      return true;
    });

    // Emails only. The password is shown on the login page, never logged.
    this.logger.log(
      created
        ? 'Development organization created'
        : 'Development personas ready',
      {
        organization: DEV_ORGANIZATION.slug,
        personas: DEV_PERSONAS.map((persona) => persona.email),
      },
    );
  }
}
