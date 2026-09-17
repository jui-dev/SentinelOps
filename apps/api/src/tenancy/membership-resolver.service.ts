import { Injectable } from '@nestjs/common';

import type { OrganizationContext } from '../common/request-context.js';
import { PrismaService } from '../database/prisma.service.js';

/**
 * Answers the admission question: is this user a current member of this
 * organization, and in what capacity?
 *
 * One indexed lookup on the (organization_id, user_id) unique, made on every
 * organization-scoped request and never cached. That is what makes revoking a
 * membership take effect on the very next request, rather than when some cache
 * or token expires.
 */
@Injectable()
export class MembershipResolver {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The caller's membership in `organizationId`, or null.
   *
   * Null covers every reason uniformly: no such organization, a soft-deleted
   * one, no membership, or a soft-deleted caller. The last filter matters
   * because the JWT guard reads no database, so this is the first point at
   * which a deleted account is noticed on a tenant route.
   *
   * `organizationId` must already be a well-formed uuid; the guard checks that
   * before calling.
   */
  async resolve(
    userId: string,
    organizationId: string,
  ): Promise<OrganizationContext | null> {
    const membership = await this.prisma.membership.findFirst({
      where: {
        organizationId,
        userId,
        organization: { deletedAt: null },
        user: { deletedAt: null },
      },
      select: { id: true, organizationId: true, role: true },
    });

    if (!membership) {
      return null;
    }

    return {
      organizationId: membership.organizationId,
      membershipId: membership.id,
      role: membership.role,
    };
  }
}
