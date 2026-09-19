import { Injectable, Logger } from '@nestjs/common';

import type { OrganizationResponse } from '../auth/auth.contract.js';
import { emailAlreadyRegistered } from '../auth/auth.errors.js';
import { toOrganizationResponse } from '../auth/auth.responses.js';
import { PasswordService } from '../auth/password.service.js';
import { PrismaService } from '../database/prisma.service.js';
import { uniqueViolationHint } from '../database/unique-violation.js';
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
import type {
  CreateMemberRequest,
  UpdateOrganizationRequest,
} from './organizations.schemas.js';

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
 *
 * Teams come through the membership's own TeamMembership rows. Those rows
 * are joined to the membership by a composite key on the shared
 * organization_id, and to their team the same way, so every team reached
 * here belongs to this membership's organization — the database guarantees
 * it, whatever the query. Identity only, ordered by name.
 */
const membershipSelection = {
  id: true,
  role: true,
  createdAt: true,
  user: {
    select: { id: true, name: true, email: true, passwordChangeRequired: true },
  },
  teamMemberships: {
    select: { team: { select: { id: true, name: true, slug: true } } },
    // Team names are unique within an organization, so this is total.
    orderBy: { team: { name: 'asc' } },
  },
} as const;

/**
 * Organization-scoped reads, and adding a member.
 *
 * Resource isolation lives here, and does not rely on admission. Every method
 * takes the organization id as an explicit argument — never from the request
 * context — and every query filters by it, so each one is correct even when
 * called with no guard in front of it. Admission answers "may this caller act
 * in this organization"; these queries answer "does this row belong to it".
 */
@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
  ) {}

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

  /**
   * Adds a person to the organization as a MEMBER: creates their account with
   * the one-time password the Admin chose, and the membership that places
   * them here, in one transaction — an account with no membership could do
   * nothing, so either both exist or neither does.
   *
   * The account is marked `passwordChangeRequired`: it can sign in, but
   * admission refuses it everywhere until the person chooses their own
   * password. Nobody but them ever knows the password they end up with.
   *
   * An address that already has an account is refused with 409, even when
   * that account belongs to another organization. Attaching an existing
   * account would let one tenant pull someone in without their consent, and
   * nothing that exists in this product needs it. The unique index decides,
   * not a check made first, so two admins adding one address cannot both win.
   *
   * Always MEMBER, never taken from the request: the organization has one
   * Admin — whoever created it — and adding people does not make another.
   *
   * The password is hashed before the transaction opens, as registration
   * does, so a connection is not held across the slow part.
   */
  async createMember(
    organizationId: string,
    input: CreateMemberRequest,
  ): Promise<OrganizationMembershipResponse> {
    const passwordHash = await this.passwords.hash(input.temporaryPassword);

    let membership;

    try {
      membership = await this.prisma.$transaction(async (tx) => {
        // Soft deletion could land between admission and this write. The
        // answer then is the one admission would have given.
        const organization = await tx.organization.findFirst({
          where: { id: organizationId, deletedAt: null },
          select: { id: true },
        });

        if (!organization) {
          throw organizationNotFound();
        }

        const user = await tx.user.create({
          data: {
            email: input.email,
            name: input.name,
            passwordHash,
            passwordChangeRequired: true,
          },
          select: { id: true },
        });

        return tx.membership.create({
          data: { organizationId, userId: user.id, role: 'MEMBER' },
          select: membershipSelection,
        });
      });
    } catch (error) {
      const hint = uniqueViolationHint(error);

      if (hint?.includes('email')) {
        throw emailAlreadyRegistered();
      }

      throw error;
    }

    // Ids and the role only: never the email, and never the password.
    this.logger.log('Added a member with a one-time password', {
      organizationId,
      membershipId: membership.id,
      userId: membership.user.id,
      role: membership.role,
    });

    return toOrganizationMembershipResponse(membership);
  }
}
