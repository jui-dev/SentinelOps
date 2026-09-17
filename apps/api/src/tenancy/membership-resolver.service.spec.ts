import type { PrismaService } from '../database/prisma.service.js';
import { MembershipResolver } from './membership-resolver.service.js';

const USER_ID = '0199a1b2-c3d4-7000-8000-000000000001';
const ORG_ID = '0199a1b2-c3d4-7000-8000-00000000000a';
const MEMBERSHIP_ID = '0199a1b2-c3d4-7000-8000-0000000000aa';

const resolverWith = (row: unknown) => {
  const findFirst = vi.fn().mockResolvedValue(row);
  const resolver = new MembershipResolver({
    membership: { findFirst },
  } as unknown as PrismaService);

  return { resolver, findFirst };
};

describe('MembershipResolver', () => {
  it('should look the membership up by organization and user, filtering soft-deleted parents', async () => {
    const { resolver, findFirst } = resolverWith(null);

    await resolver.resolve(USER_ID, ORG_ID);

    expect(findFirst).toHaveBeenCalledExactlyOnceWith({
      where: {
        organizationId: ORG_ID,
        userId: USER_ID,
        organization: { deletedAt: null },
        user: { deletedAt: null },
      },
      select: { id: true, organizationId: true, role: true },
    });
  });

  it('should return the admission context for a membership', async () => {
    const { resolver } = resolverWith({
      id: MEMBERSHIP_ID,
      organizationId: ORG_ID,
      role: 'OWNER',
    });

    await expect(resolver.resolve(USER_ID, ORG_ID)).resolves.toEqual({
      organizationId: ORG_ID,
      membershipId: MEMBERSHIP_ID,
      role: 'OWNER',
    });
  });

  it('should return null when there is no membership', async () => {
    const { resolver } = resolverWith(null);

    await expect(resolver.resolve(USER_ID, ORG_ID)).resolves.toBeNull();
  });

  it('should query again on every call rather than caching', async () => {
    // Revocation takes effect on the next request only because nothing here
    // remembers the previous answer.
    const { resolver, findFirst } = resolverWith({
      id: MEMBERSHIP_ID,
      organizationId: ORG_ID,
      role: 'MEMBER',
    });

    await resolver.resolve(USER_ID, ORG_ID);
    findFirst.mockResolvedValueOnce(null);

    await expect(resolver.resolve(USER_ID, ORG_ID)).resolves.toBeNull();
    expect(findFirst).toHaveBeenCalledTimes(2);
  });
});
