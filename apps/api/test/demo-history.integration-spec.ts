import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { ActivityService } from './../src/activity/activity.service.js';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from './../src/database/prisma.service.js';
import { DEV_ORGANIZATION, DEV_PERSONAS } from './../src/dev/dev-account.js';
import { DevAccountService } from './../src/dev/dev-account.service.js';
import { buildDemoActivity } from './../src/dev/demo-history/demo-activity.js';
import { DEMO_ANALYSES } from './../src/dev/demo-history/demo-analyses.js';
import { buildDemoKnownIssues } from './../src/dev/demo-history/demo-known-issues.js';
import { FORMER_MEMBER } from './../src/dev/demo-history/demo-story.js';
import { buildDemoHistory } from './../src/dev/demo-history/build-demo-history.js';
import {
  DemoHistoryService,
  DemoOrganizationMismatch,
} from './../src/dev/demo-history/demo-history.service.js';
import { IncidentsService } from './../src/incidents/incidents.service.js';
import { resolveTestDatabaseUrl, truncate } from './test-database.js';

/**
 * TEMPORARY — the demo history against a real database, read back through
 * IncidentsService as the application reads it: every incident, responder,
 * and timeline entry as built; members' responses and attention derived from
 * them; the workflow carrying on from it; the same result on every run; and
 * nothing outside the development organization's incidents touched. Delete
 * with src/dev/.
 */
