import { Injectable, Logger } from '@nestjs/common';

import { recordActivity } from '../activity/activity.recorder.js';
import type { OrganizationResponse } from '../auth/auth.contract.js';
import { emailAlreadyRegistered } from '../auth/auth.errors.js';
import { toOrganizationResponse } from '../auth/auth.responses.js';
import { PasswordService } from '../auth/password.service.js';
import { Permission } from '../authorization/permissions.js';
import {
  hasPermission,
  permissionsFor,
  rolesHolding,
} from '../authorization/role-permissions.js';
import { PrismaService } from '../database/prisma.service.js';
import { foreignKeyViolationHint } from '../database/foreign-key-violation.js';
import { uniqueViolationHint } from '../database/unique-violation.js';
import { Prisma } from '../generated/prisma/client.js';
import { Role } from '../generated/prisma/enums.js';
import { teamNotFound } from '../teams/teams.errors.js';
import { organizationNotFound } from '../tenancy/tenancy.errors.js';
import { isResourceId } from '../tenancy/tenancy.schemas.js';
import type {
  OrganizationDetailResponse,
  OrganizationMembershipResponse,
  OrganizationRoleResponse,
} from './organizations.contract.js';
import {
  cannotRemoveSelf,
  cannotResetOwnPassword,
  lastAdmin,
  memberHasOpenWork,
  memberNotRemoved,
  memberOfOtherOrganizations,
  memberRemoved,
  membershipNotFound,
} from './organizations.errors.js';
import {
  toOrganizationDetailResponse,
  toOrganizationMembershipResponse,
} from './organizations.responses.js';
import type {
  ChangeRoleRequest,
  CreateMemberRequest,
  ResetPasswordRequest,
  RestoreMemberRequest,
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
  isDemo: true,
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
  removedAt: true,
  removedBy: { select: { id: true, name: true } },
} as const;

/** The incident a piece of open work belongs to: enough to name and link it. */
const openWorkIncident = {
  select: { incident: { select: { number: true, title: true } } },
  orderBy: { incident: { number: 'asc' } },
} as const;

/**
 * A membership as whoever manages members reads it: with the open work that
 * would stop removing them — a response under way, an unpublished analysis
 * they own.
 */
const managedMembershipSelection = {
  ...membershipSelection,
  incidentResponses: {
    where: { status: 'INVESTIGATING' },
    ...openWorkIncident,
  },
  analysesOwned: { where: { status: 'DRAFT' }, ...openWorkIncident },
} as const;

/**
 * Removed members are seen only by whoever manages members, to restore them;
 * for everyone else they are gone, as if they never belonged.
 */
const removedVisibleTo = (reader: MembershipReader) =>
  hasPermission(reader.role, Permission.MEMBERS_MANAGE)
    ? {}
    : { removedAt: null };

