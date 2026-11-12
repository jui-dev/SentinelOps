import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { appConfig } from '../../config/configuration.js';
import { PrismaService } from '../../database/prisma.service.js';
import type { Prisma } from '../../generated/prisma/client.js';
import {
  DEV_ORGANIZATION,
  DEV_PERSONAS,
  DEV_SERVICES,
  DEV_TEAMS,
} from '../dev-account.js';
import { ACTION_AREA } from '../../activity/activity.actions.js';
import { buildDemoActivity } from './demo-activity.js';
import type { DemoSubject } from './demo-activity.js';
import { buildDemoHistory } from './build-demo-history.js';
import { buildDemoKnownIssues } from './demo-known-issues.js';
import { checkDemoHistory } from './check-demo-history.js';

export interface DemoHistoryResult {
  anchor: Date;
  /** Incidents the organization had before, all removed. */
  removed: number;
  incidents: number;
  active: number;
  responders: number;
  activities: number;
  /** Known issues written, each linked to its incidents. */
  knownIssues: number;
  /** Activity log entries written: the last week's changes and sign-ins. */
  activityEntries: number;
}

/** The organization is not the one the story was written for. */
export class DemoOrganizationMismatch extends Error {
  constructor(readonly problems: string[]) {
    super(
      `The demo organization does not match the demo personas:\n  - ${problems.join('\n  - ')}`,
    );
    this.name = 'DemoOrganizationMismatch';
  }
}

/**
 * TEMPORARY — replaces the development organization's incident history with
 * the demo history (see build-demo-history.ts). Reached only through the
 * demo:history command, and from the integration suite; no route calls it.
 *
 * One transaction, holding the organization's row, so it cannot interleave
 * with a declaration: every incident the organization has — generated or
 * not — is deleted, their responses and timelines with them, the demo
 * history is written numbered 1..N, and the incident counter continues from
 * N. The organization's activity log is replaced the same way, by the
 * demo's week of changes and sign-ins (demo-activity.ts) — the one place
 * entries are ever removed, and only here, in development. Users, memberships, teams, and services are only read, and must still
 * be the ones dev-account.ts sets up: the history is written for them, so a
 * difference refuses the whole run and changes nothing. No other
 * organization is touched.
 *
 * Refuses in production whatever the caller checked: the command's own
 * guard (demo-history.guard.ts) is the first line, this the second.
 */
@Injectable()
export class DemoHistoryService {
  private readonly logger = new Logger(DemoHistoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(appConfig.KEY)
    private readonly app: ConfigType<typeof appConfig>,
  ) {}

