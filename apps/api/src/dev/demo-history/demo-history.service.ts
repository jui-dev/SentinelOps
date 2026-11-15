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
import { DEMO_ANALYSES } from './demo-analyses.js';
import { ADMIN, FORMER_MEMBER, MANAGER } from './demo-story.js';
import type { DemoIncident } from './build-demo-history.js';

const DAY = 24 * 60 * 60 * 1000;

/** The ids the demo is written with, by name or email (resolveStructure). */
interface StructureIds {
  teams: Record<string, string>;
  services: Record<string, string>;
  users: Record<string, string>;
  memberships: Record<string, string>;
}

/**
 * When the former member was removed: a few days after the last thing she
 * did, so nothing of hers is under way — as the API requires of a removal.
 */
export const formerMemberRemovedAt = (
  history: readonly DemoIncident[],
  anchor: Date,
): Date => {
  const last = Math.max(
    0,
    ...history.flatMap((incident) =>
      incident.responders
        .filter(({ responder }) => responder === FORMER_MEMBER.email)
        .map(({ startedAt, completedAt }) =>
          (completedAt ?? startedAt).getTime(),
        ),
    ),
  );

  return new Date(
    last > 0
      ? last + 3 * DAY
      : anchor.getTime() - (26 - FORMER_MEMBER.lastWeek) * 7 * DAY,
  );
};

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
  /** Incident analyses written, published and drafts. */
  analyses: number;
}

/** The parts of the demo this service writes (demo-workspace/demo-parts.ts). */
export type DemoHistoryPart =
  'knownIssues' | 'history' | 'live' | 'activity' | 'analyses';

export const DEMO_HISTORY_PARTS: ReadonlySet<DemoHistoryPart> = new Set([
  'knownIssues',
  'history',
  'live',
  'activity',
  'analyses',
]);

/**
 * Generating a part on its own would give an incident a number one already
 * has — one someone declared since the demo data was removed.
 */
export class DemoNumbersTaken extends Error {
  constructor(readonly numbers: number[]) {
    super(
      `Incident numbers already in use: ${numbers.slice(0, 5).join(', ')}${numbers.length > 5 ? ', …' : ''}`,
    );
    this.name = 'DemoNumbersTaken';
  }
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

  /**
   * Every part this service writes, replacing what the organization had:
   * its incidents — generated or not — known issues, analyses and activity
   * log. What the demo:history command runs, and a reset.
   */
  replace(anchor: Date): Promise<DemoHistoryResult> {
    return this.write(anchor, DEMO_HISTORY_PARTS);
  }

  /**
   * Writes `parts` of the demo for the story ending at `anchor`, each
   * replacing what the organization had of it, in one transaction:
   *
   *   knownIssues  the known issues, linked to the story's incidents present
   *   history      the resolved incidents, with responses and timelines
   *   live         the incidents still under way
   *   analyses     analyses of the resolved incidents present
   *   activity     the activity log: the last week, and the former member
   *
   * Incidents keep their numbers in the story — a resolution note can name
   * another — so a part whose numbers someone has taken since is refused
   * (DemoNumbersTaken) and nothing is written.
   */
  async write(
    anchor: Date,
    parts: ReadonlySet<DemoHistoryPart>,
  ): Promise<DemoHistoryResult> {
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
        const removedAt = formerMemberRemovedAt(history, anchor);

        // Her responses are in the history; her removal is in the log.
        await this.ensureFormerMember(tx, organizationId, ids, removedAt);

        // What is rewritten goes first: its responses, timelines, analyses
        // and notifications with it.
        let removed = 0;

        if (parts.has('history')) {
          removed += (
            await tx.incident.deleteMany({
              where: { organizationId, status: 'RESOLVED' },
            })
          ).count;
        }

        if (parts.has('live')) {
          removed += (
            await tx.incident.deleteMany({
              where: { organizationId, status: { not: 'RESOLVED' } },
            })
          ).count;
        }

        if (parts.has('analyses')) {
          await tx.incidentAnalysis.deleteMany({ where: { organizationId } });
        }

        if (parts.has('knownIssues')) {
          // Only once nothing names them can they go.
          await tx.incident.updateMany({
            where: { organizationId, knownIssueId: { not: null } },
            data: { knownIssueId: null },
          });
          await tx.knownIssue.deleteMany({ where: { organizationId } });
        }

        const written = history.filter((incident) =>
          incident.status === 'RESOLVED'
            ? parts.has('history')
            : parts.has('live'),
        );
        const taken = await tx.incident.findMany({
          where: {
            organizationId,
            number: { in: written.map((incident) => incident.number) },
          },
          select: { number: true },
          orderBy: { number: 'asc' },
        });

        if (taken.length > 0) {
          throw new DemoNumbersTaken(taken.map(({ number }) => number));
        }

        // The known issues before the incidents, so each is written already
        // linked. Each was created when its first incident was, so the list
        // reads as it would have grown.
        const knownIssues = buildDemoKnownIssues(history);
        const knownIssueOf = new Map<number, string>();

        if (parts.has('knownIssues')) {
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

            // The story's incidents already here name it too.
            await tx.incident.updateMany({
              where: {
                organizationId,
                number: { in: [...issue.incidents] },
                serviceId: ids.services[issue.service],
                knownIssueId: null,
              },
              data: { knownIssueId: id },
            });
          }
        } else {
          // Kept: the incidents written now name the ones there are.
          const existing = await tx.knownIssue.findMany({
            where: {
              organizationId,
              name: { in: knownIssues.map((issue) => issue.name) },
            },
            select: { id: true, name: true },
          });

          for (const issue of knownIssues) {
            const found = existing.find(({ name }) => name === issue.name);

            if (found) {
              for (const number of issue.incidents) {
                knownIssueOf.set(number, found.id);
              }
            }
          }
        }