describe('demo history (integration)', () => {
  const prisma = new PrismaService({ url: resolveTestDatabaseUrl() });
  const anchor = new Date('2026-09-20T00:00:00.000Z');
  const history = buildDemoHistory(anchor);
  const nameOf = (email: string) =>
    email === FORMER_MEMBER.email
      ? FORMER_MEMBER.name
      : DEV_PERSONAS.find((persona) => persona.email === email)!.name;

  let app: INestApplication;
  let devAccount: DevAccountService;
  let demo: DemoHistoryService;
  let incidents: IncidentsService;
  let organizationId: string;

  const membershipOf = async (email: string) =>
    prisma.membership.findFirstOrThrow({
      where: { organizationId, user: { email } },
      select: { id: true, role: true },
    });

  /** Everything about the organization's incidents except row ids. */
  const snapshot = async () =>
    prisma.incident.findMany({
      where: { organizationId },
      orderBy: { number: 'asc' },
      select: {
        number: true,
        title: true,
        summary: true,
        severity: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        resolvedAt: true,
        resolution: true,
        service: { select: { name: true } },
        team: { select: { name: true } },
        createdBy: { select: { email: true } },
        responders: {
          orderBy: { startedAt: 'asc' },
          select: {
            status: true,
            startedAt: true,
            completedAt: true,
            membership: { select: { user: { select: { email: true } } } },
          },
        },
        activity: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: {
            type: true,
            message: true,
            fromValue: true,
            toValue: true,
            createdAt: true,
            actor: { select: { email: true } },
          },
        },
      },
    });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleRef.createNestApplication();
    await app.init();
    devAccount = app.get(DevAccountService);
    demo = app.get(DemoHistoryService);
    incidents = app.get(IncidentsService);
  });

  beforeEach(async () => {
    await truncate(
      prisma,
      'TRUNCATE TABLE activity_entries, incidents, services, team_memberships, teams, invitations, refresh_tokens, memberships, users, organizations RESTART IDENTITY CASCADE',
    );
    await devAccount.ensure();
    ({ id: organizationId } = await prisma.organization.findUniqueOrThrow({
      where: { slug: DEV_ORGANIZATION.slug },
      select: { id: true },
    }));
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('should write the analyses as the application would have: started and published by the Incident Manager, written by a Responder on the incident', async () => {
    await demo.replace(anchor);

    const analyses = await prisma.incidentAnalysis.findMany({
      where: { organizationId },
      select: {
        status: true,
        summary: true,
        doneSections: true,
        publishedAt: true,
        createdAt: true,
        createdBy: { select: { email: true } },
        publishedBy: { select: { email: true } },
        owner: { select: { id: true, role: true } },
        incident: {
          select: {
            status: true,
            resolvedAt: true,
            responders: { select: { membershipId: true } },
          },
        },
      },
    });

    expect(analyses.map(({ status }) => status).sort()).toEqual([
      'DRAFT',
      'DRAFT',
      ...Array(6).fill('PUBLISHED'),
    ]);

    for (const analysis of analyses) {
      expect(analysis.incident.status).toBe('RESOLVED');
      expect(analysis.createdAt.getTime()).toBeGreaterThan(
        analysis.incident.resolvedAt!.getTime(),
      );
      expect(analysis.createdBy.email).toBe('ava@example.com');
      expect(analysis.owner.role).toBe('RESPONDER');
      expect(analysis.incident.responders.map((r) => r.membershipId)).toContain(
        analysis.owner.id,
      );

      if (analysis.status === 'PUBLISHED') {
        // Publishing needs a summary marked done.
        expect(analysis.doneSections).toContain('summary');
        expect(analysis.publishedBy?.email).toBe('ava@example.com');
        expect(analysis.publishedAt!.getTime()).toBeLessThan(anchor.getTime());
      } else {
        expect(analysis.publishedAt).toBeNull();
      }
    }
  });

  it('should write every incident as built, as the application reads it', async () => {
    const result = await demo.replace(anchor);

    expect(result).toEqual({
      anchor,
      removed: 0,
      incidents: history.length,
      active: 5,
      responders: history.flatMap((incident) => incident.responders).length,
      activities: history.flatMap((incident) => incident.activity).length,
      knownIssues: buildDemoKnownIssues(history).length,
      // And the former member's removal, months before the week.
      activityEntries: buildDemoActivity(anchor).length + 1,
      analyses: DEMO_ANALYSES.length,
    });

    // Read as the dev Admin, who oversees every incident.
    const admin = await prisma.membership.findFirstOrThrow({
      where: { organizationId, role: 'ADMIN' },
      select: { id: true, role: true },
    });
    const reader = { membershipId: admin.id, role: admin.role };

    for (const built of history) {
      const number = String(built.number);
      const detail = await incidents.get(organizationId, reader, number);
      const timeline = await incidents.timeline(organizationId, reader, number);

      expect(detail).toMatchObject({
        title: built.title,
        summary: built.summary,
        severity: built.severity,
        status: built.status,
        service: { name: built.service },
        team: { name: built.team },
        createdBy: { name: nameOf(built.declaredBy) },
        severityConfirmed: built.severityConfirmed,
        responseAccess: built.responseAccess,
        createdAt: built.createdAt.toISOString(),
        updatedAt: built.updatedAt.toISOString(),
        resolvedAt: built.resolvedAt?.toISOString() ?? null,
        resolution: built.resolution,
      });
      expect(
        detail.responders.map(({ name, status, startedAt, completedAt }) => ({
          name,
          status,
          startedAt,
          completedAt,
        })),
      ).toEqual(
        built.responders.map((response) => ({
          name: nameOf(response.responder),
          status: response.completedAt ? 'COMPLETED' : 'INVESTIGATING',
          startedAt: response.startedAt.toISOString(),
          completedAt: response.completedAt?.toISOString() ?? null,
        })),
      );
      expect(
        timeline.map(
          ({ type, actor, createdAt, message, fromValue, toValue }) => ({
            type,
            actor: actor.name,
            createdAt,
            message,
            fromValue,
            toValue,
          }),
        ),
      ).toEqual(
        built.activity.map((entry) => ({
          type: entry.type,
          actor: nameOf(entry.actor),
          createdAt: entry.at.toISOString(),
          message: entry.message,
          fromValue: entry.fromValue,
          toValue: entry.toValue,
        })),
      );
    }

    expect(
      await prisma.organization.findUniqueOrThrow({
        where: { id: organizationId },
        select: { lastIncidentNumber: true },
      }),
    ).toEqual({ lastIncidentNumber: history.length });
  });

  it('should give each member exactly their own responses, most recent first', async () => {
    await demo.replace(anchor);

    for (const persona of DEV_PERSONAS) {
      const { id } = await membershipOf(persona.email);
      const pages = [];
      let cursor: string | undefined;

      do {
        // Each persona reading their own, which is what every member may do.
        const page = await incidents.memberResponses(
          organizationId,
          { membershipId: id, role: 'RESPONDER' },
          id,
          { cursor },
        );

        pages.push(...page.items);
        cursor = page.page.cursor ?? undefined;
      } while (cursor);

      const expected = history
        .flatMap((incident) =>
          incident.responders
            .filter((response) => response.responder === persona.email)
            .map((response) => ({ incident, response })),
        )
        .sort(
          (a, b) =>
            b.response.startedAt.getTime() - a.response.startedAt.getTime(),
        );

      expect(
        pages.map((item) => [item.incident.number, item.startedAt]),
      ).toEqual(
        expected.map(({ incident, response }) => [
          incident.number,
          response.startedAt.toISOString(),
        ]),
      );
    }
  });

  it('should leave work waiting on the right people', async () => {
    await demo.replace(anchor);

    const numberOf = (title: string) =>
      history.find((incident) => incident.title === title)!.number;
    const attentionOf = async (email: string) =>
      incidents.attention(organizationId, {
        membershipId: (await membershipOf(email)).id,
        role: (await membershipOf(email)).role,
      });
    const numbers = (list: { number: number }[] | undefined) =>
      (list ?? []).map((incident) => incident.number);

    const admin = await attentionOf('admin@example.com');
    const jordan = await attentionOf('jordan@example.com');
    const priya = await attentionOf('priya@example.com');

    expect(numbers(admin.manage?.readyToResolve)).toEqual([
      numberOf('Webhook retries backing up for some merchants'),
    ]);
    expect(numbers(jordan.respond?.needsYourTeam)).toEqual([
      numberOf('Transaction monitoring alerts delayed'),
    ]);
    expect(numbers(priya.respond?.yourResponses)).toEqual([
      numberOf('Elevated card declines from one acquirer'),
    ]);
  });

  it('should carry on through the application’s own workflow', async () => {
    await demo.replace(anchor);

    const declared = history.find(
      (incident) => incident.status === 'DECLARED',
    )!;
    const number = String(declared.number);
    const sam = await membershipOf('sam@example.com');
    const admin = await membershipOf('admin@example.com');

    const asSam = { membershipId: sam.id, role: sam.role };
    const asAdmin = { membershipId: admin.id, role: admin.role };

    await incidents.startResponse(organizationId, number, asSam);
    await incidents.completeResponse(organizationId, number, asSam);
    const resolved = await incidents.update(
      organizationId,
      number,
      { status: 'RESOLVED', resolution: 'Alert consumer restarted.' },
      asAdmin,
    );
    const next = await incidents.create(
      organizationId,
      { membershipId: admin.id, role: 'ADMIN' },
      {
        title: 'Declared after the demo history',
        serviceId: resolved.service.id,
        severity: 'SEV4',
      },
    );

    expect(resolved.status).toBe('RESOLVED');
    expect(next.number).toBe(history.length + 1);
  });

  it('should write the same history on every run, replacing whatever was there', async () => {
    const admin = await membershipOf('admin@example.com');
    const service = await prisma.service.findFirstOrThrow({
      where: { organizationId, name: 'Payment API' },
      select: { id: true },
    });

    await demo.replace(anchor);
    const first = await snapshot();

    await incidents.create(
      organizationId,
      { membershipId: admin.id, role: 'ADMIN' },
      {
        title: 'Made by hand',
        serviceId: service.id,
        severity: 'SEV3',
        saveAsKnownIssue: true,
      },
    );

    const second = await demo.replace(anchor);

    expect(second.removed).toBe(history.length + 1);
    expect(await snapshot()).toEqual(first);
    // The known issue saved by hand went with the incident that saved it.
    expect(
      await prisma.knownIssue.count({
        where: { organizationId, name: 'Made by hand' },
      }),
    ).toBe(0);
  });

  it('should keep a known issue for each recurring problem, with today tied in', async () => {
    await demo.replace(anchor);

    const built = buildDemoKnownIssues(history);
    const written = await prisma.knownIssue.findMany({
      where: { organizationId },
      select: {
        name: true,
        pendingReview: true,
        incidents: { select: { number: true }, orderBy: { number: 'asc' } },
      },
    });

    expect(written).toHaveLength(built.length);
    for (const issue of built) {
      expect(written).toContainEqual({
        name: issue.name,
        pendingReview: issue.pendingReview,
        incidents: issue.incidents.map((number) => ({ number })),
      });
    }

    // The active webhook incident is another time of an earlier problem.
    const admin = await membershipOf('admin@example.com');
    const webhooks = history.find(
      (incident) =>
        incident.title === 'Webhook retries backing up for some merchants',
    )!;
    const repeats = await incidents.repeats(
      organizationId,
      { membershipId: admin.id, role: 'ADMIN' },
      String(webhooks.number),
    );

    expect(repeats.knownIssue?.name).toBe(
      'Merchant webhook deliveries delayed',
    );
    expect(repeats.others.length).toBeGreaterThan(0);
    expect(repeats.others.every(({ status }) => status === 'RESOLVED')).toBe(
      true,
    );
  });

  it("should write the week's activity log, as the Admin reads it", async () => {
    await demo.replace(anchor);

    const activity = app.get(ActivityService);
    const changes = await activity.list(organizationId, { view: 'changes' });
    const security = await activity.list(organizationId, { view: 'security' });

    // Newest first: Sam's cover ended yesterday.
    expect(changes.entries[0]).toMatchObject({
      action: 'ROLE_CHANGED',
      actor: { name: 'Dev Admin' },
      subject: { type: 'MEMBERSHIP', name: 'Sam Okafor' },
    });
    expect(changes.areaCounts).toMatchObject({
      // Four this week, and the former member's removal, months ago.
      PEOPLE: 5,
      TEAMS: 2,
      SERVICES: 2,
      ORGANIZATION: 1,
    });

    // This morning: Priya's five wrong passwords read as one row, after the
    // block and before Priya's own sign-in.
    const morning = security.entries
      .filter((entry) => entry.actor.name === 'Priya Shah')
      .slice(0, 3);

    expect(
      morning.map((entry) => [entry.action, entry.repeat?.count ?? 1]),
    ).toEqual([
      ['SIGNED_IN', 1],
      ['SIGN_IN_BLOCKED', 1],
      ['SIGN_IN_FAILED', 5],
    ]);
    expect(security.securityTotals).toMatchObject({
      failedSignIns: 5,
      blocked: 1,
    });

    // The folded row in full points at what is real: the block, and where
    // Priya usually signs in from.
    const wrong = await activity.get(organizationId, morning[2]!.id);

    expect(wrong.attempts).toHaveLength(5);
    expect(wrong.next?.action).toBe('SIGN_IN_BLOCKED');
    expect(wrong.usualClient).toEqual({
      ipAddress: '10.0.4.15',
      browser: 'Chrome on Windows',
    });

    // Every subject is one the organization still has.
    const team = changes.entries.find(
      (entry) => entry.subject?.type === 'TEAM',
    );

    expect((await activity.get(organizationId, team!.id)).subjectNow).toEqual({
      exists: true,
      slug: 'risk',
    });
  });

  it('should keep a former member: her past responses, removed by the Admin after the last of them', async () => {
    await demo.replace(anchor);

    const maya = await prisma.membership.findFirstOrThrow({
      where: { organizationId, user: { email: 'maya@example.com' } },
      select: {
        id: true,
        removedAt: true,
        removedBy: { select: { name: true } },
        teamMemberships: { select: { id: true } },
        user: { select: { passwordHash: true } },
        incidentResponses: {
          select: { status: true, completedAt: true },
        },
      },
    });

    expect(maya.removedBy?.name).toBe('Dev Admin');
    expect(maya.teamMemberships).toEqual([]);
    // She never signs in to the demo.
    expect(maya.user.passwordHash).toBeNull();
    expect(maya.incidentResponses.length).toBeGreaterThan(0);
    for (const response of maya.incidentResponses) {
      expect(response.status).toBe('COMPLETED');
      expect(response.completedAt!.getTime()).toBeLessThan(
        maya.removedAt!.getTime(),
      );
    }

    // The timeline names her with no role: a former member.
    const respondedTo = await prisma.incidentResponder.findFirstOrThrow({
      where: { membershipId: maya.id },
      select: { incident: { select: { number: true } } },
    });
    const admin = await membershipOf('admin@example.com');
    const timeline = await incidents.timeline(
      organizationId,
      { membershipId: admin.id, role: admin.role },
      String(respondedTo.incident.number),
    );
    const hers = timeline.filter(({ actor }) => actor.name === 'Maya Torres');

    expect(hers.length).toBeGreaterThan(0);
    expect(hers.every(({ actor }) => actor.role === null)).toBe(true);

    // Running it again keeps one of her, still removed.
    await demo.replace(anchor);

    expect(
      await prisma.membership.count({
        where: { organizationId, user: { email: 'maya@example.com' } },
      }),
    ).toBe(1);
  });

  it('should touch no other organization', async () => {
    const user = await prisma.user.create({
      data: { email: 'owner@other.example.com', name: 'Other Owner' },
      select: { id: true },
    });
    const other = await prisma.organization.create({
      data: { name: 'Other', slug: 'other' },
      select: { id: true },
    });
    const membership = await prisma.membership.create({
      data: { organizationId: other.id, userId: user.id, role: 'ADMIN' },
      select: { id: true },
    });
    const team = await prisma.team.create({
      data: { organizationId: other.id, name: 'Ops', slug: 'ops' },
      select: { id: true },
    });
    const service = await prisma.service.create({
      data: {
        organizationId: other.id,
        name: 'Web',
        slug: 'web',
        ownerTeamId: team.id,
      },
      select: { id: true },
    });

    await incidents.create(
      other.id,
      { membershipId: membership.id, role: 'ADMIN' },
      { title: 'Theirs', serviceId: service.id, severity: 'SEV2' },
    );

    await prisma.activityEntry.create({
      data: {
        organizationId: other.id,
        action: 'TEAM_CREATED',
        area: 'TEAMS',
        actorId: user.id,
        actorName: 'Other Owner',
      },
    });

    await demo.replace(anchor);

    expect(
      await prisma.activityEntry.count({ where: { organizationId: other.id } }),
    ).toBe(1);
    expect(
      await prisma.incident.findMany({
        where: { organizationId: other.id },
        select: { number: true, title: true },
      }),
    ).toEqual([{ number: 1, title: 'Theirs' }]);
    expect(
      await prisma.organization.findUniqueOrThrow({
        where: { id: other.id },
        select: { lastIncidentNumber: true },
      }),
    ).toEqual({ lastIncidentNumber: 1 });
  });

  it('should refuse an organization that no longer matches, changing nothing', async () => {
    await demo.replace(anchor);
    const before = await snapshot();

    await prisma.teamMembership.deleteMany({
      where: {
        team: { organizationId, name: 'Risk' },
        membership: { user: { email: 'sam@example.com' } },
      },
    });

    const refused = demo.replace(anchor);

    await expect(refused).rejects.toBeInstanceOf(DemoOrganizationMismatch);
    await expect(refused).rejects.toThrow('sam@example.com is not on Risk');
    expect(await snapshot()).toEqual(before);
  });
});
