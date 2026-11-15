import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { opaqueSlug, slugify } from '../../common/slug.js';
import { appConfig } from '../../config/configuration.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { DEV_PERSONAS, DEV_SERVICES, DEV_TEAMS } from '../dev-account.js';
import { DevAccountService } from '../dev-account.service.js';
import { DemoHistoryService } from '../demo-history/demo-history.service.js';
import { resolveAnchor } from '../demo-history/demo-history.guard.js';
import { FORMER_MEMBER } from '../demo-history/demo-story.js';
import {
  DEMO_PART_RULES,
  DEMO_PARTS,
  dependentsOf,
  prerequisitesOf,
} from './demo-parts.js';
import type { DemoPart } from './demo-parts.js';
import type { DemoWorkspaceResponse } from './demo-workspace.contract.js';
import {
  demoNotFound,
  demoPartNotGeneratedAlone,
  demoPartRequired,
} from './demo-workspace.errors.js';

type Tx = Prisma.TransactionClient;

/** The parts with a generator of their own; the rest come with a reset. */
const GENERATED_ALONE: ReadonlySet<DemoPart> = new Set([
  'accounts',
  'teams',
  'services',
]);

const PERSONA_EMAILS = DEV_PERSONAS.map((persona) => persona.email);

/**
 * TEMPORARY — keeps a demo organization, part by part (demo-parts.ts): what
 * each part holds now, generating one with what it needs first, removing
 * one with what needs it, removing all the demo data, and resetting the
 * whole demo with its history ending today.
 *
 * Only ever on a demo organization, and only in development: anything else
 * is answered as if there were no demo at all. The demo accounts are never
 * removed — "Remove demo data" keeps them and the organization, so the
 * Admin can sign in and bring the demo back — and neither is anyone the
 * demo did not make: members someone added keep their membership.
 */
@Injectable()
export class DemoWorkspaceService {
  private readonly logger = new Logger(DemoWorkspaceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accounts: DevAccountService,
    private readonly history: DemoHistoryService,
    @Inject(appConfig.KEY)
    private readonly app: ConfigType<typeof appConfig>,
  ) {}

  async status(organizationId: string): Promise<DemoWorkspaceResponse> {
    await this.assertDemo(organizationId);

    const counts = await this.counts(organizationId);
    const record = await this.prisma.demoWorkspace.findUnique({
      where: { organizationId },
      select: {
        lastResetAt: true,
        historyEndsAt: true,
        lastResetBy: { select: { id: true, name: true } },
      },
    });
    const parts = DEMO_PARTS.map((id) => ({
      id,
      required: DEMO_PART_RULES[id].required,
      needs: [...DEMO_PART_RULES[id].needs],
      count: counts[id],
      loaded: counts[id] > 0,
      generatable: GENERATED_ALONE.has(id),
    }));

    return {
      parts,
      complete: parts.every((part) => part.loaded),
      lastResetAt: record?.lastResetAt?.toISOString() ?? null,
      lastResetBy: record?.lastResetBy ?? null,
      historyEndsAt: record?.historyEndsAt?.toISOString() ?? null,
    };
  }

  /**
   * Generates `part`, and first whatever it needs that is missing. Making
   * one that is there again restores it as the demo has it, and changes
   * nothing else.
   */
  async generate(
    organizationId: string,
    part: DemoPart,
  ): Promise<DemoWorkspaceResponse> {
    await this.assertDemo(organizationId);

    if (!GENERATED_ALONE.has(part)) {
      throw demoPartNotGeneratedAlone();
    }

    if (part === 'accounts' || prerequisitesOf(part).includes('accounts')) {
      await this.accounts.ensure();
    }

    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);

