import { HttpException } from '@nestjs/common';

import type { PrismaService } from '../database/prisma.service.js';
import type { NotificationsWriter } from '../notifications/notifications.writer.js';
import { Prisma } from '../generated/prisma/client.js';
import { OrganizationsErrorCode } from '../organizations/organizations.errors.js';
import { TenancyErrorCode } from '../tenancy/tenancy.errors.js';
import { TeamsErrorCode } from './teams.errors.js';
import { fallbackTeamSlug, TeamsService } from './teams.service.js';

const ORG = '0199a1b2-c3d4-7000-8000-00000000000a';
const TEAM = '0199a1b2-c3d4-7000-8000-0000000000c1';
const MEMBERSHIP = '0199a1b2-c3d4-7000-8000-0000000000b1';
/** The Admin placing or removing someone: another membership. */
const ACTOR = { membershipId: '0199a1b2-c3d4-7000-8000-0000000000a1' };
const ACTOR_USER = '0199a1b2-c3d4-7000-8000-000000000001';
/** Who is reading: oversight sees every team, a member sees their own. */
const OVERSEER = { membershipId: ACTOR.membershipId, role: 'ADMIN' as const };
const READER = { membershipId: MEMBERSHIP, role: 'MEMBER' as const };
const ISOLATION = { organizationId: ORG, organization: { deletedAt: null } };
const OWN_TEAMS = { memberships: { some: { membershipId: MEMBERSHIP } } };
const CREATED = new Date('2026-09-18T12:00:00.000Z');

const teamRow = {
  id: TEAM,
  name: 'Platform',
  slug: 'platform',
  description: null,
  createdAt: CREATED,
  updatedAt: CREATED,
  _count: { memberships: 0, services: 0 },
};

