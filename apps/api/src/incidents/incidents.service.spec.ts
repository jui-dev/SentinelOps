import { HttpException } from '@nestjs/common';

import type { PrismaService } from '../database/prisma.service.js';
import type { NotificationsWriter } from '../notifications/notifications.writer.js';
import { Prisma } from '../generated/prisma/client.js';
import { ServicesErrorCode } from '../services/services.errors.js';
import { TeamsErrorCode } from '../teams/teams.errors.js';
import { TenancyErrorCode } from '../tenancy/tenancy.errors.js';
import { IncidentsErrorCode } from './incidents.errors.js';
import { incidentReadScope } from './incidents.scope.js';
import {
  decodeActiveCursor,
  decodeHistoryCursor,
  decodeResolvedCursor,
  decodeResponseCursor,
  encodeActiveCursor,
  encodeHistoryCursor,
  encodeResponseCursor,
  INCIDENT_PAGE_SIZE,
  IncidentsService,
} from './incidents.service.js';

const ORG = '0199a1b2-c3d4-7000-8000-00000000000a';
const MEMBERSHIP = '0199a1b2-c3d4-7000-8000-0000000000aa';
const OTHER_MEMBERSHIP = '0199a1b2-c3d4-7000-8000-0000000000ab';
const USER = '0199a1b2-c3d4-7000-8000-000000000001';
const TEAM = '0199a1b2-c3d4-7000-8000-0000000000c1';
const OTHER_TEAM = '0199a1b2-c3d4-7000-8000-0000000000c2';
const SERVICE = '0199a1b2-c3d4-7000-8000-0000000000d1';
const CREATED = new Date('2026-09-18T12:00:00.000Z');
const ACTOR = { membershipId: MEMBERSHIP };
/** A resolution, with the note every one requires. */
const RESOLVE = { status: 'RESOLVED', resolution: 'Rolled back.' } as const;
const MEMBER_ACTOR = { membershipId: MEMBERSHIP, role: 'MEMBER' as const };
const ADMIN_ACTOR = { membershipId: MEMBERSHIP, role: 'ADMIN' as const };

const activityRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'activity-1',
  incidentId: 'incident-1',
  type: 'UPDATE' as const,
  message: 'Investigating elevated database latency.',
  fromValue: null,
  toValue: null,
  createdAt: CREATED,
  actor: { id: USER, name: 'Ada Lovelace' },
  ...overrides,
});

const incidentRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'incident-1',
  number: 1,
  title: 'Card payments failing',
  summary: null,
  severity: 'SEV1' as const,
  status: 'INVESTIGATING' as const,
  createdAt: CREATED,
  updatedAt: CREATED,
  resolvedAt: null,
  service: {
    id: SERVICE,
    name: 'Payment API',
    slug: 'payment-api',
    criticality: 'CRITICAL' as const,
    archivedAt: null,
  },
  team: { id: TEAM, name: 'Payments', slug: 'payments' },
  createdBy: { id: USER, name: 'Ada Lovelace' },
  responders: [],
  ...overrides,
});

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
    organization: {
      update: vi.fn().mockResolvedValue({ lastIncidentNumber: 7 }),
    },
    membership: { findFirst: vi.fn().mockResolvedValue({ userId: USER }) },
    team: {
      findFirst: vi
        .fn()
        .mockResolvedValue({ id: OTHER_TEAM, name: 'Platform' }),
    },
    incident: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(incidentRow()),
      create: vi.fn().mockResolvedValue(incidentRow({ number: 7 })),
      update: vi.fn().mockResolvedValue(incidentRow()),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      // Both the values update() reads under the lock and the incident the
      // response routes answer with.
      findFirstOrThrow: vi.fn().mockResolvedValue(incidentRow()),
    },
    incidentResponder: {
      count: vi.fn().mockResolvedValue(0),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'responder-1' }),
      update: vi.fn().mockResolvedValue({ id: 'responder-1' }),
    },
    incidentActivity: {
      create: vi.fn().mockResolvedValue(activityRow()),
      createMany: vi.fn().mockResolvedValue({ count: 1 }),
      // Each entry as written, with an id, as the database returns it.
      createManyAndReturn: vi.fn(
        ({ data }: { data: { type: string; createdAt: Date }[] }) =>
          data.map(({ type, createdAt }, index) => ({
            id: `entry-${index}`,
            type,
            createdAt,
          })),
      ),
    },
    $queryRaw: vi
      .fn()
      .mockResolvedValue([{ owner_team_id: TEAM, archived_at: null }]),
    $transaction: vi.fn(),
  };

  prisma.$transaction.mockImplementation((work: (tx: unknown) => unknown) =>
    work(prisma),
  );

  const notifications = {
    incidentActivities: vi.fn().mockResolvedValue(0),
  };

  const service = new IncidentsService(
    prisma as unknown as PrismaService,
    notifications as unknown as NotificationsWriter,
  );

  return { service, prisma, notifications };
};

const expectCode = async (
  promise: Promise<unknown>,
  status: number,
  code: string,
) => {
  const caught = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );

  expect(caught).toBeInstanceOf(HttpException);
  expect((caught as HttpException).getStatus()).toBe(status);
  expect((caught as HttpException).errorCode).toBe(code);
};

const declaration = {
  title: 'Card payments failing',
  serviceId: SERVICE,
  severity: 'SEV1' as const,
};

