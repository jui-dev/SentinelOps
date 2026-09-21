import type { Prisma } from '../generated/prisma/client.js';
import { NotificationsWriter } from './notifications.writer.js';

const ORG = '0199a1b2-c3d4-7000-8000-00000000000a';
const TEAM = '0199a1b2-c3d4-7000-8000-0000000000c1';
const MEMBER = '0199a1b2-c3d4-7000-8000-0000000000b1';
const ADMIN = '0199a1b2-c3d4-7000-8000-0000000000a1';
const ADMIN_USER = '0199a1b2-c3d4-7000-8000-000000000001';
const AT = new Date('2026-09-18T12:00:00.000Z');

const txWith = () => ({
  notification: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
});

describe('NotificationsWriter.teamMembership', () => {
  it.each(['TEAM_MEMBERSHIP_ADDED', 'TEAM_MEMBERSHIP_REMOVED'] as const)(
    'should tell the member alone of %s, naming the team, at the change’s time',
    async (type) => {
      const tx = txWith();

      const written = await new NotificationsWriter().teamMembership(
        tx as unknown as Prisma.TransactionClient,
        {
          organizationId: ORG,
          teamId: TEAM,
          type,
          memberMembershipId: MEMBER,
          actor: { userId: ADMIN_USER, membershipId: ADMIN },
          createdAt: AT,
        },
      );

      expect(written).toBe(1);
      expect(tx.notification.createMany).toHaveBeenCalledExactlyOnceWith({
        data: [
          {
            organizationId: ORG,
            recipientMembershipId: MEMBER,
            type,
            actorId: ADMIN_USER,
            teamId: TEAM,
            createdAt: AT,
          },
        ],
      });
    },
  );

  it('should write nothing when the member placed or removed themselves', async () => {
    const tx = txWith();

    const written = await new NotificationsWriter().teamMembership(
      tx as unknown as Prisma.TransactionClient,
      {
        organizationId: ORG,
        teamId: TEAM,
        type: 'TEAM_MEMBERSHIP_ADDED',
        memberMembershipId: ADMIN,
        actor: { userId: ADMIN_USER, membershipId: ADMIN },
        createdAt: AT,
      },
    );

    expect(written).toBe(0);
    expect(tx.notification.createMany).not.toHaveBeenCalled();
  });
});