/** Locks the organization's Admins who still belong, in one statement. */
const lockAdmins = (tx: Prisma.TransactionClient, organizationId: string) =>
  tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM memberships
    WHERE organization_id = ${organizationId}::uuid
      AND role = 'ADMIN' AND removed_at IS NULL
    ORDER BY id
    FOR UPDATE`;

/**
 * Organization-scoped reads, and adding a member.
 *
 * Resource isolation lives here, and does not rely on admission. Every method
 * takes the organization id as an explicit argument — never from the request
 * context — and every query filters by it, so each one is correct even when
 * called with no guard in front of it. Admission answers "may this caller act
 * in this organization"; these queries answer "does this row belong to it".
 */
/** Who is reading members: their own membership, and their role. */
export interface MembershipReader {
  membershipId: string;
  role: Role;
}

/**
 * Which members a reader may see. With `memberships:read-all`, all of them;
 * otherwise themselves, anyone on a team they are on now, and whoever
 * decides on incidents — the Admins and Incident Managers: the people they
 * respond with, and whom to ask.
 * A condition joined to every read, so a member outside it is not found,
 * the same as one that does not exist.
 */
export const membershipScope = (
  reader: MembershipReader,
): Prisma.MembershipWhereInput =>
  hasPermission(reader.role, Permission.MEMBERSHIPS_READ_ALL)
    ? {}
    : {
        OR: [
          { id: reader.membershipId },
          { role: { in: rolesHolding(Permission.INCIDENTS_MANAGE) } },
          {
            teamMemberships: {
              some: {
                team: {
                  memberships: { some: { membershipId: reader.membershipId } },
                },
              },
            },
          },
        ],
      };

/**
 * A member's teams as the activity log keeps them: names, comma-separated,
 * or null for none — a snapshot that reads the same after a team is renamed.
 */
const teamNamesOf = (
  teamMemberships: { team: { name: string } }[],
): string | null =>
  teamMemberships.length > 0
    ? teamMemberships.map(({ team }) => team.name).join(', ')
    : null;

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
   * `actorId` is who renamed it, for the activity log, which records the
   * old and new name in the same transaction. Renaming to the same name
   * records nothing.
   */
  async updateOrganization(
    organizationId: string,
    input: UpdateOrganizationRequest,
    actorId: string,
  ): Promise<OrganizationResponse> {
    try {
      const organization = await this.prisma.$transaction(async (tx) => {
        const before = await tx.organization.findFirst({
          where: { id: organizationId, deletedAt: null },
          select: { name: true },
        });
        const updated = await tx.organization.update({
          where: { id: organizationId, deletedAt: null },
          data: { name: input.name },
          select: organizationSelection,
        });

        await recordActivity(tx, {
          organizationId,
          action: 'ORGANIZATION_UPDATED',
          actorId,
          subject: { type: 'ORGANIZATION', id: updated.id, name: updated.name },
          changes: [
            {
              field: 'name',
              before: before?.name ?? null,
              after: updated.name,
            },
          ],
          onlyIfChanged: true,
        });

        return updated;
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
    reader: MembershipReader,
  ): Promise<OrganizationMembershipResponse[]> {
    const memberships = await this.prisma.membership.findMany({
      where: {
        organizationId,
        organization: { deletedAt: null },
        user: { deletedAt: null },
        ...removedVisibleTo(reader),
        ...membershipScope(reader),
      },
      select: hasPermission(reader.role, Permission.MEMBERS_MANAGE)
        ? managedMembershipSelection
        : membershipSelection,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    const accountSetup = hasPermission(reader.role, Permission.MEMBERS_MANAGE);

    return memberships.map((membership) =>
      toOrganizationMembershipResponse(membership, { accountSetup }),
    );
  }

  /**
   * Every role the organization has, in the enum's order — who sets up,
   * decides, raises, works — each with what it permits and how many hold
   * it. Every role is listed, held by nobody or not, so a reader learns
   * what each role is before anyone is given it.
   *
   * Counts only: who holds each role is the member list's to say, within
   * the reader's own scope.
   */
  async listRoles(organizationId: string): Promise<OrganizationRoleResponse[]> {
    const counts = await this.prisma.membership.groupBy({
      by: ['role'],
      where: {
        organizationId,
        organization: { deletedAt: null },
        user: { deletedAt: null },
        removedAt: null,
      },
      _count: { _all: true },
    });
    const held = new Map(counts.map((row) => [row.role, row._count._all]));

    return Object.values(Role).map((role) => ({
      role,
      permissions: permissionsFor(role),
      memberCount: held.get(role) ?? 0,
    }));
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
    reader: MembershipReader,
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
        ...removedVisibleTo(reader),
        ...membershipScope(reader),
      },
      select: hasPermission(reader.role, Permission.MEMBERS_MANAGE)
        ? managedMembershipSelection
        : membershipSelection,
    });

    if (!membership) {
      throw membershipNotFound();
    }

    return toOrganizationMembershipResponse(membership, {
      accountSetup: hasPermission(reader.role, Permission.MEMBERS_MANAGE),
    });
  }

  /**
   * Adds a person to the organization in the role chosen for them: creates their account with
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
   * The role is the one the request names, a Responder when it names none.
   *
   * Optionally places them on teams, in the same transaction, through the
   * ordinary TeamMembership rows. Every team must be one of this
   * organization's: the teams are read within it first, and any id that is
   * not found — malformed ones never reach here — answers 404
   * TEAM_NOT_FOUND and rolls the whole addition back, account included. The
   * composite foreign keys refuse a team from another organization in any
   * case, so a team deleted between that read and the insert is answered
   * the same way. Duplicates were collapsed by the request schema.
   *
   * The password is hashed before the transaction opens, as registration
   * does, so a connection is not held across the slow part.
   */
  async createMember(
    organizationId: string,
    input: CreateMemberRequest,
    actorId: string,
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

        // Someone removed from here comes back by being restored, keeping
        // their history: asked first, so the email's answer is not the
        // generic one an account elsewhere gets.
        const removed = await tx.membership.findFirst({
          where: {
            organizationId,
            removedAt: { not: null },
            user: { email: input.email, deletedAt: null },
          },
          select: { id: true },
        });

        if (removed) {
          throw memberRemoved();
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

        const created = await tx.membership.create({
          data: { organizationId, userId: user.id, role: input.role },
          select: { id: true },
        });

        const teamIds = input.teamIds ?? [];

        if (teamIds.length > 0) {
          const teams = await tx.team.findMany({
            where: { organizationId, id: { in: teamIds } },
            select: { id: true },
          });

          if (teams.length !== teamIds.length) {
            throw teamNotFound();
          }

          // Scalar ids, not nested connects: both relations share
          // organizationId, and it is that shared column the keys check.
          await tx.teamMembership.createMany({
            data: teamIds.map((teamId) => ({
              organizationId,
              teamId,
              membershipId: created.id,
            })),
          });
        }

        // Read back whole, teams included, as the list would show it.
        const added = await tx.membership.findUniqueOrThrow({
          where: { id: created.id },
          select: membershipSelection,
        });

        // The email names who was added; the password is never recorded.
        await recordActivity(tx, {
          organizationId,
          action: 'MEMBER_ADDED',
          actorId,
          subject: { type: 'MEMBERSHIP', id: added.id, name: added.user.name },
          changes: [
            { field: 'email', before: null, after: added.user.email },
            { field: 'role', before: null, after: added.role },
            {
              field: 'teams',
              before: null,
              after: teamNamesOf(added.teamMemberships),
            },
          ],
        });

        return added;
      });
    } catch (error) {
      const hint = uniqueViolationHint(error);

      if (hint?.includes('email')) {
        throw emailAlreadyRegistered();
      }

      const foreignKey = foreignKeyViolationHint(error);

      if (foreignKey?.includes('team_id') || foreignKey?.includes('teamid')) {
        throw teamNotFound();
      }

      throw error;
    }

    // Ids and the role only: never the email, and never the password.
    this.logger.log('Added a member with a one-time password', {
      organizationId,
      membershipId: membership.id,
      userId: membership.user.id,
      role: membership.role,
      teamCount: membership.teamMemberships.length,
    });

    // Only whoever manages members adds one, so they are told its setup.
    return toOrganizationMembershipResponse(membership, { accountSetup: true });
  }

  /**
   * Gives a member a different role. One role each, so this replaces theirs.
   *
   * The organization always keeps an Admin: the last one cannot be given
   * another role (409 LAST_ADMIN). The Admins' rows are locked first, in one
   * statement, so two changes racing to demote the last two Admins take
   * turns — the second sees the first's result and is refused.
   *
   * What the member has under way is left as it is. A Responder who becomes
   * an Incident Manager keeps the response they started, to complete; an
   * assignment stands. A role decides what they may do from now on, not what
   * they already did.
   *
   * Asking for the role they already hold changes nothing and answers 200
   * with the member.
   */
  async changeRole(
    organizationId: string,
    membershipId: string,
    input: ChangeRoleRequest,
    actorId: string,
  ): Promise<OrganizationMembershipResponse> {
    if (!isResourceId(membershipId)) {
      throw membershipNotFound();
    }

    const { membership, from } = await this.prisma.$transaction(async (tx) => {
      const admins = await lockAdmins(tx, organizationId);

      const current = await tx.membership.findFirst({
        where: {
          id: membershipId,
          organizationId,
          organization: { deletedAt: null },
          user: { deletedAt: null },
        },
        select: { id: true, role: true, removedAt: true },
      });

      if (!current) {
        throw membershipNotFound();
      }

      if (current.removedAt) {
        throw memberRemoved();
      }

      if (
        current.role === 'ADMIN' &&
        input.role !== 'ADMIN' &&
        admins.length <= 1
      ) {
        throw lastAdmin();
      }

      const membership =
        current.role === input.role
          ? await tx.membership.findUniqueOrThrow({
              where: { id: current.id },
              select: membershipSelection,
            })
          : await tx.membership.update({
              where: { id: current.id },
              data: { role: input.role },
              select: membershipSelection,
            });

      await recordActivity(tx, {
        organizationId,
        action: 'ROLE_CHANGED',
        actorId,
        subject: {
          type: 'MEMBERSHIP',
          id: membership.id,
          name: membership.user.name,
        },
        changes: [
          { field: 'role', before: current.role, after: membership.role },
        ],
        onlyIfChanged: true,
      });

      return { membership, from: current.role };
    });

    if (from !== membership.role) {
      this.logger.log("Changed a member's role", {
        organizationId,
        membershipId: membership.id,
        from,
        to: membership.role,
      });
    }

    // Only whoever manages members changes a role, so they are told its setup.
    return toOrganizationMembershipResponse(membership, { accountSetup: true });
  }

  /**
   * Gives a member a new one-time password, for someone who has forgotten
   * theirs. Their account is marked to choose a new password at next sign-in,
   * as when they were added, and every session they have ends — the
   * revocation commits with the new password, or neither happens.
   *
   * Two refusals, both 409. An Admin cannot reset their own password: they
   * change it themselves, giving the current one. And an account that also
   * belongs to another organization is refused: an account is one person's
   * everywhere, and one organization's Admin must not set the password that
   * opens the others.
   *
   * The password is hashed before the transaction opens, as adding a member
   * does, and is never logged.
   */
  async resetPassword(
    organizationId: string,
    membershipId: string,
    input: ResetPasswordRequest,
    actor: { membershipId: string; userId: string },
    now: Date = new Date(),
  ): Promise<OrganizationMembershipResponse> {
    if (!isResourceId(membershipId)) {
      throw membershipNotFound();
    }

    const passwordHash = await this.passwords.hash(input.temporaryPassword);

    const membership = await this.prisma.$transaction(async (tx) => {
      const target = await tx.membership.findFirst({
        where: {
          id: membershipId,
          organizationId,
          organization: { deletedAt: null },
          user: { deletedAt: null },
        },
        select: {
          id: true,
          userId: true,
          removedAt: true,
          user: { select: { _count: { select: { memberships: true } } } },
        },
      });

      if (!target) {
        throw membershipNotFound();
      }

      if (target.removedAt) {
        throw memberRemoved();
      }

      if (target.id === actor.membershipId) {
        throw cannotResetOwnPassword();
      }

      if (target.user._count.memberships > 1) {
        throw memberOfOtherOrganizations();
      }

      await tx.user.update({
        where: { id: target.userId },
        data: { passwordHash, passwordChangeRequired: true },
        select: { id: true },
      });

      // Signed out everywhere, as RefreshTokenService.revokeAllFor does for a
      // password change: the old password's sessions do not outlive it.
      await tx.refreshToken.updateMany({
        where: { userId: target.userId, revokedAt: null },
        data: { revokedAt: now },
      });

      const reset = await tx.membership.findUniqueOrThrow({
        where: { id: target.id },
        select: membershipSelection,
      });

      // That it happened, and to whom; never the password.
      await recordActivity(tx, {
        organizationId,
        action: 'PASSWORD_RESET',
        actorId: actor.userId,
        subject: { type: 'MEMBERSHIP', id: reset.id, name: reset.user.name },
      });

      return reset;
    });

    // Ids only: never the password.
    this.logger.log("Reset a member's password; their sessions were ended", {
      organizationId,
      membershipId: membership.id,
      userId: membership.user.id,
    });

    return toOrganizationMembershipResponse(membership, { accountSetup: true });
  }

  /**
   * Removes someone from the organization, for when they leave. Their access
   * ends with the next request they make: admission refuses a removed
   * membership. They come off their teams and lose any assignment, in the
   * same transaction; their responses, updates, and analyses stay, under
   * their name, and the row stays to point them at.
   *
   * Refused, all 409: an Admin removing themselves (CANNOT_REMOVE_SELF), the
   * last Admin (LAST_ADMIN), someone already removed (MEMBER_REMOVED), and
   * someone with open work (MEMBER_HAS_OPEN_WORK) — a response still under
   * way, or an unpublished analysis they own — which is handed over first so
   * nothing is left with nobody to finish it.
   *
   * The Admins and the target are locked first. Starting a response, taking
   * an analysis, a team place, or an assignment lock the member's row too
   * (lockActiveMembership), so none of them can land on someone whose
   * removal is committing: whichever comes second sees the first.
   *
   * They are not notified: they can no longer read this organization.
   */
  async removeMember(
    organizationId: string,
    membershipId: string,
    actor: { membershipId: string; userId: string },
    now: Date = new Date(),
  ): Promise<OrganizationMembershipResponse> {
    if (!isResourceId(membershipId)) {
      throw membershipNotFound();
    }

    const membership = await this.prisma.$transaction(async (tx) => {
      const admins = await lockAdmins(tx, organizationId);

      await tx.$queryRaw`
        SELECT id FROM memberships
        WHERE id = ${membershipId}::uuid
          AND organization_id = ${organizationId}::uuid
        FOR UPDATE`;

      const target = await tx.membership.findFirst({
        where: {
          id: membershipId,
          organizationId,
          organization: { deletedAt: null },
          user: { deletedAt: null },
        },
        select: managedMembershipSelection,
      });

      if (!target) {
        throw membershipNotFound();
      }

      if (target.removedAt) {
        throw memberRemoved();
      }

      if (target.id === actor.membershipId) {
        throw cannotRemoveSelf();
      }

      if (target.role === 'ADMIN' && admins.length <= 1) {
        throw lastAdmin();
      }

      if (target.incidentResponses.length > 0 || target.analysesOwned.length > 0) {
        throw memberHasOpenWork();
      }

      await tx.teamMembership.deleteMany({
        where: { organizationId, membershipId: target.id },
      });

      const assignments = await tx.incidentAssignee.deleteMany({
        where: { organizationId, membershipId: target.id },
      });

      const removed = await tx.membership.update({
        where: { id: target.id },
        data: { removedAt: now, removedById: actor.userId },
        select: managedMembershipSelection,
      });

      await recordActivity(tx, {
        organizationId,
        action: 'MEMBER_REMOVED',
        actorId: actor.userId,
        subject: { type: 'MEMBERSHIP', id: removed.id, name: removed.user.name },
        changes: [
          { field: 'role', before: target.role, after: null },
          {
            field: 'teams',
            before: teamNamesOf(target.teamMemberships),
            after: null,
          },
          {
            field: 'assignments',
            before: assignments.count > 0 ? String(assignments.count) : null,
            after: null,
          },
        ],
      });

      return removed;
    });

    this.logger.log('Removed a member from the organization', {
      organizationId,
      membershipId: membership.id,
      userId: membership.user.id,
    });

    return toOrganizationMembershipResponse(membership, { accountSetup: true });
  }

  /**
   * Brings back someone the Admin removed, in the role named — they may
   * return to a different job. They come back on no team, so they see no
   * incidents until they are placed; and with the password they already
   * have, which only they know. Their history is theirs again.
   *
   * 409 MEMBER_NOT_REMOVED for someone who belongs already.
   */
  async restoreMember(
    organizationId: string,
    membershipId: string,
    input: RestoreMemberRequest,
    actorId: string,
  ): Promise<OrganizationMembershipResponse> {
    if (!isResourceId(membershipId)) {
      throw membershipNotFound();
    }

    const { membership, from } = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM memberships
        WHERE id = ${membershipId}::uuid
          AND organization_id = ${organizationId}::uuid
        FOR UPDATE`;

      const target = await tx.membership.findFirst({
        where: {
          id: membershipId,
          organizationId,
          organization: { deletedAt: null },
          user: { deletedAt: null },
        },
        select: { id: true, role: true, removedAt: true },
      });

      if (!target) {
        throw membershipNotFound();
      }

      if (!target.removedAt) {
        throw memberNotRemoved();
      }

      const restored = await tx.membership.update({
        where: { id: target.id },
        data: { removedAt: null, removedById: null, role: input.role },
        select: managedMembershipSelection,
      });

      await recordActivity(tx, {
        organizationId,
        action: 'MEMBER_RESTORED',
        actorId,
        subject: {
          type: 'MEMBERSHIP',
          id: restored.id,
          name: restored.user.name,
        },
        changes: [{ field: 'role', before: null, after: restored.role }],
      });

      return { membership: restored, from: target.role };
    });

    this.logger.log('Restored a removed member', {
      organizationId,
      membershipId: membership.id,
      from,
      to: membership.role,
    });

    return toOrganizationMembershipResponse(membership, { accountSetup: true });
  }
}