const memberRow = {
  membershipId: MEMBERSHIP,
  createdAt: CREATED,
  membership: {
    user: { id: 'user-1', name: 'Ada Lovelace', email: 'ada@example.com' },
  },
};

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
    organization: { findFirst: vi.fn().mockResolvedValue({ id: ORG }) },
    membership: {
      findFirst: vi
        .fn()
        .mockResolvedValue({ id: MEMBERSHIP, userId: ACTOR_USER }),
    },
    team: {
      findMany: vi.fn().mockResolvedValue([teamRow]),
      findFirst: vi.fn().mockResolvedValue(teamRow),
      create: vi.fn().mockResolvedValue(teamRow),
      update: vi.fn().mockResolvedValue(teamRow),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    teamMembership: {
      findMany: vi.fn().mockResolvedValue([memberRow]),
      create: vi.fn().mockResolvedValue(memberRow),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    // lockTeam's locking read: the team is there.
    $queryRaw: vi.fn().mockResolvedValue([{ id: TEAM }]),
    $transaction: vi.fn(),
  };

  prisma.$transaction.mockImplementation((work: (tx: unknown) => unknown) =>
    work(prisma),
  );

  const notifications = { teamMembership: vi.fn().mockResolvedValue(1) };

  const service = new TeamsService(
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

describe('TeamsService', () => {
  describe('list', () => {
    it('should scope by the organization and order by name', async () => {
      const { service, prisma } = serviceWith();

      await expect(service.list(ORG, OVERSEER)).resolves.toEqual([
        expect.objectContaining({ id: TEAM, memberCount: 0 }),
      ]);

      expect(prisma.team.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { AND: [ISOLATION, {}] },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        }),
      );
    });

    it('should narrow a member to the teams they are on', async () => {
      const { service, prisma } = serviceWith();

      await service.list(ORG, READER);

      expect(prisma.team.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { AND: [ISOLATION, OWN_TEAMS, {}] },
        }),
      );
    });
  });

  describe('get', () => {
    it('should look the team up by id and organization together', async () => {
      const { service, prisma } = serviceWith();

      await service.get(ORG, OVERSEER, TEAM);

      expect(prisma.team.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { AND: [ISOLATION, { id: TEAM }] },
        }),
      );
    });

    it("should look a member's team up within their own teams", async () => {
      const { service, prisma } = serviceWith();

      await service.get(ORG, READER, TEAM);

      expect(prisma.team.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { AND: [ISOLATION, OWN_TEAMS, { id: TEAM }] },
        }),
      );
    });

    it('should answer a malformed id with 404 without querying', async () => {
      const { service, prisma } = serviceWith();

      await expectCode(
        service.get(ORG, OVERSEER, 'not-a-uuid'),
        404,
        TeamsErrorCode.TEAM_NOT_FOUND,
      );
      expect(prisma.team.findFirst).not.toHaveBeenCalled();
    });

    it('should answer a team outside the organization with 404', async () => {
      const { service, prisma } = serviceWith();
      prisma.team.findFirst.mockResolvedValue(null);

      await expectCode(
        service.get(ORG, OVERSEER, TEAM),
        404,
        TeamsErrorCode.TEAM_NOT_FOUND,
      );
    });

    it("should answer a team outside the reader's scope the same way", async () => {
      // The scope leaves the row unmatched, so this is the very same 404 a
      // nonexistent team gives — the reader cannot tell the two apart.
      const { service, prisma } = serviceWith();
      prisma.team.findFirst.mockResolvedValue(null);

      await expectCode(
        service.get(ORG, READER, TEAM),
        404,
        TeamsErrorCode.TEAM_NOT_FOUND,
      );
    });
  });

  describe('create', () => {
    it('should derive the slug from the name', async () => {
      const { service, prisma } = serviceWith();

      await service.create(ORG, { name: 'Payments & Risk' });

      expect(prisma.team.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            organizationId: ORG,
            name: 'Payments & Risk',
            slug: 'payments-risk',
            description: null,
          },
        }),
      );
    });

    it('should give a name with no sluggable characters an opaque slug', async () => {
      const { service, prisma } = serviceWith();

      await service.create(ORG, { name: '決済' }, () => 'team-0a1b2c3d');

      expect(prisma.team.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ slug: 'team-0a1b2c3d' }),
        }),
      );
    });

    it('should retry a colliding fallback slug once with a fresh one', async () => {
      const { service, prisma } = serviceWith();
      const slugs = ['team-00000001', 'team-00000002'];
      prisma.team.create.mockRejectedValueOnce(
        knownError('P2002', 'teams_organization_id_slug_key'),
      );

      await service.create(ORG, { name: '決済' }, () => slugs.shift()!);

      expect(prisma.team.create).toHaveBeenCalledTimes(2);
      expect(prisma.team.create).toHaveBeenLastCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ slug: 'team-00000002' }),
        }),
      );
    });

    it('should never retry a derived slug: a collision means a similar name exists', async () => {
      const { service, prisma } = serviceWith();
      prisma.team.create.mockRejectedValue(
        knownError('P2002', 'teams_organization_id_slug_key'),
      );

      await expectCode(
        service.create(ORG, { name: 'platform!' }),
        409,
        TeamsErrorCode.TEAM_NAME_TAKEN,
      );
      expect(prisma.team.create).toHaveBeenCalledTimes(1);
    });

    it('should answer an exact name collision with 409', async () => {
      const { service, prisma } = serviceWith();
      prisma.team.create.mockRejectedValue(
        knownError('P2002', 'teams_organization_id_name_key'),
      );

      await expectCode(
        service.create(ORG, { name: 'Platform' }),
        409,
        TeamsErrorCode.TEAM_NAME_TAKEN,
      );
    });

    it('should rethrow a violation of a constraint it does not know', async () => {
      const { service, prisma } = serviceWith();
      const unknown = knownError('P2002', 'something_else_key');
      prisma.team.create.mockRejectedValue(unknown);

      await expect(service.create(ORG, { name: 'Platform' })).rejects.toBe(
        unknown,
      );
    });

    it('should refuse to create a team in an organization deleted since admission', async () => {
      const { service, prisma } = serviceWith();
      prisma.organization.findFirst.mockResolvedValue(null);

      await expectCode(
        service.create(ORG, { name: 'Platform' }),
        404,
        TenancyErrorCode.ORGANIZATION_NOT_FOUND,
      );
      expect(prisma.team.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('should update through the (organization, id) compound key, never the slug', async () => {
      const { service, prisma } = serviceWith();

      await service.update(ORG, TEAM, { name: 'SRE' });

      expect(prisma.team.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId_id: { organizationId: ORG, id: TEAM },
            organization: { deletedAt: null },
          },
          data: { name: 'SRE', description: undefined },
        }),
      );
    });

    it('should answer a missing team with 404', async () => {
      const { service, prisma } = serviceWith();
      prisma.team.update.mockRejectedValue(knownError('P2025'));

      await expectCode(
        service.update(ORG, TEAM, { name: 'SRE' }),
        404,
        TeamsErrorCode.TEAM_NOT_FOUND,
      );
    });

    it('should answer a name collision with 409', async () => {
      const { service, prisma } = serviceWith();
      prisma.team.update.mockRejectedValue(
        knownError('P2002', 'teams_organization_id_name_key'),
      );

      await expectCode(
        service.update(ORG, TEAM, { name: 'Platform' }),
        409,
        TeamsErrorCode.TEAM_NAME_TAKEN,
      );
    });
  });

  describe('delete', () => {
    it('should delete only within the organization', async () => {
      const { service, prisma } = serviceWith();

      await service.delete(ORG, TEAM);

      expect(prisma.team.deleteMany).toHaveBeenCalledWith({
        where: {
          id: TEAM,
          organizationId: ORG,
          organization: { deletedAt: null },
        },
      });
    });

    it('should answer a team it did not delete with 404', async () => {
      const { service, prisma } = serviceWith();
      prisma.team.deleteMany.mockResolvedValue({ count: 0 });

      await expectCode(
        service.delete(ORG, TEAM),
        404,
        TeamsErrorCode.TEAM_NOT_FOUND,
      );
    });

    it('should answer a team that still owns services with 409', async () => {
      const { service, prisma } = serviceWith();
      prisma.team.deleteMany.mockRejectedValue(
        knownError('P2003', 'services_organization_id_owner_team_id_fkey'),
      );

      await expectCode(
        service.delete(ORG, TEAM),
        409,
        TeamsErrorCode.TEAM_OWNS_SERVICES,
      );
    });

    it('should answer a team that has been responsible for incidents with 409', async () => {
      const { service, prisma } = serviceWith();
      prisma.team.deleteMany.mockRejectedValue(
        knownError('P2003', 'incidents_organization_id_team_id_fkey'),
      );

      await expectCode(
        service.delete(ORG, TEAM),
        409,
        TeamsErrorCode.TEAM_HAS_INCIDENTS,
      );
    });

    it('should rethrow a foreign-key violation it does not recognise', async () => {
      const { service, prisma } = serviceWith();
      const unknown = knownError('P2003', 'something_else_fkey');
      prisma.team.deleteMany.mockRejectedValue(unknown);

      await expect(service.delete(ORG, TEAM)).rejects.toBe(unknown);
    });
  });

  describe('addMember', () => {
    it('should look the membership up within the organization and insert scalar ids', async () => {
      const { service, prisma } = serviceWith();

      await expect(
        service.addMember(ORG, TEAM, { membershipId: MEMBERSHIP }, ACTOR),
      ).resolves.toEqual(expect.objectContaining({ membershipId: MEMBERSHIP }));

      expect(prisma.membership.findFirst).toHaveBeenCalledWith({
        where: {
          id: MEMBERSHIP,
          organizationId: ORG,
          user: { deletedAt: null },
        },
        select: { id: true },
      });
      expect(prisma.teamMembership.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            organizationId: ORG,
            teamId: TEAM,
            membershipId: MEMBERSHIP,
          },
        }),
      );
    });

    it('should answer a team outside the organization with 404 before looking at the membership', async () => {
      const { service, prisma } = serviceWith();
      prisma.team.findFirst.mockResolvedValue(null);

      await expectCode(
        service.addMember(ORG, TEAM, { membershipId: MEMBERSHIP }, ACTOR),
        404,
        TeamsErrorCode.TEAM_NOT_FOUND,
      );
      expect(prisma.membership.findFirst).not.toHaveBeenCalled();
    });

    it('should answer a membership outside the organization with 404 and insert nothing', async () => {
      const { service, prisma } = serviceWith();
      prisma.membership.findFirst.mockResolvedValue(null);

      await expectCode(
        service.addMember(ORG, TEAM, { membershipId: MEMBERSHIP }, ACTOR),
        404,
        OrganizationsErrorCode.MEMBERSHIP_NOT_FOUND,
      );
      expect(prisma.teamMembership.create).not.toHaveBeenCalled();
    });

    it('should answer a duplicate with 409', async () => {
      const { service, prisma } = serviceWith();
      prisma.teamMembership.create.mockRejectedValue(
        knownError('P2002', 'team_memberships_team_id_membership_id_key'),
      );

      await expectCode(
        service.addMember(ORG, TEAM, { membershipId: MEMBERSHIP }, ACTOR),
        409,
        TeamsErrorCode.ALREADY_A_TEAM_MEMBER,
      );
    });

    it.each([
      [
        'team_memberships_organization_id_team_id_fkey',
        404,
        TeamsErrorCode.TEAM_NOT_FOUND,
      ],
      [
        'team_memberships_organization_id_membership_id_fkey',
        404,
        OrganizationsErrorCode.MEMBERSHIP_NOT_FOUND,
      ],
    ])(
      'should answer the foreign-key violation %s from a concurrent deletion with %i',
      async (index, status, code) => {
        const { service, prisma } = serviceWith();
        prisma.teamMembership.create.mockRejectedValue(
          knownError('P2003', index),
        );

        await expectCode(
          service.addMember(ORG, TEAM, { membershipId: MEMBERSHIP }, ACTOR),
          status,
          code,
        );
      },
    );

    it('should tell the member, in the same transaction, at the placement’s own time', async () => {
      const { service, prisma, notifications } = serviceWith();

      await service.addMember(ORG, TEAM, { membershipId: MEMBERSHIP }, ACTOR);

      expect(notifications.teamMembership).toHaveBeenCalledExactlyOnceWith(
        prisma,
        {
          organizationId: ORG,
          teamId: TEAM,
          type: 'TEAM_MEMBERSHIP_ADDED',
          memberMembershipId: MEMBERSHIP,
          actor: { userId: ACTOR_USER, membershipId: ACTOR.membershipId },
          createdAt: CREATED,
        },
      );
      expect(
        prisma.teamMembership.create.mock.invocationCallOrder[0],
      ).toBeLessThan(notifications.teamMembership.mock.invocationCallOrder[0]);
    });

    it('should tell nobody when the placement is refused', async () => {
      const { service, prisma, notifications } = serviceWith();
      prisma.teamMembership.create.mockRejectedValue(
        knownError('P2002', 'team_memberships_team_id_membership_id_key'),
      );

      await expectCode(
        service.addMember(ORG, TEAM, { membershipId: MEMBERSHIP }, ACTOR),
        409,
        TeamsErrorCode.ALREADY_A_TEAM_MEMBER,
      );
      expect(notifications.teamMembership).not.toHaveBeenCalled();
    });

    it('should rethrow a foreign-key violation it does not recognise', async () => {
      const { service, prisma } = serviceWith();
      const unknown = knownError('P2003', 'something_else_fkey');
      prisma.teamMembership.create.mockRejectedValue(unknown);

      await expect(
        service.addMember(ORG, TEAM, { membershipId: MEMBERSHIP }, ACTOR),
      ).rejects.toBe(unknown);
    });
  });

  describe('listMembers', () => {
    it('should list only visible members of a team in the organization', async () => {
      const { service, prisma } = serviceWith();

      await service.listMembers(ORG, OVERSEER, TEAM);

      expect(prisma.teamMembership.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            organizationId: ORG,
            teamId: TEAM,
            membership: { user: { deletedAt: null } },
          },
        }),
      );
    });

    it('should answer a team outside the organization with 404', async () => {
      const { service, prisma } = serviceWith();
      prisma.team.findFirst.mockResolvedValue(null);

      await expectCode(
        service.listMembers(ORG, OVERSEER, TEAM),
        404,
        TeamsErrorCode.TEAM_NOT_FOUND,
      );
      expect(prisma.teamMembership.findMany).not.toHaveBeenCalled();
    });

    it("should establish the reader's team before reading any placement", async () => {
      // The 404 lands before the roster query, so a team outside the scope
      // cannot be told from a nonexistent one by whether it has members.
      const { service, prisma } = serviceWith();
      prisma.team.findFirst.mockResolvedValue(null);

      await expectCode(
        service.listMembers(ORG, READER, TEAM),
        404,
        TeamsErrorCode.TEAM_NOT_FOUND,
      );
      expect(prisma.team.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { AND: [ISOLATION, OWN_TEAMS, { id: TEAM }] },
        }),
      );
      expect(prisma.teamMembership.findMany).not.toHaveBeenCalled();
    });
  });

  describe('removeMember', () => {
    it('should delete only within the organization and team', async () => {
      const { service, prisma } = serviceWith();

      await service.removeMember(ORG, TEAM, MEMBERSHIP, ACTOR);

      expect(prisma.teamMembership.deleteMany).toHaveBeenCalledWith({
        where: {
          organizationId: ORG,
          teamId: TEAM,
          membershipId: MEMBERSHIP,
          team: { organization: { deletedAt: null } },
          membership: { user: { deletedAt: null } },
        },
      });
      expect(prisma.team.findFirst).not.toHaveBeenCalled();
    });

    it('should tell a member who is not on the team from a team that does not exist', async () => {
      const { service, prisma } = serviceWith();
      prisma.teamMembership.deleteMany.mockResolvedValue({ count: 0 });

      await expectCode(
        service.removeMember(ORG, TEAM, MEMBERSHIP, ACTOR),
        404,
        TeamsErrorCode.TEAM_MEMBER_NOT_FOUND,
      );

      prisma.team.findFirst.mockResolvedValue(null);

      await expectCode(
        service.removeMember(ORG, TEAM, MEMBERSHIP, ACTOR),
        404,
        TeamsErrorCode.TEAM_NOT_FOUND,
      );
    });

    it('should hold the team’s key before removing, and tell the member in the same transaction', async () => {
      const { service, prisma, notifications } = serviceWith();

      await service.removeMember(ORG, TEAM, MEMBERSHIP, ACTOR);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);

      const [strings, ...values] = prisma.$queryRaw.mock.calls[0] as [
        TemplateStringsArray,
        ...unknown[],
      ];

      expect(strings.join('?')).toMatch(/FROM teams[\s\S]*FOR KEY SHARE/);
      expect(values).toEqual([ORG, TEAM]);
      expect(prisma.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        prisma.teamMembership.deleteMany.mock.invocationCallOrder[0],
      );
      expect(notifications.teamMembership).toHaveBeenCalledExactlyOnceWith(
        prisma,
        {
          organizationId: ORG,
          teamId: TEAM,
          type: 'TEAM_MEMBERSHIP_REMOVED',
          memberMembershipId: MEMBERSHIP,
          actor: { userId: ACTOR_USER, membershipId: ACTOR.membershipId },
          createdAt: expect.any(Date),
        },
      );
    });

    it('should tell nobody when nothing was removed', async () => {
      const { service, prisma, notifications } = serviceWith();
      prisma.teamMembership.deleteMany.mockResolvedValue({ count: 0 });

      await expectCode(
        service.removeMember(ORG, TEAM, MEMBERSHIP, ACTOR),
        404,
        TeamsErrorCode.TEAM_MEMBER_NOT_FOUND,
      );
      expect(notifications.teamMembership).not.toHaveBeenCalled();
    });

    it('should delete nothing, and answer 404, for a team it cannot lock', async () => {
      const { service, prisma, notifications } = serviceWith();
      prisma.$queryRaw.mockResolvedValue([]);
      prisma.team.findFirst.mockResolvedValue(null);

      await expectCode(
        service.removeMember(ORG, TEAM, MEMBERSHIP, ACTOR),
        404,
        TeamsErrorCode.TEAM_NOT_FOUND,
      );
      expect(prisma.teamMembership.deleteMany).not.toHaveBeenCalled();
      expect(notifications.teamMembership).not.toHaveBeenCalled();
    });

    it('should answer a malformed membership id as not on the team, without deleting', async () => {
      const { service, prisma } = serviceWith();

      await expectCode(
        service.removeMember(ORG, TEAM, 'nope', ACTOR),
        404,
        TeamsErrorCode.TEAM_MEMBER_NOT_FOUND,
      );
      expect(prisma.teamMembership.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('fallbackTeamSlug', () => {
    it('should produce a slug-shaped, unpredictable value', () => {
      const slug = fallbackTeamSlug();

      expect(slug).toMatch(/^team-[0-9a-f]{8}$/);
      expect(fallbackTeamSlug()).not.toBe(slug);
    });
  });
});