  async replace(anchor: Date): Promise<DemoHistoryResult> {
    if (this.app.environment === 'production') {
      throw new Error('The demo history is never written in production');
    }

    const history = buildDemoHistory(anchor);
    const problems = checkDemoHistory(history, anchor);

    if (problems.length > 0) {
      throw new Error(
        `The demo history breaks the incident rules:\n  - ${problems.join('\n  - ')}`,
      );
    }

    const result = await this.prisma.$transaction(
      async (tx) => {
        const organizationId = await this.lockOrganization(tx);
        const ids = await this.resolveStructure(tx, organizationId);

        const { count: removed } = await tx.incident.deleteMany({
          where: { organizationId },
        });
        // Its known issues are the history's too; only once nothing links
        // to them can they go.
        await tx.knownIssue.deleteMany({ where: { organizationId } });

        // The known issues first, so each incident is written already
        // linked. Each was created when its first incident was, so the
        // list reads as it would have grown.
        const knownIssues = buildDemoKnownIssues(history);
        const knownIssueOf = new Map<number, string>();

        for (const issue of knownIssues) {
          const { id } = await tx.knownIssue.create({
            data: {
              organizationId,
              serviceId: ids.services[issue.service],
              name: issue.name,
              description: issue.description,
              usualSeverity: issue.usualSeverity,
              pendingReview: issue.pendingReview,
              createdAt: history[issue.incidents[0] - 1].createdAt,
            },
            select: { id: true },
          });

          for (const number of issue.incidents) knownIssueOf.set(number, id);
        }

        // Scalar ids throughout, as IncidentsService writes them.
        const incidents = await tx.incident.createManyAndReturn({
          data: history.map((incident) => ({
            organizationId,
            number: incident.number,
            title: incident.title,
            summary: incident.summary,
            serviceId: ids.services[incident.service],
            teamId: ids.teams[incident.team],
            severity: incident.severity,
            severityConfirmed: incident.severityConfirmed,
            responseAccess: incident.responseAccess,
            status: incident.status,
            createdById: ids.users[incident.declaredBy],
            createdAt: incident.createdAt,
            updatedAt: incident.updatedAt,
            resolvedAt: incident.resolvedAt,
            resolution: incident.resolution,
            knownIssueId: knownIssueOf.get(incident.number) ?? null,
          })),
          select: { id: true, number: true },
        });
        const incidentIds = new Map(
          incidents.map(({ id, number }) => [number, id]),
        );

        const responders = history.flatMap((incident) =>
          incident.responders.map((response) => ({
            organizationId,
            incidentId: incidentIds.get(incident.number)!,
            membershipId: ids.memberships[response.responder],
            status: response.completedAt
              ? ('COMPLETED' as const)
              : ('INVESTIGATING' as const),
            startedAt: response.startedAt,
            completedAt: response.completedAt,
          })),
        );
        const activities = history.flatMap((incident) =>
          incident.activity.map((entry) => ({
            organizationId,
            incidentId: incidentIds.get(incident.number)!,
            type: entry.type,
            actorId: ids.users[entry.actor],
            message: entry.message,
            fromValue: entry.fromValue,
            toValue: entry.toValue,
            createdAt: entry.at,
          })),
        );

        await tx.incidentResponder.createMany({ data: responders });
        await tx.incidentActivity.createMany({ data: activities });

        await tx.organization.update({
          where: { id: organizationId },
          data: { lastIncidentNumber: history.length },
          select: { id: true },
        });

        // The activity log: removed, as the incidents were, and rewritten.
        const nameOf = (email: string) =>
          DEV_PERSONAS.find((persona) => persona.email === email)!.name;
        const subjectOf = (subject: DemoSubject | null) => {
          switch (subject?.kind) {
            case 'member':
              return {
                subjectType: 'MEMBERSHIP' as const,
                subjectId: ids.memberships[subject.email],
                subjectName: nameOf(subject.email),
              };
            case 'team':
              return {
                subjectType: 'TEAM' as const,
                subjectId: ids.teams[subject.name],
                subjectName: subject.name,
              };
            case 'service':
              return {
                subjectType: 'SERVICE' as const,
                subjectId: ids.services[subject.name],
                subjectName: subject.name,
              };
            case 'organization':
              return {
                subjectType: 'ORGANIZATION' as const,
                subjectId: organizationId,
                subjectName: DEV_ORGANIZATION.name,
              };
            default:
              return { subjectType: null, subjectId: null, subjectName: null };
          }
        };
        const log = buildDemoActivity(anchor);

        await tx.activityEntry.deleteMany({ where: { organizationId } });
        await tx.activityEntry.createMany({
          data: log.map((entry) => ({
            organizationId,
            action: entry.action,
            area: ACTION_AREA[entry.action],
            actorId: ids.users[entry.actor],
            actorName: nameOf(entry.actor),
            ...subjectOf(entry.subject),
            changes: entry.changes as unknown as Prisma.InputJsonValue,
            ipAddress: entry.ipAddress,
            userAgent: entry.userAgent,
            createdAt: entry.at,
          })),
        });

        return {
          anchor,
          removed,
          incidents: history.length,
          active: history.filter((incident) => incident.status !== 'RESOLVED')
            .length,
          responders: responders.length,
          activities: activities.length,
          knownIssues: knownIssues.length,
          activityEntries: log.length,
        };
      },
      // Well under a second in practice; the default 5 s is tight on a cold
      // local database.
      { timeout: 60_000 },
    );

    this.logger.log('Demo history written', {
      organization: DEV_ORGANIZATION.slug,
      ...result,
      anchor: anchor.toISOString(),
    });

    return result;
  }

