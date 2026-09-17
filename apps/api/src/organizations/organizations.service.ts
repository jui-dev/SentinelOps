import { Injectable } from '@nestjs/common';

import type { OrganizationResponse } from '../auth/auth.contract.js';
import { toOrganizationResponse } from '../auth/auth.responses.js';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type { Role } from '../generated/prisma/enums.js';
import { organizationNotFound } from '../tenancy/tenancy.errors.js';
import { isResourceId } from '../tenancy/tenancy.schemas.js';
import type {
  OrganizationDetailResponse,
  OrganizationMembershipResponse,
} from './organizations.contract.js';
import { membershipNotFound } from './organizations.errors.js';
import {
  toOrganizationDetailResponse,
  toOrganizationMembershipResponse,
} from './organizations.responses.js';
import type { UpdateOrganizationRequest } from './organizations.schemas.js';

/**
 * Prisma's answer to an update whose where matched no row: here, an
 * organization that does not exist or was soft-deleted.
 */
const RECORD_NOT_FOUND = 'P2025';

/** Columns an organization response is built from. Never deletedAt. */
const organizationSelection = {
  id: true,
  name: true,
  slug: true,
  createdAt: true,
} as const;

/**
 * Columns a membership response is built from.
 *
 * The nested user is limited to identity. In particular it never selects
 * `user.memberships`, which would disclose the other organizations a member
 * belongs to.
 */
const membershipSelection = {
  id: true,
  role: true,
  createdAt: true,
  user: { select: { id: true, name: true, email: true } },
} as const;

/**
 * Organization-scoped reads.
 *
 * Resource isolation lives here, and does not rely on admission. Every method
 * takes the organization id as an explicit argument — never from the request
 * context — and every query filters by it, so each one is correct even when
 * called with no guard in front of it. Admission answers "may this caller act
 * in this organization"; these queries answer "does this row belong to it".
 */
@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The organization, with the caller's own grant alongside it.
   *
   * Still filters soft-deletion itself: the organization could be deleted
   * between admission and this read, and the answer then is the same 404
   * admission would have given.
   */
  async getOrganization(
    organizationId: string,
    caller: { membershipId: string; role: Role },
  ): Promise<OrganizationDetailResponse> {
    const organization = await this.prisma.organization.findFirst({
      where: { id: organizationId, deletedAt: null },
      select: organizationSelection,
    });

    if (!organization) {
      throw organizationNotFound();
    }

    return toOrganizationDetailResponse(organization, caller);
  }

  /**
   * Renames the organization.
   *
   * One statement: the unique `id` together with `deletedAt: null` is the
   * update's own predicate, so there is no read to race — a soft deletion
   * committed before this runs makes it match nothing, and the caller receives
   * the same 404 admission would have given. The organization *is* the tenant,
   * so its id is the whole tenant filter.
   *
   * No caller parameter. Authorization has already happened before the
   * handler, and renaming has no rule that depends on who is doing it. A
   * service whose invariants do depend on the actor takes it explicitly.
   */
  async updateOrganization(
    organizationId: string,
    input: UpdateOrganizationRequest,
  ): Promise<OrganizationResponse> {
    try {
      const organization = await this.prisma.organization.update({
        where: { id: organizationId, deletedAt: null },
        data: { name: input.name },
        select: organizationSelection,
      });

      return toOrganizationResponse(organization);
    } catch (error) {
      // Only the no-row case is a 404. Anything else is a genuine fault and
      // surfaces as a masked 500 with its stack in the log.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === RECORD_NOT_FOUND
      ) {
        throw organizationNotFound();
      }

      throw error;
    }
  }

  /**
   * Every membership in the organization whose user still exists, oldest
   * first. The id breaks ties deterministically; being UUIDv7 it also follows
   * creation order.
   */
  async listMemberships(
    organizationId: string,
  ): Promise<OrganizationMembershipResponse[]> {
    const memberships = await this.prisma.membership.findMany({
      where: {
        organizationId,
        organization: { deletedAt: null },
        user: { deletedAt: null },
      },
      select: membershipSelection,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    return memberships.map(toOrganizationMembershipResponse);
  }

  /**
   * One membership, looked up by its id *and* the organization together.
   *
   * This is the resource-isolation pattern every tenant-owned lookup follows:
   * the organization is part of the predicate, not a check applied to a row
   * fetched by id alone. A membership that exists in another organization is
   * therefore simply not found.
   */
  async getMembership(
    organizationId: string,
    membershipId: string,
  ): Promise<OrganizationMembershipResponse> {
    // A malformed id names nothing. Answered before the query, which would
    // otherwise fail casting it to uuid and surface as a 500.
    if (!isResourceId(membershipId)) {
      throw membershipNotFound();
    }

    const membership = await this.prisma.membership.findFirst({
      where: {
        id: membershipId,
        organizationId,
        organization: { deletedAt: null },
        user: { deletedAt: null },
      },
      select: membershipSelection,
    });

    if (!membership) {
      throw membershipNotFound();
    }

    return toOrganizationMembershipResponse(membership);
  }
}