describe('IncidentsService', () => {
  describe('create', () => {
    it('should allocate the number, resolve the declarer, lock the service, then insert the owner as the responsible team', async () => {
      const { service, prisma } = serviceWith();

      const created = await service.create(
        ORG,
        { membershipId: MEMBERSHIP },
        declaration,
      );

      expect(prisma.organization.update).toHaveBeenCalledWith({
        where: { id: ORG, deletedAt: null },
        data: { lastIncidentNumber: { increment: 1 } },
        select: { lastIncidentNumber: true },
      });
      expect(prisma.membership.findFirst).toHaveBeenCalledWith({
        where: {
          id: MEMBERSHIP,
          organizationId: ORG,
          user: { deletedAt: null },
        },
        select: { userId: true },
      });
      expect(prisma.incident.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            organizationId: ORG,
            number: 7,
            title: 'Card payments failing',
            summary: null,
            serviceId: SERVICE,
            teamId: TEAM,
            severity: 'SEV1',
            createdById: USER,
          },
        }),
      );
      expect(created.number).toBe(7);
    });

    it('should record the declaration on the timeline, attributed to the declarer', async () => {
      const { service, prisma } = serviceWith();

      await service.create(ORG, ACTOR, declaration);

      expect(prisma.incidentActivity.create).toHaveBeenCalledWith({
        data: {
          organizationId: ORG,
          incidentId: 'incident-1',
          type: 'DECLARED',
          actorId: USER,
          toValue: 'SEV1',
          createdAt: CREATED,
        },
        select: { id: true, createdAt: true },
      });
    });

    it('should lock the service row with a parameterized FOR SHARE read scoped by organization', async () => {
      const { service, prisma } = serviceWith();

      await service.create(ORG, { membershipId: MEMBERSHIP }, declaration);

      const [strings, ...values] = prisma.$queryRaw.mock.calls[0] as [
        TemplateStringsArray,
        ...unknown[],
      ];
      const sql = strings.join('?');

      expect(sql).toMatch(/FOR SHARE/);
      expect(sql).toMatch(/organization_id = \?::uuid/);
      expect(values).toEqual([ORG, SERVICE]);
    });

    it('should take the organization lock before the service lock', async () => {
      const { service, prisma } = serviceWith();

      await service.create(ORG, { membershipId: MEMBERSHIP }, declaration);

      expect(
        prisma.organization.update.mock.invocationCallOrder[0],
      ).toBeLessThan(prisma.$queryRaw.mock.invocationCallOrder[0]);
    });

    it('should answer an organization deleted since admission with 404', async () => {
      const { service, prisma } = serviceWith();
      prisma.organization.update.mockRejectedValue(knownError('P2025'));

      await expectCode(
        service.create(ORG, { membershipId: MEMBERSHIP }, declaration),
        404,
        TenancyErrorCode.ORGANIZATION_NOT_FOUND,
      );
      expect(prisma.incident.create).not.toHaveBeenCalled();
    });

    it('should answer a declarer no longer in the organization as admission would', async () => {
      const { service, prisma } = serviceWith();
      prisma.membership.findFirst.mockResolvedValue(null);

      await expectCode(
        service.create(ORG, { membershipId: MEMBERSHIP }, declaration),
        404,
        TenancyErrorCode.ORGANIZATION_NOT_FOUND,
      );
      expect(prisma.incident.create).not.toHaveBeenCalled();
    });

    it('should answer a service not in the organization with 404', async () => {
      const { service, prisma } = serviceWith();
      prisma.$queryRaw.mockResolvedValue([]);

      await expectCode(
        service.create(ORG, { membershipId: MEMBERSHIP }, declaration),
        404,
        ServicesErrorCode.SERVICE_NOT_FOUND,
      );
      expect(prisma.incident.create).not.toHaveBeenCalled();
    });

    it('should refuse an archived service with 409', async () => {
      const { service, prisma } = serviceWith();
      prisma.$queryRaw.mockResolvedValue([
        { owner_team_id: TEAM, archived_at: CREATED },
      ]);

      await expectCode(
        service.create(ORG, { membershipId: MEMBERSHIP }, declaration),
        409,
        ServicesErrorCode.SERVICE_ARCHIVED,
      );
      expect(prisma.incident.create).not.toHaveBeenCalled();
    });

    it('should answer the service key refusing the insert with 404', async () => {
      const { service, prisma } = serviceWith();
      prisma.incident.create.mockRejectedValue(
        knownError('P2003', 'incidents_organization_id_service_id_fkey'),
      );

      await expectCode(
        service.create(ORG, { membershipId: MEMBERSHIP }, declaration),
        404,
        ServicesErrorCode.SERVICE_NOT_FOUND,
      );
    });

    it('should not disguise a team key violation: the lock makes it unreachable, so it is a fault', async () => {
      const { service, prisma } = serviceWith();
      const violation = knownError(
        'P2003',
        'incidents_organization_id_team_id_fkey',
      );
      prisma.incident.create.mockRejectedValue(violation);

      await expect(
        service.create(ORG, { membershipId: MEMBERSHIP }, declaration),
      ).rejects.toBe(violation);
      expect(prisma.$transaction).toHaveBeenCalledOnce();
    });
  });

  describe('update', () => {
    it('should update through the (organization, number) key, re-asserting it is unresolved', async () => {
      const { service, prisma } = serviceWith();

      await service.update(ORG, '1', { severity: 'SEV2' }, ADMIN_ACTOR);

      expect(prisma.incident.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId_number: { organizationId: ORG, number: 1 },
            status: { not: 'RESOLVED' },
            organization: { deletedAt: null },
          },
          data: expect.objectContaining({
            severity: 'SEV2',
            resolvedAt: undefined,
          }),
        }),
      );
    });

    it('should read the previous values only under the row lock', async () => {
      const { service, prisma } = serviceWith();

      await service.update(ORG, '1', { severity: 'SEV2' }, ADMIN_ACTOR);

      expect(
        prisma.incident.updateMany.mock.invocationCallOrder[0],
      ).toBeLessThan(
        prisma.incident.findFirstOrThrow.mock.invocationCallOrder[0],
      );
    });

    it('should record each severity or status that changes, from and to, attributed to the actor', async () => {
      const { service, prisma } = serviceWith();

      await service.update(
        ORG,
        '1',
        { severity: 'SEV2', status: 'RESOLVED', resolution: 'Rolled back.' },
        ADMIN_ACTOR,
      );

      expect(prisma.incidentActivity.createManyAndReturn).toHaveBeenCalledWith({
        data: [
          {
            organizationId: ORG,
            incidentId: 'incident-1',
            actorId: USER,
            type: 'SEVERITY_CHANGED',
            fromValue: 'SEV1',
            toValue: 'SEV2',
            createdAt: expect.any(Date),
          },
          {
            organizationId: ORG,
            incidentId: 'incident-1',
            actorId: USER,
            type: 'STATUS_CHANGED',
            fromValue: 'INVESTIGATING',
            toValue: 'RESOLVED',
            // The resolution's entry carries the note.
            message: 'Rolled back.',
            createdAt: expect.any(Date),
          },
        ],
        select: { id: true, type: true, createdAt: true },
      });
    });

    it('should write the resolution note with resolvedAt, in the same write', async () => {
      const { service, prisma } = serviceWith();

      await service.update(
        ORG,
        '1',
        { status: 'RESOLVED', resolution: 'Rolled back.' },
        ADMIN_ACTOR,
      );

      expect(prisma.incident.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'RESOLVED',
            resolvedAt: expect.any(Date),
            resolution: 'Rolled back.',
          }),
        }),
      );
    });

    it('should write no resolution on a change that does not resolve', async () => {
      const { service, prisma } = serviceWith();

      await service.update(ORG, '1', { severity: 'SEV2' }, ADMIN_ACTOR);

      expect(prisma.incident.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            resolvedAt: undefined,
            resolution: undefined,
          }),
        }),
      );
    });

    it('should record nothing, and look no actor up, when nothing recorded changes', async () => {
      const { service, prisma } = serviceWith();

      await service.update(
        ORG,
        '1',
        { severity: 'SEV1', title: 'Renamed' },
        ADMIN_ACTOR,
      );

      expect(
        prisma.incidentActivity.createManyAndReturn,
      ).not.toHaveBeenCalled();
      expect(prisma.membership.findFirst).not.toHaveBeenCalled();
    });

    it('should set resolvedAt only when resolving', async () => {
      const { service, prisma } = serviceWith();

      await service.update(ORG, '1', { severity: 'SEV2' }, ADMIN_ACTOR);
      await service.update(ORG, '1', RESOLVE, ADMIN_ACTOR);

      expect(
        prisma.incident.update.mock.calls[0][0].data.resolvedAt,
      ).toBeUndefined();
      expect(
        prisma.incident.update.mock.calls[1][0].data.resolvedAt,
      ).toBeInstanceOf(Date);
    });

    it('should count investigating responders under the row lock before resolving', async () => {
      const { service, prisma } = serviceWith();

      await service.update(ORG, '1', RESOLVE, ADMIN_ACTOR);

      expect(prisma.incidentResponder.count).toHaveBeenCalledWith({
        where: {
          organizationId: ORG,
          incidentId: 'incident-1',
          status: 'INVESTIGATING',
        },
      });
      expect(
        prisma.incident.updateMany.mock.invocationCallOrder[0],
      ).toBeLessThan(
        prisma.incidentResponder.count.mock.invocationCallOrder[0],
      );
    });

    it('should refuse resolving while a responder is investigating, applying nothing in the request', async () => {
      const { service, prisma } = serviceWith();
      prisma.incidentResponder.count.mockResolvedValue(2);

      await expectCode(
        service.update(
          ORG,
          '1',
          { ...RESOLVE, severity: 'SEV2', teamId: OTHER_TEAM },
          ADMIN_ACTOR,
        ),
        409,
        IncidentsErrorCode.RESPONDERS_STILL_INVESTIGATING,
      );
      expect(prisma.team.findFirst).not.toHaveBeenCalled();
      expect(prisma.incident.update).not.toHaveBeenCalled();
      expect(
        prisma.incidentActivity.createManyAndReturn,
      ).not.toHaveBeenCalled();
    });

    it('should not count responders for a change that is not a resolution', async () => {
      const { service, prisma } = serviceWith();

      await service.update(ORG, '1', { severity: 'SEV2' }, ADMIN_ACTOR);

      expect(prisma.incidentResponder.count).not.toHaveBeenCalled();
    });

    it('should refuse resolving a declared incident with 409, applying nothing in the request', async () => {
      const { service, prisma } = serviceWith();
      prisma.incident.findFirstOrThrow.mockResolvedValue(
        incidentRow({ status: 'DECLARED' }),
      );

      await expectCode(
        service.update(
          ORG,
          '1',
          { ...RESOLVE, severity: 'SEV2', teamId: OTHER_TEAM },
          ADMIN_ACTOR,
        ),
        409,
        IncidentsErrorCode.INVALID_STATUS_TRANSITION,
      );
      expect(prisma.team.findFirst).not.toHaveBeenCalled();
      expect(prisma.incident.update).not.toHaveBeenCalled();
      expect(
        prisma.incidentActivity.createManyAndReturn,
      ).not.toHaveBeenCalled();
    });

    it('should refuse any change to a resolved incident with 409 and write nothing', async () => {
      const { service, prisma } = serviceWith();
      prisma.incident.findFirst.mockResolvedValue({ status: 'RESOLVED' });

      await expectCode(
        service.update(ORG, '1', { title: 'Typo fixed' }, ADMIN_ACTOR),
        409,
        IncidentsErrorCode.INCIDENT_RESOLVED,
      );
      expect(prisma.incident.update).not.toHaveBeenCalled();
    });

    it('should record a reassignment as TEAM_CHANGED, naming both teams as they are now', async () => {
      const { service, prisma } = serviceWith();

      await service.update(ORG, '1', { teamId: OTHER_TEAM }, ADMIN_ACTOR);

      expect(prisma.team.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: OTHER_TEAM,
            organizationId: ORG,
            organization: { deletedAt: null },
          },
        }),
      );
      expect(prisma.incident.update.mock.calls[0][0].data.teamId).toBe(
        OTHER_TEAM,
      );
      expect(prisma.incidentActivity.createManyAndReturn).toHaveBeenCalledWith({
        data: [
          {
            organizationId: ORG,
            incidentId: 'incident-1',
            actorId: USER,
            type: 'TEAM_CHANGED',
            fromValue: 'Payments',
            toValue: 'Platform',
            createdAt: expect.any(Date),
          },
        ],
        select: { id: true, type: true, createdAt: true },
      });
    });

    it('should record nothing when reassigned to the team it already has', async () => {
      const { service, prisma } = serviceWith();
      prisma.team.findFirst.mockResolvedValue({ id: TEAM, name: 'Payments' });

      await service.update(ORG, '1', { teamId: TEAM }, ADMIN_ACTOR);

      expect(
        prisma.incidentActivity.createManyAndReturn,
      ).not.toHaveBeenCalled();
      expect(prisma.membership.findFirst).not.toHaveBeenCalled();
    });

    it('should judge the incident before the team', async () => {
      const { service, prisma } = serviceWith();
      prisma.incident.findFirst.mockResolvedValue(null);
      prisma.team.findFirst.mockResolvedValue(null);

      await expectCode(
        service.update(ORG, '1', { teamId: OTHER_TEAM }, ADMIN_ACTOR),
        404,
        IncidentsErrorCode.INCIDENT_NOT_FOUND,
      );
      expect(prisma.team.findFirst).not.toHaveBeenCalled();
    });

    it('should answer a team outside the organization with 404 and change nothing', async () => {
      const { service, prisma } = serviceWith();
      prisma.team.findFirst.mockResolvedValue(null);

      await expectCode(
        service.update(ORG, '1', { teamId: OTHER_TEAM }, ADMIN_ACTOR),
        404,
        TeamsErrorCode.TEAM_NOT_FOUND,
      );
      expect(prisma.incident.update).not.toHaveBeenCalled();
    });

    it('should answer the team key refusing the write with 404', async () => {
      const { service, prisma } = serviceWith();
      prisma.incident.update.mockRejectedValue(
        knownError('P2003', 'incidents_organization_id_team_id_fkey'),
      );

      await expectCode(
        service.update(ORG, '1', { teamId: OTHER_TEAM }, ADMIN_ACTOR),
        404,
        TeamsErrorCode.TEAM_NOT_FOUND,
      );
    });

    it('should answer an update that lost a race to a resolution with 409', async () => {
      const { service, prisma } = serviceWith();
      prisma.incident.update.mockRejectedValue(knownError('P2025'));
      prisma.incident.findFirst
        .mockResolvedValueOnce({ status: 'INVESTIGATING' })
        .mockResolvedValueOnce({ status: 'RESOLVED' });

      await expectCode(
        service.update(ORG, '1', RESOLVE, ADMIN_ACTOR),
        409,
        IncidentsErrorCode.INCIDENT_RESOLVED,
      );
    });

    it('should answer an update whose incident vanished with 404', async () => {
      const { service, prisma } = serviceWith();
      prisma.incident.update.mockRejectedValue(knownError('P2025'));
      prisma.incident.findFirst
        .mockResolvedValueOnce({ status: 'INVESTIGATING' })
        .mockResolvedValueOnce(null);

      await expectCode(
        service.update(ORG, '1', RESOLVE, ADMIN_ACTOR),
        404,
        IncidentsErrorCode.INCIDENT_NOT_FOUND,
      );
    });

    it.each(['0', 'abc', '2147483648', '1.5'])(
      'should answer the malformed number %j with 404 without querying',
      async (number) => {
        const { service, prisma } = serviceWith();

        await expectCode(
          service.update(ORG, number, { title: 'x' }, ADMIN_ACTOR),
          404,
          IncidentsErrorCode.INCIDENT_NOT_FOUND,
        );
        expect(prisma.$transaction).not.toHaveBeenCalled();
      },
    );
  });

  describe('postUpdate', () => {
    const update = { message: 'Connection pool exhaustion identified.' };

    it('should lock the active incident, then record the update attributed to the actor', async () => {
      const { service, prisma } = serviceWith();
      prisma.incidentResponder.findFirst.mockResolvedValue({
        id: 'responder-1',
        status: 'INVESTIGATING',
      });
      prisma.incidentActivity.create.mockResolvedValue(
        activityRow({ message: update.message }),
      );

      const posted = await service.postUpdate(ORG, '1', update, MEMBER_ACTOR);

      expect(prisma.incident.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'incident-1',
            organizationId: ORG,
            status: { not: 'RESOLVED' },
          },
        }),
      );
      expect(prisma.incidentActivity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            organizationId: ORG,
            incidentId: 'incident-1',
            type: 'UPDATE',
            actorId: USER,
            message: update.message,
            createdAt: expect.any(Date),
          },
        }),
      );
      expect(posted).toStrictEqual({
        id: 'activity-1',
        type: 'UPDATE',
        message: update.message,
        fromValue: null,
        toValue: null,
        actor: { id: USER, name: 'Ada Lovelace' },
        createdAt: CREATED.toISOString(),
      });
    });

    it('should admit a member only once the incident is locked, and only while their own response is investigating', async () => {
      const { service, prisma } = serviceWith();
      prisma.incidentResponder.findFirst.mockResolvedValue({
        id: 'responder-1',
        status: 'INVESTIGATING',
      });
      prisma.incidentActivity.create.mockResolvedValue(activityRow());

      await service.postUpdate(ORG, '1', update, MEMBER_ACTOR);

      expect(prisma.incidentResponder.findFirst).toHaveBeenCalledWith({
        where: {
          organizationId: ORG,
          incidentId: 'incident-1',
          membershipId: MEMBERSHIP,
        },
        select: { id: true, status: true },
      });
      expect(
        prisma.incident.updateMany.mock.invocationCallOrder[0],
      ).toBeLessThan(
        prisma.incidentResponder.findFirst.mock.invocationCallOrder[0],
      );
      expect(prisma.incidentActivity.create).toHaveBeenCalled();
    });

    it('should refuse a member who has not started investigating with 403 and write nothing', async () => {
      const { service, prisma } = serviceWith();

      await expectCode(
        service.postUpdate(ORG, '1', update, MEMBER_ACTOR),
        403,
        IncidentsErrorCode.START_INVESTIGATING_FIRST,
      );
      expect(prisma.incidentActivity.create).not.toHaveBeenCalled();
    });

    it('should refuse a member whose response is complete with 409 and write nothing', async () => {
      const { service, prisma } = serviceWith();
      prisma.incidentResponder.findFirst.mockResolvedValue({
        id: 'responder-1',
        status: 'COMPLETED',
      });

      await expectCode(
        service.postUpdate(ORG, '1', update, MEMBER_ACTOR),
        409,
        IncidentsErrorCode.RESPONSE_ALREADY_COMPLETED,
      );
      expect(prisma.incidentActivity.create).not.toHaveBeenCalled();
    });

    it('should let the Admin post to any incident without responding', async () => {
      const { service, prisma } = serviceWith();

      await service.postUpdate(ORG, '1', update, ADMIN_ACTOR);

      expect(prisma.incidentResponder.findFirst).not.toHaveBeenCalled();
      expect(prisma.incidentActivity.create).toHaveBeenCalled();
    });

    it('should refuse a resolved incident with 409 and write nothing', async () => {
      const { service, prisma } = serviceWith();
      prisma.incident.findFirst.mockResolvedValue({
        id: 'incident-1',
        status: 'RESOLVED',
      });

      await expectCode(
        service.postUpdate(ORG, '1', update, MEMBER_ACTOR),
        409,
        IncidentsErrorCode.INCIDENT_RESOLVED,
      );
      expect(prisma.incidentActivity.create).not.toHaveBeenCalled();
    });

    it('should answer a missing incident with 404 and write nothing', async () => {
      const { service, prisma } = serviceWith();
      prisma.incident.findFirst.mockResolvedValue(null);

      await expectCode(
        service.postUpdate(ORG, '1', update, MEMBER_ACTOR),
        404,
        IncidentsErrorCode.INCIDENT_NOT_FOUND,
      );
      expect(prisma.incidentActivity.create).not.toHaveBeenCalled();
    });
  });

  describe('finding the incident to change', () => {
    it("should look only among a member's own incidents, before any rule of the change", async () => {
      const { service, prisma } = serviceWith();
      prisma.incident.findFirst.mockResolvedValueOnce(null);

      await expectCode(
        service.postUpdate(ORG, '1', { message: 'x' }, MEMBER_ACTOR),
        404,
        IncidentsErrorCode.INCIDENT_NOT_FOUND,
      );
      expect(prisma.incident.findFirst.mock.calls[0][0].where).toEqual({
        AND: [
          { organizationId: ORG, organization: { deletedAt: null } },
          incidentReadScope(MEMBER_ACTOR),
          { number: 1 },
        ],
      });
      expect(prisma.incidentResponder.findFirst).not.toHaveBeenCalled();
      expect(prisma.incident.updateMany).not.toHaveBeenCalled();
    });

    it('should look among every incident for whoever runs their lifecycles', async () => {
      const { service, prisma } = serviceWith();

      await service.update(ORG, '1', { title: 'Renamed' }, ADMIN_ACTOR);

      expect(prisma.incident.findFirst.mock.calls[0][0].where).toEqual({
        AND: [
          { organizationId: ORG, organization: { deletedAt: null } },
          { number: 1 },
        ],
      });
    });
  });

  describe('startResponse', () => {
    it('should lock the incident, check the team, create the response, and move a DECLARED incident, recording both', async () => {
      const { service, prisma } = serviceWith();
      prisma.incident.findFirst
        .mockResolvedValueOnce({ id: 'incident-1', status: 'DECLARED' })
        .mockResolvedValueOnce({ id: 'incident-1' });

      await service.startResponse(ORG, '1', MEMBER_ACTOR);

      // lockActive's touch, then the move conditional on DECLARED.
      expect(prisma.incident.updateMany).toHaveBeenLastCalledWith({
        where: { id: 'incident-1', organizationId: ORG, status: 'DECLARED' },
        data: { status: 'INVESTIGATING' },
      });
      expect(prisma.incident.findFirst).toHaveBeenLastCalledWith({
        where: {
          id: 'incident-1',
          organizationId: ORG,
          team: { memberships: { some: { membershipId: MEMBERSHIP } } },
        },
        select: { id: true },
      });
      expect(prisma.incidentResponder.create).toHaveBeenCalledWith({
        data: {
          organizationId: ORG,
          incidentId: 'incident-1',
          membershipId: MEMBERSHIP,
          startedAt: expect.any(Date),
        },
        select: { id: true },
      });

      const [{ data }] = prisma.incidentActivity.createMany.mock.calls[0];

      expect(data).toEqual([
        expect.objectContaining({
          type: 'RESPONSE_STARTED',
          actorId: USER,
        }),
        expect.objectContaining({
          type: 'STATUS_CHANGED',
          fromValue: 'DECLARED',
          toValue: 'INVESTIGATING',
          actorId: USER,
        }),
      ]);
      // The status change follows the response that caused it.
      expect(data[1].createdAt.getTime()).toBeGreaterThan(
        data[0].createdAt.getTime(),
      );
    });

    it('should record no status change when the incident is already INVESTIGATING', async () => {
      const { service, prisma } = serviceWith();
      prisma.incident.updateMany
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 });

      await service.startResponse(ORG, '1', MEMBER_ACTOR);

      expect(prisma.incidentActivity.createMany).toHaveBeenCalledWith({
        data: [expect.objectContaining({ type: 'RESPONSE_STARTED' })],
      });
    });

    it('should change and record nothing for a responder already investigating, whatever their team', async () => {
      const { service, prisma } = serviceWith();
      prisma.incidentResponder.findFirst.mockResolvedValue({
        id: 'responder-1',
        status: 'INVESTIGATING',
      });

      await service.startResponse(ORG, '1', MEMBER_ACTOR);

      expect(prisma.incidentResponder.create).not.toHaveBeenCalled();
      expect(prisma.incidentActivity.createMany).not.toHaveBeenCalled();
      // Only lockActive's read: the team is not judged.
      expect(prisma.incident.findFirst).toHaveBeenCalledTimes(1);
    });

    it('should refuse restarting a completed response with 409', async () => {
      const { service, prisma } = serviceWith();
      prisma.incidentResponder.findFirst.mockResolvedValue({
        id: 'responder-1',
        status: 'COMPLETED',
      });

      await expectCode(
        service.startResponse(ORG, '1', MEMBER_ACTOR),
        409,
        IncidentsErrorCode.RESPONSE_ALREADY_COMPLETED,
      );
      expect(prisma.incidentResponder.create).not.toHaveBeenCalled();
    });

    it('should refuse a member not on the responsible team with 403 and write nothing', async () => {
      const { service, prisma } = serviceWith();
      prisma.incident.findFirst
        .mockResolvedValueOnce({ id: 'incident-1', status: 'DECLARED' })
        .mockResolvedValueOnce(null);

      await expectCode(
        service.startResponse(ORG, '1', MEMBER_ACTOR),
        403,
        IncidentsErrorCode.NOT_ON_RESPONSIBLE_TEAM,
      );
      expect(prisma.incidentResponder.create).not.toHaveBeenCalled();
      expect(prisma.incidentActivity.createMany).not.toHaveBeenCalled();
    });

    it('should refuse a resolved incident with 409', async () => {
      const { service, prisma } = serviceWith();
      prisma.incident.findFirst.mockResolvedValue({
        id: 'incident-1',
        status: 'RESOLVED',
      });

      await expectCode(
        service.startResponse(ORG, '1', MEMBER_ACTOR),
        409,
        IncidentsErrorCode.INCIDENT_RESOLVED,
      );
      expect(prisma.incidentResponder.create).not.toHaveBeenCalled();
    });

    it('should answer the incident with its responders', async () => {
      const { service, prisma } = serviceWith();
      const started = new Date('2026-09-18T12:10:00.000Z');
      prisma.incident.findFirstOrThrow.mockResolvedValue(
        incidentRow({
          responders: [
            {
              status: 'INVESTIGATING',
              startedAt: started,
              completedAt: null,
              membership: { id: MEMBERSHIP, user: { name: 'Priya Shah' } },
            },
          ],
        }),
      );

      const incident = await service.startResponse(ORG, '1', MEMBER_ACTOR);

      expect(incident.responders).toStrictEqual([
        {
          membershipId: MEMBERSHIP,
          name: 'Priya Shah',
          status: 'INVESTIGATING',
          startedAt: started.toISOString(),
          completedAt: null,
        },
      ]);
    });
  });

  describe('completeResponse', () => {
    it("should complete the caller's own investigating response, recording it, and resolve nothing", async () => {
      const { service, prisma } = serviceWith();
      prisma.incidentResponder.findFirst.mockResolvedValue({
        id: 'responder-1',
        status: 'INVESTIGATING',
      });

      await service.completeResponse(ORG, '1', MEMBER_ACTOR);

      expect(prisma.incidentResponder.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: ORG,
            incidentId: 'incident-1',
            membershipId: MEMBERSHIP,
          },
        }),
      );
      expect(prisma.incidentResponder.update).toHaveBeenCalledWith({
        where: { id: 'responder-1' },
        data: { status: 'COMPLETED', completedAt: expect.any(Date) },
        select: { id: true },
      });
      expect(prisma.incidentActivity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            type: 'RESPONSE_COMPLETED',
            actorId: USER,
          }),
        }),
      );
      expect(prisma.incident.update).not.toHaveBeenCalled();
      // No team check: the response governs, not the team.
      expect(prisma.incident.findFirst).toHaveBeenCalledTimes(1);
    });

    it('should change and record nothing for a response already complete', async () => {
      const { service, prisma } = serviceWith();
      prisma.incidentResponder.findFirst.mockResolvedValue({
        id: 'responder-1',
        status: 'COMPLETED',
      });

      await service.completeResponse(ORG, '1', MEMBER_ACTOR);

      expect(prisma.incidentResponder.update).not.toHaveBeenCalled();
      expect(prisma.incidentActivity.create).not.toHaveBeenCalled();
    });

    it('should refuse completing a response never started with 409', async () => {
      const { service, prisma } = serviceWith();

      await expectCode(
        service.completeResponse(ORG, '1', MEMBER_ACTOR),
        409,
        IncidentsErrorCode.NOT_INVESTIGATING,
      );
      expect(prisma.incidentActivity.create).not.toHaveBeenCalled();
    });

    it('should refuse a resolved incident with 409', async () => {
      const { service, prisma } = serviceWith();
      prisma.incident.findFirst.mockResolvedValue({
        id: 'incident-1',
        status: 'RESOLVED',
      });

      await expectCode(
        service.completeResponse(ORG, '1', MEMBER_ACTOR),
        409,
        IncidentsErrorCode.INCIDENT_RESOLVED,
      );
      expect(prisma.incidentResponder.update).not.toHaveBeenCalled();
    });
  });

  describe('notifications', () => {
    const responder = (
      membershipId: string,
      status: 'INVESTIGATING' | 'COMPLETED',
    ) => ({
      status,
      startedAt: CREATED,
      completedAt: status === 'COMPLETED' ? CREATED : null,
      membership: { id: membershipId, user: { name: 'Priya Shah' } },
    });

    it('should report a declaration once, at its entry and its time, to the responsible team', async () => {
      const { service, prisma, notifications } = serviceWith();
      prisma.incidentActivity.create.mockResolvedValue({
        id: 'declared-1',
        createdAt: CREATED,
      });

      await service.create(ORG, ACTOR, declaration);

      expect(notifications.incidentActivities).toHaveBeenCalledExactlyOnceWith(
        prisma,
        {
          organizationId: ORG,
          incidentId: 'incident-1',
          teamId: TEAM,
          actor: { userId: USER, membershipId: MEMBERSHIP },
          events: [
            {
              type: 'INCIDENT_DECLARED',
              activityId: 'declared-1',
              createdAt: CREATED,
            },
          ],
        },
      );
    });

    it('should report every entry one change records, each as its own event, against the team it now has', async () => {
      const { service, prisma, notifications } = serviceWith();
      prisma.incident.update.mockResolvedValue(
        incidentRow({
          team: { id: OTHER_TEAM, name: 'Platform', slug: 'platform' },
        }),
      );

      await service.update(
        ORG,
        '1',
        { severity: 'SEV2', teamId: OTHER_TEAM, ...RESOLVE },
        ADMIN_ACTOR,
      );

      const [[, change]] = notifications.incidentActivities.mock.calls;
      const [entries] = prisma.incidentActivity.createManyAndReturn.mock.calls;
      const written = entries[0].data;

      expect(change).toEqual(
        expect.objectContaining({
          teamId: OTHER_TEAM,
          actor: { userId: USER, membershipId: MEMBERSHIP },
        }),
      );
      // Each entry's own id and time, and the type its change is reported as.
      expect(change.events).toEqual(
        written.map(
          (entry: { type: string; createdAt: Date }, index: number) => ({
            type: {
              SEVERITY_CHANGED: 'INCIDENT_SEVERITY_CHANGED',
              STATUS_CHANGED: 'INCIDENT_RESOLVED',
              TEAM_CHANGED: 'INCIDENT_REASSIGNED',
            }[entry.type],
            activityId: `entry-${index}`,
            createdAt: entry.createdAt,
          }),
        ),
      );
      expect(change.events).toHaveLength(3);
    });

    it('should match entries to their events by type, whatever order they come back in', async () => {
      const { service, prisma, notifications } = serviceWith();
      prisma.incident.update.mockResolvedValue(
        incidentRow({
          team: { id: OTHER_TEAM, name: 'Platform', slug: 'platform' },
        }),
      );
      prisma.incidentActivity.createManyAndReturn.mockImplementation(
        ({ data }: { data: { type: string; createdAt: Date }[] }) =>
          data
            .map(({ type, createdAt }) => ({
              id: `entry-${type}`,
              type,
              createdAt,
            }))
            .reverse(),
      );

      await service.update(
        ORG,
        '1',
        { severity: 'SEV2', teamId: OTHER_TEAM },
        ADMIN_ACTOR,
      );

      const [[, change]] = notifications.incidentActivities.mock.calls;

      expect(
        change.events.map(
          ({ type, activityId }: { type: string; activityId: string }) => [
            type,
            activityId,
          ],
        ),
      ).toEqual(
        expect.arrayContaining([
          ['INCIDENT_SEVERITY_CHANGED', 'entry-SEVERITY_CHANGED'],
          ['INCIDENT_REASSIGNED', 'entry-TEAM_CHANGED'],
        ]),
      );
    });

    it('should report nothing for a change that records nothing', async () => {
      const { service, notifications } = serviceWith();

      await service.update(ORG, '1', { title: 'Renamed' }, ADMIN_ACTOR);
      await service.update(ORG, '1', { severity: 'SEV1' }, ADMIN_ACTOR);

      expect(notifications.incidentActivities).not.toHaveBeenCalled();
    });

    it('should report the last response completing as ready to resolve, at its entry and its time', async () => {
      const { service, prisma, notifications } = serviceWith();
      prisma.incidentResponder.findFirst.mockResolvedValue({
        id: 'responder-1',
        status: 'INVESTIGATING',
      });
      prisma.incidentActivity.create.mockResolvedValue({
        id: 'completed-1',
        createdAt: CREATED,
      });
      prisma.incident.findFirstOrThrow.mockResolvedValue(
        incidentRow({ responders: [responder(MEMBERSHIP, 'COMPLETED')] }),
      );

      await service.completeResponse(ORG, '1', MEMBER_ACTOR);

      expect(notifications.incidentActivities).toHaveBeenCalledExactlyOnceWith(
        prisma,
        {
          organizationId: ORG,
          incidentId: 'incident-1',
          teamId: TEAM,
          actor: { userId: USER, membershipId: MEMBERSHIP },
          events: [
            {
              type: 'INCIDENT_READY_TO_RESOLVE',
              activityId: 'completed-1',
              createdAt: CREATED,
            },
          ],
        },
      );
    });

    it('should report nothing while another response is still under way', async () => {
      const { service, prisma, notifications } = serviceWith();
      prisma.incidentResponder.findFirst.mockResolvedValue({
        id: 'responder-1',
        status: 'INVESTIGATING',
      });
      prisma.incident.findFirstOrThrow.mockResolvedValue(
        incidentRow({
          responders: [
            responder(MEMBERSHIP, 'COMPLETED'),
            responder(OTHER_MEMBERSHIP, 'INVESTIGATING'),
          ],
        }),
      );

      await service.completeResponse(ORG, '1', MEMBER_ACTOR);

      expect(notifications.incidentActivities).not.toHaveBeenCalled();
    });

    it('should report nothing for completing a response already complete', async () => {
      const { service, prisma, notifications } = serviceWith();
      prisma.incidentResponder.findFirst.mockResolvedValue({
        id: 'responder-1',
        status: 'COMPLETED',
      });
      prisma.incident.findFirstOrThrow.mockResolvedValue(
        incidentRow({ responders: [responder(MEMBERSHIP, 'COMPLETED')] }),
      );

      await service.completeResponse(ORG, '1', MEMBER_ACTOR);

      expect(notifications.incidentActivities).not.toHaveBeenCalled();
    });

    it('should report nothing when a response starts or an update is posted', async () => {
      const { service, prisma, notifications } = serviceWith();
      prisma.incident.findFirst.mockResolvedValue(incidentRow());
      prisma.incidentActivity.create.mockResolvedValue(activityRow());

      await service.startResponse(ORG, '1', MEMBER_ACTOR);
      await service.postUpdate(
        ORG,
        '1',
        { message: 'Rolling back.' },
        { membershipId: MEMBERSHIP, role: 'ADMIN' },
      );

      expect(notifications.incidentActivities).not.toHaveBeenCalled();
    });
  });

  describe('timeline', () => {
    it('should read the entries of the incident within the organization, oldest first', async () => {
      const { service, prisma } = serviceWith();
      prisma.incident.findFirst.mockResolvedValue({
        activity: [activityRow()],
      });

      const timeline = await service.timeline(ORG, ADMIN_ACTOR, '1');

      expect(prisma.incident.findFirst).toHaveBeenCalledWith({
        where: {
          AND: [
            { organizationId: ORG, organization: { deletedAt: null } },
            { number: 1 },
          ],
        },
        select: {
          activity: expect.objectContaining({
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          }),
        },
      });
      expect(timeline).toHaveLength(1);
    });

    it('should answer a missing incident with 404', async () => {
      const { service, prisma } = serviceWith();
      prisma.incident.findFirst.mockResolvedValue(null);

      await expectCode(
        service.timeline(ORG, ADMIN_ACTOR, '1'),
        404,
        IncidentsErrorCode.INCIDENT_NOT_FOUND,
      );
    });
  });

  describe('get', () => {
    it('should look the incident up by number within the organization', async () => {
      const { service, prisma } = serviceWith();

      await service.get(ORG, ADMIN_ACTOR, '42');

      expect(prisma.incident.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              { organizationId: ORG, organization: { deletedAt: null } },
              { number: 42 },
            ],
          },
        }),
      );
    });

    it("should look it up only among a member's own incidents", async () => {
      const { service, prisma } = serviceWith();

      await service.get(ORG, MEMBER_ACTOR, '42');

      expect(prisma.incident.findFirst.mock.calls[0][0].where).toEqual({
        AND: [
          { organizationId: ORG, organization: { deletedAt: null } },
          incidentReadScope(MEMBER_ACTOR),
          { number: 42 },
        ],
      });
    });

    it('should answer a missing incident with 404', async () => {
      const { service, prisma } = serviceWith();
      prisma.incident.findFirst.mockResolvedValue(null);

      await expectCode(
        service.get(ORG, ADMIN_ACTOR, '42'),
        404,
        IncidentsErrorCode.INCIDENT_NOT_FOUND,
      );
    });
  });

  describe('list', () => {
    const rows = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        incidentRow({
          number: index + 1,
          severity: 'SEV2',
          responders: [],
          activity: [],
        }),
      );

    it('should give each item its response in counts, and when it was last updated', async () => {
      const { service, prisma } = serviceWith();
      prisma.incident.findMany.mockResolvedValue([
        incidentRow({
          responders: [
            { status: 'INVESTIGATING' },
            { status: 'COMPLETED' },
            { status: 'COMPLETED' },
          ],
          activity: [{ createdAt: new Date('2026-09-18T12:30:00.000Z') }],
        }),
        incidentRow({
          id: 'incident-2',
          number: 2,
          responders: [],
          activity: [],
        }),
      ]);

      const { items } = await service.list(ORG, ADMIN_ACTOR, {
        state: 'active',
      });

      expect(
        items.map(({ response, lastUpdateAt }) => ({ response, lastUpdateAt })),
      ).toEqual([
        {
          response: { investigating: 1, completed: 2 },
          lastUpdateAt: '2026-09-18T12:30:00.000Z',
        },
        { response: { investigating: 0, completed: 0 }, lastUpdateAt: null },
      ]);
      // Statuses and one update's time: never the responders themselves.
      const { select } = prisma.incident.findMany.mock.calls[0][0];
      expect(select.responders).toEqual({ select: { status: true } });
      expect(select.activity).toEqual(
        expect.objectContaining({ where: { type: 'UPDATE' }, take: 1 }),
      );
    });

    it.each([
      ['unclaimed', { status: 'DECLARED' }],
      [
        'ready',
        {
          status: 'INVESTIGATING',
          responders: { none: { status: 'INVESTIGATING' } },
        },
      ],
    ] as const)(
      'should narrow by where the response stands: %s, beside the list status',
      async (response, condition) => {
        const { service, prisma } = serviceWith();

        await service.list(ORG, ADMIN_ACTOR, { state: 'resolved', response });

        const [, page] = prisma.incident.findMany.mock.calls[0][0].where.AND;

        // The resolved list keeps its status: nothing can match both.
        expect(page.status).toBe('RESOLVED');
        expect(page.AND).toEqual([condition]);
      },
    );

    it('should order active incidents by severity, then number, within the organization', async () => {
      const { service, prisma } = serviceWith();

      await service.list(ORG, ADMIN_ACTOR, { state: 'active' });

      expect(prisma.incident.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              { organizationId: ORG, organization: { deletedAt: null } },
              { status: { not: 'RESOLVED' } },
            ],
          },
          orderBy: [{ severity: 'asc' }, { number: 'asc' }],
          take: INCIDENT_PAGE_SIZE + 1,
        }),
      );
    });

    it('should continue an active page after its cursor: later in the severity, or less severe', async () => {
      const { service, prisma } = serviceWith();

      await service.list(ORG, ADMIN_ACTOR, {
        state: 'active',
        cursor: 'SEV2:41',
      });

      const [, page] = prisma.incident.findMany.mock.calls[0][0].where.AND;

      expect(page.OR).toEqual([
        { severity: 'SEV2', number: { gt: 41 } },
        { severity: { in: ['SEV3', 'SEV4'] } },
      ]);
    });

    it("should keep a member's scope, the cursor, and the search each whole", async () => {
      const { service, prisma } = serviceWith();

      await service.list(ORG, MEMBER_ACTOR, {
        state: 'active',
        cursor: 'SEV2:41',
        q: 'payments',
      });

      const [organization, scope, page] =
        prisma.incident.findMany.mock.calls[0][0].where.AND;

      expect(organization).toEqual({
        organizationId: ORG,
        organization: { deletedAt: null },
      });
      expect(scope).toEqual(incidentReadScope(MEMBER_ACTOR));
      expect(page.OR).toEqual([
        { severity: 'SEV2', number: { gt: 41 } },
        { severity: { in: ['SEV3', 'SEV4'] } },
      ]);
      expect(page.AND).toHaveLength(1);
    });

    it('should order resolved incidents newest first and continue below the cursor', async () => {
      const { service, prisma } = serviceWith();

      await service.list(ORG, ADMIN_ACTOR, { state: 'resolved', cursor: '41' });

      expect(prisma.incident.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              { organizationId: ORG, organization: { deletedAt: null } },
              { status: 'RESOLVED', number: { lt: 41 } },
            ],
          },
          orderBy: { number: 'desc' },
        }),
      );
    });

    it('should report a further page, with a cursor at the last item returned', async () => {
      const { service, prisma } = serviceWith();
      prisma.incident.findMany.mockResolvedValue(rows(INCIDENT_PAGE_SIZE + 1));

      const page = await service.list(ORG, ADMIN_ACTOR, { state: 'active' });

      expect(page.items).toHaveLength(INCIDENT_PAGE_SIZE);
      expect(page.page).toEqual({
        cursor: `SEV2:${INCIDENT_PAGE_SIZE}`,
        hasMore: true,
      });
    });

    it('should report the last page with no cursor', async () => {
      const { service, prisma } = serviceWith();
      prisma.incident.findMany.mockResolvedValue(rows(3));

      expect(
        (await service.list(ORG, ADMIN_ACTOR, { state: 'resolved' })).page,
      ).toEqual({
        cursor: null,
        hasMore: false,
      });
    });

    it.each([
      ['active', '41'],
      ['active', 'SEV5:1'],
      ['active', 'SEV1:0'],
      ['resolved', 'SEV1:41'],
      ['resolved', '-1'],
    ] as const)(
      'should refuse the %s cursor %j with 400',
      async (state, cursor) => {
        const { service, prisma } = serviceWith();

        await expectCode(
          service.list(ORG, ADMIN_ACTOR, { state, cursor }),
          400,
          IncidentsErrorCode.INVALID_CURSOR,
        );
        expect(prisma.incident.findMany).not.toHaveBeenCalled();
      },
    );
  });

  describe('cursors', () => {
    it('should round-trip', () => {
      expect(
        decodeActiveCursor(encodeActiveCursor({ severity: 'SEV3', number: 9 })),
      ).toEqual({ severity: 'SEV3', number: 9 });
      expect(decodeResolvedCursor('9')).toBe(9);

      const response = {
        startedAt: new Date('2026-09-18T12:05:00.000Z'),
        id: '0199a1b2-c3d4-7000-8000-0000000000f1',
      };

      expect(decodeResponseCursor(encodeResponseCursor(response))).toEqual(
        response,
      );
    });

    it('should round-trip a history cursor', () => {
      const last = { at: new Date('2026-09-18T12:05:00.000Z'), number: 41 };

      expect(encodeHistoryCursor(last)).toBe('2026-09-18T12:05:00.000Z~41');
      expect(decodeHistoryCursor(encodeHistoryCursor(last))).toEqual(last);
    });

    it.each([
      '2026-09-18T12:05:00.000Z',
      '2026-09-18T12:05:00.000Z~0',
      '2026-09-18T12:05:00.000Z~041',
      'yesterday~41',
      '2026-09-18~41',
      '2026-09-18T12:05:00.000Z~41~x',
    ])(
      'should refuse the history cursor %j with 400 INVALID_CURSOR',
      (cursor) => {
        expect(() => decodeHistoryCursor(cursor)).toThrow(
          expect.objectContaining({ status: 400 }),
        );
      },
    );

    it.each([
      '2026-09-18T12:05:00.000Z',
      '2026-09-18T12:05:00.000Z~not-an-id',
      'yesterday~0199a1b2-c3d4-7000-8000-0000000000f1',
      // A date in another form than the one the server writes.
      '2026-09-18~0199a1b2-c3d4-7000-8000-0000000000f1',
      '2026-09-18T12:05:00.000Z~0199a1b2-c3d4-7000-8000-0000000000f1~x',
    ])(
      'should refuse the response cursor %j with 400 INVALID_CURSOR',
      (cursor) => {
        expect(() => decodeResponseCursor(cursor)).toThrow(
          expect.objectContaining({ status: 400 }),
        );
      },
    );
  });
});