  /**
   * The development organization's id, its row held until commit — the row a
   * declaration increments — or a refusal when it does not exist.
   */
  private async lockOrganization(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const [organization] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM organizations
      WHERE slug = ${DEV_ORGANIZATION.slug} AND deleted_at IS NULL
      FOR UPDATE
    `;

    if (!organization) {
      throw new DemoOrganizationMismatch([
        `organization "${DEV_ORGANIZATION.slug}" does not exist; start the API in development once to create it`,
      ]);
    }

    return organization.id;
  }

  /**
   * The ids the history is written with, after checking the organization
   * still has what dev-account.ts set up: its teams, its services owned by
   * the same teams and not archived, and each persona a member, in their
   * role, on their teams. Extra members, teams, or services are fine.
   */
  private async resolveStructure(
    tx: Prisma.TransactionClient,
    organizationId: string,
  ) {
    // One after another: an interactive transaction has one connection.
    const teams = await tx.team.findMany({
      where: { organizationId, name: { in: [...DEV_TEAMS] } },
      select: {
        id: true,
        name: true,
        memberships: { select: { membershipId: true } },
      },
    });
    const services = await tx.service.findMany({
      where: {
        organizationId,
        name: { in: DEV_SERVICES.map((service) => service.name) },
      },
      select: {
        id: true,
        name: true,
        archivedAt: true,
        ownerTeam: { select: { name: true } },
      },
    });
    const memberships = await tx.membership.findMany({
      where: {
        organizationId,
        user: { email: { in: DEV_PERSONAS.map((persona) => persona.email) } },
      },
      select: {
        id: true,
        role: true,
        user: { select: { id: true, email: true, deletedAt: true } },
      },
    });

    const problems: string[] = [];
    const ids = {
      teams: {} as Record<string, string>,
      services: {} as Record<string, string>,
      users: {} as Record<string, string>,
      memberships: {} as Record<string, string>,
    };

    for (const name of DEV_TEAMS) {
      const team = teams.find((candidate) => candidate.name === name);

      if (team) {
        ids.teams[name] = team.id;
      } else {
        problems.push(`team "${name}" is missing`);
      }
    }

    for (const expected of DEV_SERVICES) {
      const service = services.find((s) => s.name === expected.name);

      if (!service) {
        problems.push(`service "${expected.name}" is missing`);
      } else if (service.ownerTeam.name !== expected.ownerTeam) {
        problems.push(
          `service "${expected.name}" is owned by ${service.ownerTeam.name}, not ${expected.ownerTeam}`,
        );
      } else if (service.archivedAt !== null) {
        problems.push(`service "${expected.name}" is archived`);
      } else {
        ids.services[expected.name] = service.id;
      }
    }

    for (const persona of DEV_PERSONAS) {
      const membership = memberships.find(
        (m) => m.user.email === persona.email,
      );

      if (!membership || membership.user.deletedAt !== null) {
        problems.push(`${persona.email} is not a member`);
        continue;
      }

      if (membership.role !== persona.role) {
        problems.push(
          `${persona.email} is ${membership.role}, not ${persona.role}`,
        );
      }

      for (const name of persona.teams) {
        const team = teams.find((candidate) => candidate.name === name);

        if (
          team &&
          !team.memberships.some((m) => m.membershipId === membership.id)
        ) {
          problems.push(`${persona.email} is not on ${name}`);
        }
      }

      ids.users[persona.email] = membership.user.id;
      ids.memberships[persona.email] = membership.id;
    }

    if (problems.length > 0) {
      throw new DemoOrganizationMismatch(problems);
    }

    return ids;
  }
}