      for (const each of [...prerequisitesOf(part), part]) {
        if (each === 'teams') await this.ensureTeams(tx, organizationId);
        if (each === 'services') await this.ensureServices(tx, organizationId);
      }
    });

    this.logger.log('Demo part generated', { organizationId, part });

    return this.status(organizationId);
  }

  /** Removes `part`, and before it every part that needs it. */
  async remove(
    organizationId: string,
    part: DemoPart,
  ): Promise<DemoWorkspaceResponse> {
    await this.assertDemo(organizationId);

    if (DEMO_PART_RULES[part].required) {
      throw demoPartRequired();
    }

    await this.prisma.$transaction(async (tx) => {
      await this.lock(tx, organizationId);

      for (const each of [...dependentsOf(part), part]) {
        await this.removePart(tx, organizationId, each);
      }
    });

    this.logger.log('Demo part removed', {
      organizationId,
      parts: [...dependentsOf(part), part],
    });

    return this.status(organizationId);
  }

  /**
   * Removes every part but the accounts: the organization and its demo
   * accounts stay, so the demo can be generated again from Settings.
   */
  async removeAll(organizationId: string): Promise<DemoWorkspaceResponse> {
    await this.assertDemo(organizationId);

    await this.prisma.$transaction(
      async (tx) => {
        await this.lock(tx, organizationId);
        await this.clear(tx, organizationId);
      },
      { timeout: 60_000 },
    );

    this.logger.log('Demo data removed', { organizationId });

    return this.status(organizationId);
  }

  /**
   * Back to the full demo: everything generated is removed, the accounts
   * restored in their roles, the teams and services made as the demo has
   * them, and the history written to end today. Members someone added keep
   * their membership; anything else in the organization is replaced.
   */
  async reset(
    organizationId: string,
    by: string,
    now = new Date(),
  ): Promise<DemoWorkspaceResponse> {
    await this.assertDemo(organizationId);

    const anchor = resolveAnchor([], now);

    // Every account can sign in, whatever happened to it.
    await this.accounts.ensure();

    await this.prisma.$transaction(
      async (tx) => {
        await this.lock(tx, organizationId);
        await this.clear(tx, organizationId);
        await this.restoreRoles(tx, organizationId);
        await this.ensureTeams(tx, organizationId);
        await this.ensureServices(tx, organizationId);
      },
      { timeout: 60_000 },
    );

    // Its own transaction, as the demo:history command runs it: known
    // issues, every incident, and the activity log.
    await this.history.replace(anchor);

    await this.prisma.demoWorkspace.upsert({
      where: { organizationId },
      create: {
        organizationId,
        lastResetAt: now,
        lastResetById: by,
        historyEndsAt: anchor,
      },
      update: { lastResetAt: now, lastResetById: by, historyEndsAt: anchor },
      select: { organizationId: true },
    });

    this.logger.log('Demo reset', {
      organizationId,
      historyEndsAt: anchor.toISOString(),
    });

    return this.status(organizationId);
  }

  /** Only a demo organization, only in development; else none at all. */
  private async assertDemo(organizationId: string): Promise<void> {
    if (this.app.environment !== 'development') {
      throw demoNotFound();
    }

    const organization = await this.prisma.organization.findFirst({
      where: { id: organizationId, deletedAt: null, isDemo: true },
      select: { id: true },
    });

    if (!organization) {
      throw demoNotFound();
    }
  }

  /** The organization's row, held until commit: one change at a time. */
  private async lock(tx: Tx, organizationId: string): Promise<void> {
    await tx.$queryRaw`
      SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE
    `;
  }

  private async counts(
    organizationId: string,
  ): Promise<Record<DemoPart, number>> {
    const where = { organizationId };
    // One after another, as everywhere a single connection would serve.
    const accounts = await this.prisma.membership.count({
      where: {
        organizationId,
        removedAt: null,
        user: { email: { in: PERSONA_EMAILS }, deletedAt: null },
      },
    });
    const teams = await this.prisma.team.count({ where });
    const services = await this.prisma.service.count({ where });
    const knownIssues = await this.prisma.knownIssue.count({ where });
    const history = await this.prisma.incident.count({
      where: { organizationId, status: 'RESOLVED' },
    });
    const live = await this.prisma.incident.count({
      where: { organizationId, status: { not: 'RESOLVED' } },
    });
    const analyses = await this.prisma.incidentAnalysis.count({ where });
    const activity = await this.prisma.activityEntry.count({ where });

    return {
      accounts,
      teams,
      services,
      knownIssues,
      history,
      live,
      analyses,
      activity,
    };
  }

  /** One optional part's rows. */
  private async removePart(
    tx: Tx,
    organizationId: string,
    part: DemoPart,
  ): Promise<void> {
    switch (part) {
      case 'analyses':
        await tx.incidentAnalysis.deleteMany({ where: { organizationId } });
        return;
      case 'history':
        // Their responses, timelines, analyses and notifications with them.
        await tx.incident.deleteMany({
          where: { organizationId, status: 'RESOLVED' },
        });
        return;
      case 'live':
        await tx.incident.deleteMany({
          where: { organizationId, status: { not: 'RESOLVED' } },
        });
        return;
      case 'knownIssues':
        // Only used by incidents: they stay, no longer naming one.
        await tx.incident.updateMany({
          where: { organizationId, knownIssueId: { not: null } },
          data: { knownIssueId: null },
        });
        await tx.knownIssue.deleteMany({ where: { organizationId } });
        return;
      case 'activity':
        await tx.activityEntry.deleteMany({ where: { organizationId } });
        return;
      default:
        throw demoPartRequired();
    }
  }

  /** Everything but the organization and its members. */
  private async clear(tx: Tx, organizationId: string): Promise<void> {
    const where = { organizationId };

    await tx.notification.deleteMany({ where });
    await tx.incident.deleteMany({ where });
    await tx.knownIssue.deleteMany({ where });
    await tx.activityEntry.deleteMany({ where });
    await tx.service.deleteMany({ where });
    // Their placements with them.
    await tx.team.deleteMany({ where });
    // The demo's former member is the history's; she goes with it.
    await tx.membership.deleteMany({
      where: { organizationId, user: { email: FORMER_MEMBER.email } },
    });
    await tx.organization.update({
      where: { id: organizationId },
      data: { lastIncidentNumber: 0 },
      select: { id: true },
    });
  }

  /** Each demo account back in the role, and the place, the demo gives it. */
  private async restoreRoles(tx: Tx, organizationId: string): Promise<void> {
    for (const persona of DEV_PERSONAS) {
      await tx.membership.updateMany({
        where: { organizationId, user: { email: persona.email } },
        data: { role: persona.role, removedAt: null, removedById: null },
      });
    }
  }

  /** The demo's teams, each demo account on its own. */
  private async ensureTeams(tx: Tx, organizationId: string): Promise<void> {
    const memberships = await tx.membership.findMany({
      where: { organizationId, user: { email: { in: PERSONA_EMAILS } } },
      select: { id: true, user: { select: { email: true } } },
    });

    for (const name of DEV_TEAMS) {
      const team =
        (await tx.team.findFirst({
          where: { organizationId, name },
          select: { id: true },
        })) ??
        (await tx.team.create({
          data: {
            organizationId,
            name,
            slug: slugify(name) ?? opaqueSlug('team'),
          },
          select: { id: true },
        }));

      const placed = DEV_PERSONAS.filter((persona) =>
        (persona.teams as readonly string[]).includes(name),
      ).map(
        (persona) =>
          memberships.find(({ user }) => user.email === persona.email)?.id,
      );

      await tx.teamMembership.createMany({
        data: placed
          .filter((id): id is string => id !== undefined)
          .map((membershipId) => ({
            organizationId,
            teamId: team.id,
            membershipId,
          })),
        skipDuplicates: true,
      });
    }
  }

  /** The demo's services, each owned by its team and in use. */
  private async ensureServices(tx: Tx, organizationId: string): Promise<void> {
    for (const service of DEV_SERVICES) {
      const owner = await tx.team.findFirstOrThrow({
        where: { organizationId, name: service.ownerTeam },
        select: { id: true },
      });
      const existing = await tx.service.findFirst({
        where: { organizationId, name: service.name },
        select: { id: true },
      });

      if (existing) {
        await tx.service.update({
          where: { id: existing.id },
          data: { ownerTeamId: owner.id, archivedAt: null },
          select: { id: true },
        });
      } else {
        await tx.service.create({
          data: {
            organizationId,
            name: service.name,
            slug: slugify(service.name) ?? opaqueSlug('service'),
            ownerTeamId: owner.id,
            criticality: service.criticality,
          },
          select: { id: true },
        });
      }
    }
  }
}