        // Scalar ids throughout, as IncidentsService writes them.
        const incidents = await tx.incident.createManyAndReturn({
          data: written.map((incident) => ({
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

        const responders = written.flatMap((incident) =>
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
        const activities = written.flatMap((incident) =>
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

        // The counter continues from the highest number the organization
        // holds, so the next declaration follows on.
        const {
          _max: { number: highest },
        } = await tx.incident.aggregate({
          where: { organizationId },
          _max: { number: true },
        });

        await tx.organization.update({
          where: { id: organizationId },
          data: { lastIncidentNumber: highest ?? 0 },
          select: { id: true },
        });

        // Where the story ends, so a part written later matches it.
        if (parts.has('history') || parts.has('live')) {
          await tx.demoWorkspace.upsert({
            where: { organizationId },
            create: { organizationId, historyEndsAt: anchor },
            update: { historyEndsAt: anchor },
            select: { organizationId: true },
          });
        }

        const analyses = parts.has('analyses')
          ? await this.writeAnalyses(tx, organizationId, ids, history, anchor)
          : 0;

        const activityEntries = parts.has('activity')
          ? await this.writeActivityLog(
              tx,
              organizationId,
              ids,
              anchor,
              removedAt,
            )
          : 0;

        return {
          anchor,
          removed,
          incidents: written.length,
          active: written.filter((incident) => incident.status !== 'RESOLVED')
            .length,
          responders: responders.length,
          activities: activities.length,
          knownIssues: parts.has('knownIssues') ? knownIssues.length : 0,
          activityEntries,
          analyses,
        };
      },
      // Well under a second in practice; the default 5 s is tight on a cold
      // local database.
      { timeout: 60_000 },
    );

    this.logger.log('Demo history written', {
      organization: DEV_ORGANIZATION.slug,
      parts: [...parts],
      ...result,
      anchor: anchor.toISOString(),
    });

    return result;
  }

  /**
   * The analyses (demo-analyses.ts), each on its resolved incident if the
   * organization holds it: started by the Incident Manager, written by a
   * Responder who worked the incident, published by her. One that would
   * start after the story ends is not written; one that would be published
   * after it is still a draft.
   */
  private async writeAnalyses(
    tx: Prisma.TransactionClient,
    organizationId: string,
    ids: StructureIds,
    history: readonly DemoIncident[],
    anchor: Date,
  ): Promise<number> {
    let written = 0;

    for (const analysis of DEMO_ANALYSES) {
      const incident = history.find(
        (candidate) =>
          candidate.title === analysis.incident &&
          candidate.resolvedAt !== null,
      );

      if (!incident) continue;

      // By its title: a history written to end on another day numbers its
      // incidents differently. Timed from when it was really resolved.
      const row = await tx.incident.findFirst({
        where: { organizationId, title: incident.title, status: 'RESOLVED' },
        orderBy: { number: 'desc' },
        select: { id: true, resolvedAt: true },
      });

      if (!row?.resolvedAt) continue;

      const startedAt = new Date(
        row.resolvedAt.getTime() + analysis.startedAfterDays * DAY,
      );

      if (startedAt.getTime() >= anchor.getTime()) continue;

      const writer =
        incident.responders.find(
          ({ responder }) => responder !== FORMER_MEMBER.email,
        )?.responder ?? MANAGER;
      const due =
        analysis.publishedAfterDays === undefined
          ? null
          : startedAt.getTime() + analysis.publishedAfterDays * DAY;
      const publishedAt =
        analysis.status === 'PUBLISHED' &&
        due !== null &&
        due < anchor.getTime()
          ? new Date(due)
          : null;

      await tx.incidentAnalysis.create({
        data: {
          organizationId,
          incidentId: row.id,
          status: publishedAt ? 'PUBLISHED' : 'DRAFT',
          ownerMembershipId: ids.memberships[writer],
          summary: analysis.sections.summary ?? null,
          impact: analysis.sections.impact ?? null,
          cause: analysis.sections.cause ?? null,
          lessons: analysis.sections.lessons ?? null,
          doneSections: publishedAt
            ? [...analysis.done]
            : analysis.done.filter((section) => section === 'summary'),
          createdById: ids.users[MANAGER],
          publishedById: publishedAt ? ids.users[MANAGER] : null,
          createdAt: startedAt,
          updatedAt: publishedAt ?? startedAt,
          publishedAt,
        },
        select: { id: true },
      });
      written += 1;
    }

    return written;
  }

  /** The activity log: removed, as the incidents were, and rewritten. */
  private async writeActivityLog(
    tx: Prisma.TransactionClient,
    organizationId: string,
    ids: StructureIds,
    anchor: Date,
    removedAt: Date,
  ): Promise<number> {
    const nameOf = (email: string) =>
      email === FORMER_MEMBER.email
        ? FORMER_MEMBER.name
        : DEV_PERSONAS.find((persona) => persona.email === email)!.name;
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
    // The Admin signs in every day of the log, so there is always one.
    const fromAdmin = log.find((entry) => entry.actor === ADMIN)!;

    // The Admin removing the former member, where it happened in the
    // history: before the week the log otherwise covers.
    log.unshift({
      at: removedAt,
      action: 'MEMBER_REMOVED',
      actor: ADMIN,
      subject: { kind: 'member', email: FORMER_MEMBER.email },
      changes: [
        { field: 'role', before: FORMER_MEMBER.role, after: null },
        { field: 'teams', before: FORMER_MEMBER.team, after: null },
      ],
      ipAddress: fromAdmin.ipAddress,
      userAgent: fromAdmin.userAgent,
    });

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

    return log.length;
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
    const ids: StructureIds = {
      teams: {},
      services: {},
      users: {},
      memberships: {},
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

  /**
   * The former member: her account, with no password — she never signs in
   * to the demo — and her membership, removed by the Admin at `removedAt`.
   * Made once and kept, so running the history again finds her.
   */
  private async ensureFormerMember(
    tx: Prisma.TransactionClient,
    organizationId: string,
    ids: { users: Record<string, string>; memberships: Record<string, string> },
    removedAt: Date,
  ): Promise<void> {
    const user = await tx.user.upsert({
      where: { email: FORMER_MEMBER.email },
      create: { email: FORMER_MEMBER.email, name: FORMER_MEMBER.name },
      update: {},
      select: { id: true },
    });
    const membership = await tx.membership.upsert({
      where: { organizationId_userId: { organizationId, userId: user.id } },
      create: {
        organizationId,
        userId: user.id,
        role: FORMER_MEMBER.role,
        removedAt,
        removedById: ids.users[ADMIN],
      },
      update: {
        role: FORMER_MEMBER.role,
        removedAt,
        removedById: ids.users[ADMIN],
      },
      select: { id: true },
    });

    // Removal took her off her team.
    await tx.teamMembership.deleteMany({
      where: { organizationId, membershipId: membership.id },
    });

    ids.users[FORMER_MEMBER.email] = user.id;
    ids.memberships[FORMER_MEMBER.email] = membership.id;
  }
}
