import { Injectable } from '@nestjs/common';

import type { OrganizationContext } from '../common/request-context.js';
import { PrismaService } from '../database/prisma.service.js';

/**
 * A current membership, as admission sees it: the context a request runs
 * with, and whether the account still has to replace a one-time password.
 */
export interface ResolvedMembership extends OrganizationContext {
  passwordChangeRequired: boolean;
}

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
   *
   * Also reports whether the account is still on a one-time password, from
   * the same row join — so enforcing that costs no second query, and takes
   * effect on the very next request once the password is changed.
   */
  async resolve(
    userId: string,
    organizationId: string,
  ): Promise<ResolvedMembership | null> {
    const membership = await this.prisma.membership.findFirst({
      where: {
        organizationId,
        userId,
        organization: { deletedAt: null },
        user: { deletedAt: null },
      },
      select: {
        id: true,
        organizationId: true,
        role: true,
        user: { select: { passwordChangeRequired: true } },
      },
    });

    if (!membership) {
      return null;
    }

    return {
      organizationId: membership.organizationId,
      membershipId: membership.id,
      role: membership.role,
      passwordChangeRequired: membership.user.passwordChangeRequired,
    };
  }
}
