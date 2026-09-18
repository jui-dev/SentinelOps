import { HttpException } from '@nestjs/common';

import type { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { ServicesErrorCode } from '../services/services.errors.js';
import { TeamsErrorCode } from '../teams/teams.errors.js';
import { TenancyErrorCode } from '../tenancy/tenancy.errors.js';
import { IncidentsErrorCode } from './incidents.errors.js';
import {
  decodeActiveCursor,
  decodeResolvedCursor,
  encodeActiveCursor,
  INCIDENT_PAGE_SIZE,
  IncidentsService,
} from './incidents.service.js';

const ORG = '0199a1b2-c3d4-7000-8000-00000000000a';
const MEMBERSHIP = '0199a1b2-c3d4-7000-8000-0000000000aa';
const USER = '0199a1b2-c3d4-7000-8000-000000000001';
const TEAM = '0199a1b2-c3d4-7000-8000-0000000000c1';
const OTHER_TEAM = '0199a1b2-c3d4-7000-8000-0000000000c2';
const SERVICE = '0199a1b2-c3d4-7000-8000-0000000000d1';
const CREATED = new Date('2026-09-18T12:00:00.000Z');

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
  lead: null,
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
    team: { findFirst: vi.fn().mockResolvedValue({ id: OTHER_TEAM }) },
    incident: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(incidentRow()),
      create: vi.fn().mockResolvedValue(incidentRow({ number: 7 })),
      update: vi.fn().mockResolvedValue(incidentRow()),
    },
    $queryRaw: vi
      .fn()
      .mockResolvedValue([{ owner_team_id: TEAM, archived_at: null }]),
    $transaction: vi.fn(),
  };

  prisma.$transaction.mockImplementation((work: (tx: unknown) => unknown) =>
    work(prisma),
  );

  const service = new IncidentsService(prisma as unknown as PrismaService);

  return { service, prisma };
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

      await service.update(ORG, '1', { severity: 'SEV2' });

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

    it('should set resolvedAt only when resolving', async () => {
      const { service, prisma } = serviceWith();

      await service.update(ORG, '1', { status: 'MONITORING' });
      await service.update(ORG, '1', { status: 'RESOLVED' });

      expect(
        prisma.incident.update.mock.calls[0][0].data.resolvedAt,
      ).toBeUndefined();
      expect(
        prisma.incident.update.mock.calls[1][0].data.resolvedAt,
      ).toBeInstanceOf(Date);
    });

    it('should refuse any change to a resolved incident with 409 and write nothing', async () => {
      const { service, prisma } = serviceWith();
      prisma.incident.findFirst.mockResolvedValue({ status: 'RESOLVED' });

      await expectCode(
        service.update(ORG, '1', { title: 'Typo fixed' }),
        409,
        IncidentsErrorCode.INCIDENT_RESOLVED,
      );
      expect(prisma.incident.update).not.toHaveBeenCalled();
    });

    it('should look a lead up within the organization, then write it', async () => {
      const { service, prisma } = serviceWith();

      await service.update(ORG, '1', { leadMembershipId: MEMBERSHIP });

      expect(prisma.membership.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: MEMBERSHIP,
            organizationId: ORG,
            organization: { deletedAt: null },
            user: { deletedAt: null },
          },
        }),
      );
      expect(
        prisma.incident.update.mock.calls[0][0].data.leadMembershipId,
      ).toBe(MEMBERSHIP);
    });

    it('should clear the lead with null, looking nothing up', async () => {
      const { service, prisma } = serviceWith();

      await service.update(ORG, '1', { leadMembershipId: null });

      expect(prisma.membership.findFirst).not.toHaveBeenCalled();
      expect(
        prisma.incident.update.mock.calls[0][0].data.leadMembershipId,
      ).toBeNull();
    });

    it('should answer a lead outside the organization with 404 and change nothing', async () => {
      const { service, prisma } = serviceWith();
      prisma.membership.findFirst.mockResolvedValue(null);

      await expectCode(
        service.update(ORG, '1', { leadMembershipId: MEMBERSHIP }),
        404,
        'MEMBERSHIP_NOT_FOUND',
      );
      expect(prisma.incident.update).not.toHaveBeenCalled();
    });

    it('should judge the incident before the team', async () => {
      const { service, prisma } = serviceWith();
      prisma.incident.findFirst.mockResolvedValue(null);
      prisma.team.findFirst.mockResolvedValue(null);

      await expectCode(
        service.update(ORG, '1', { teamId: OTHER_TEAM }),
        404,
        IncidentsErrorCode.INCIDENT_NOT_FOUND,
      );
      expect(prisma.team.findFirst).not.toHaveBeenCalled();
    });

    it('should answer a team outside the organization with 404 and change nothing', async () => {
      const { service, prisma } = serviceWith();
      prisma.team.findFirst.mockResolvedValue(null);

      await expectCode(
        service.update(ORG, '1', { teamId: OTHER_TEAM }),
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
        service.update(ORG, '1', { teamId: OTHER_TEAM }),
        404,
        TeamsErrorCode.TEAM_NOT_FOUND,
      );
    });

    it('should answer an update that lost a race to a resolution with 409', async () => {
      const { service, prisma } = serviceWith();
      prisma.incident.update.mockRejectedValue(knownError('P2025'));
      prisma.incident.findFirst
        .mockResolvedValueOnce({ status: 'MONITORING' })
        .mockResolvedValueOnce({ status: 'RESOLVED' });

      await expectCode(
        service.update(ORG, '1', { status: 'RESOLVED' }),
        409,
        IncidentsErrorCode.INCIDENT_RESOLVED,
      );
    });

    it('should answer an update whose incident vanished with 404', async () => {
      const { service, prisma } = serviceWith();
      prisma.incident.update.mockRejectedValue(knownError('P2025'));
      prisma.incident.findFirst
        .mockResolvedValueOnce({ status: 'MONITORING' })
        .mockResolvedValueOnce(null);

      await expectCode(
        service.update(ORG, '1', { status: 'RESOLVED' }),
        404,
        IncidentsErrorCode.INCIDENT_NOT_FOUND,
      );
    });

    it.each(['0', 'abc', '2147483648', '1.5'])(
      'should answer the malformed number %j with 404 without querying',
      async (number) => {
        const { service, prisma } = serviceWith();

        await expectCode(
          service.update(ORG, number, { title: 'x' }),
          404,
          IncidentsErrorCode.INCIDENT_NOT_FOUND,
        );
        expect(prisma.$transaction).not.toHaveBeenCalled();
      },
    );
  });

  describe('get', () => {
    it('should look the incident up by number within the organization', async () => {
      const { service, prisma } = serviceWith();

      await service.get(ORG, '42');

      expect(prisma.incident.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: ORG,
            number: 42,
            organization: { deletedAt: null },
          },
        }),
      );
    });

    it('should answer a missing incident with 404', async () => {
      const { service, prisma } = serviceWith();
      prisma.incident.findFirst.mockResolvedValue(null);

      await expectCode(
        service.get(ORG, '42'),
        404,
        IncidentsErrorCode.INCIDENT_NOT_FOUND,
      );
    });
  });

  describe('list', () => {
    const rows = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        incidentRow({ number: index + 1, severity: 'SEV2' }),
      );

    it('should order active incidents by severity, then number, within the organization', async () => {
      const { service, prisma } = serviceWith();

      await service.list(ORG, { state: 'active' });

      expect(prisma.incident.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: ORG,
            organization: { deletedAt: null },
            status: { not: 'RESOLVED' },
          },
          orderBy: [{ severity: 'asc' }, { number: 'asc' }],
          take: INCIDENT_PAGE_SIZE + 1,
        }),
      );
    });

    it('should continue an active page after its cursor: later in the severity, or less severe', async () => {
      const { service, prisma } = serviceWith();

      await service.list(ORG, { state: 'active', cursor: 'SEV2:41' });

      expect(prisma.incident.findMany.mock.calls[0][0].where.OR).toEqual([
        { severity: 'SEV2', number: { gt: 41 } },
        { severity: { in: ['SEV3', 'SEV4'] } },
      ]);
    });

    it('should order resolved incidents newest first and continue below the cursor', async () => {
      const { service, prisma } = serviceWith();

      await service.list(ORG, { state: 'resolved', cursor: '41' });

      expect(prisma.incident.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: ORG,
            organization: { deletedAt: null },
            status: 'RESOLVED',
            number: { lt: 41 },
          },
          orderBy: { number: 'desc' },
        }),
      );
    });

    it('should report a further page, with a cursor at the last item returned', async () => {
      const { service, prisma } = serviceWith();
      prisma.incident.findMany.mockResolvedValue(rows(INCIDENT_PAGE_SIZE + 1));

      const page = await service.list(ORG, { state: 'active' });

      expect(page.items).toHaveLength(INCIDENT_PAGE_SIZE);
      expect(page.page).toEqual({
        cursor: `SEV2:${INCIDENT_PAGE_SIZE}`,
        hasMore: true,
      });
    });

    it('should report the last page with no cursor', async () => {
      const { service, prisma } = serviceWith();
      prisma.incident.findMany.mockResolvedValue(rows(3));

      expect((await service.list(ORG, { state: 'resolved' })).page).toEqual({
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
          service.list(ORG, { state, cursor }),
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
    });
  });
});
