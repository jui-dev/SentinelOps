import { Injectable, Logger } from '@nestjs/common';

import { opaqueSlug, slugify } from '../common/slug.js';
import { PrismaService } from '../database/prisma.service.js';
import { foreignKeyViolationHint } from '../database/foreign-key-violation.js';
import { uniqueViolationHint } from '../database/unique-violation.js';
import { Prisma } from '../generated/prisma/client.js';
import { membershipNotFound } from '../organizations/organizations.errors.js';
import { organizationNotFound } from '../tenancy/tenancy.errors.js';
import { isResourceId } from '../tenancy/tenancy.schemas.js';
import type { TeamMemberResponse, TeamResponse } from './teams.contract.js';
import {
  alreadyATeamMember,
  teamMemberNotFound,
  teamNameTaken,
  teamNotFound,
  teamOwnsServices,
} from './teams.errors.js';
import { toTeamMemberResponse, toTeamResponse } from './teams.responses.js';
import type {
  AddTeamMemberRequest,
  CreateTeamRequest,
  UpdateTeamRequest,
} from './teams.schemas.js';

/**
 * Prisma's answer to an update whose where matched no row: here, a team that
 * is not in this organization, or an organization soft-deleted since
 * admission.
 */
const RECORD_NOT_FOUND = 'P2025';

/** Only members whose accounts still exist are shown or counted. */
const visibleMember = { membership: { user: { deletedAt: null } } } as const;

/** Columns a team response is built from. */
const teamSelection = {
  id: true,
  name: true,
  slug: true,
  description: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: { memberships: { where: visibleMember }, services: true },
  },
} as const;

/**
 * Columns a team member response is built from. The nested user is identity
 * only — never `user.memberships`, which would disclose other organizations.
 */
const teamMemberSelection = {
  membershipId: true,
  createdAt: true,
  membership: {
    select: { user: { select: { id: true, name: true, email: true } } },
  },
} as const;

/** The slug index, by constraint name or by its columns. */
const isSlugConflict = (hint: string): boolean => hint.includes('slug');

/** The exact-name index, by constraint name or by its columns. */
const isNameConflict = (hint: string): boolean => hint.includes('name');

/** The one-row-per-team-and-member index. */
const isTeamMemberConflict = (hint: string): boolean =>
  hint.includes('team_memberships_team_id_membership_id_key') ||
  (hint.includes('team') && hint.includes('membership'));

/**
 * Which composite foreign key a team-membership insert violated. Matched on
 * the referencing column, not the table name — both constraint names begin
 * with `team_memberships_`.
 */
const violatesTeamKey = (hint: string): boolean =>
  hint.includes('team_id') || hint.includes('teamid');

const violatesMembershipKey = (hint: string): boolean =>
  hint.includes('membership_id') || hint.includes('membershipid');

/**
 * A team delete refused because services still name it as their owner.
 * Matched on the referencing column: the constraint name also contains
 * `organization_id`, which the plain organization key shares.
 */
const violatesServiceOwnerKey = (hint: string): boolean =>
  hint.includes('owner_team') || hint.includes('ownerteam');

/**
 * The slug for a name that yields none — only non-Latin script, or only
 * punctuation. Clients never supply a slug, so a name that cannot be slugged
 * gets an opaque one rather than being refused.
 */
export const fallbackTeamSlug = (): string => opaqueSlug('team');

/**
 * Teams, and who is on them.
 *
 * Resource isolation lives here, and does not rely on admission. Every method
 * takes the organization id as an explicit argument and every query filters
 * by it, so each is correct with no guard in front of it.
 *
 * Tenant consistency of team membership does not rely on this service either:
 * the composite foreign keys on team_memberships make a team member from
 * another organization unrepresentable. The checks here exist to give the
 * right 404, not to keep the data consistent.
 */
@Injectable()
export class TeamsService {
  private readonly logger = new Logger(TeamsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Every team in the organization, by name. */
  async list(organizationId: string): Promise<TeamResponse[]> {
    const teams = await this.prisma.team.findMany({
      where: { organizationId, organization: { deletedAt: null } },
      select: teamSelection,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });

    return teams.map(toTeamResponse);
  }

  /** One team, looked up by its id and the organization together. */
  async get(organizationId: string, teamId: string): Promise<TeamResponse> {
    if (!isResourceId(teamId)) {
      throw teamNotFound();
    }

    const team = await this.prisma.team.findFirst({
      where: {
        id: teamId,
        organizationId,
        organization: { deletedAt: null },
      },
      select: teamSelection,
    });

    if (!team) {
      throw teamNotFound();
    }

    return toTeamResponse(team);
  }

  /**
   * Creates a team with a slug derived from its name.
   *
   * Uniqueness is the database's: a derived-slug collision means another team
   * has a name that differs only by case or punctuation, and is answered as
   * the name being taken. A fallback slug that collides — astronomically
   * unlikely — is retried once with a fresh one.
   */
  async create(
    organizationId: string,
    input: CreateTeamRequest,
    makeFallbackSlug: () => string = fallbackTeamSlug,
  ): Promise<TeamResponse> {
    const derived = slugify(input.name);
    const candidates = derived
      ? [derived]
      : [makeFallbackSlug(), makeFallbackSlug()];

    for (const [attempt, slug] of candidates.entries()) {
      try {
        const team = await this.prisma.$transaction(async (tx) => {
          await this.requireActiveOrganization(tx, organizationId);

          return tx.team.create({
            data: {
              organizationId,
              name: input.name,
              slug,
              description: input.description ?? null,
            },
            select: teamSelection,
          });
        });

        this.logger.log('Team created', { teamId: team.id });

        return toTeamResponse(team);
      } catch (error) {
        const hint = uniqueViolationHint(error);

        if (hint === undefined) {
          throw error;
        }

        if (isNameConflict(hint)) {
          throw teamNameTaken();
        }

        if (isSlugConflict(hint)) {
          if (derived) {
            throw teamNameTaken();
          }

          if (attempt < candidates.length - 1) {
            continue;
          }
        }

        // An unrecognised constraint, or a second fallback collision: a
        // genuine fault, surfaced as a masked 500 rather than a guessed 409.
        throw error;
      }
    }

    // Unreachable: every iteration returns or throws.
    throw new Error('Team creation exhausted its slug candidates');
  }

  /**
   * Renames a team or changes its description. Never its slug.
   *
   * One statement, keyed by the (organization, id) compound unique, so a team
   * in another organization is simply not matched.
   */
  async update(
    organizationId: string,
    teamId: string,
    input: UpdateTeamRequest,
  ): Promise<TeamResponse> {
    if (!isResourceId(teamId)) {
      throw teamNotFound();
    }

    try {
      const team = await this.prisma.team.update({
        where: {
          organizationId_id: { organizationId, id: teamId },
          organization: { deletedAt: null },
        },
        data: { name: input.name, description: input.description },
        select: teamSelection,
      });

      this.logger.log('Team updated', { teamId });

      return toTeamResponse(team);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === RECORD_NOT_FOUND
      ) {
        throw teamNotFound();
      }

      const hint = uniqueViolationHint(error);

      if (hint !== undefined && isNameConflict(hint)) {
        throw teamNameTaken();
      }

      throw error;
    }
  }

  /**
   * Deletes a team, and with it only who was on it. Members stay in the
   * organization.
   *
   * A team that owns services is not deleted: the services' foreign key
   * refuses it, and that refusal is the 409. It is not checked first, which
   * would race a service being assigned to the team in between.
   */
  async delete(organizationId: string, teamId: string): Promise<void> {
    if (!isResourceId(teamId)) {
      throw teamNotFound();
    }

    let count: number;

    try {
      ({ count } = await this.prisma.team.deleteMany({
        where: {
          id: teamId,
          organizationId,
          organization: { deletedAt: null },
        },
      }));
    } catch (error) {
      const hint = foreignKeyViolationHint(error);

      if (hint !== undefined && violatesServiceOwnerKey(hint)) {
        throw teamOwnsServices();
      }

      throw error;
    }

    if (count === 0) {
      throw teamNotFound();
    }

    this.logger.log('Team deleted', { teamId });
  }

  /** The team's members whose accounts still exist, by name. */
  async listMembers(
    organizationId: string,
    teamId: string,
  ): Promise<TeamMemberResponse[]> {
    await this.requireTeam(this.prisma, organizationId, teamId);

    const members = await this.prisma.teamMembership.findMany({
      where: { organizationId, teamId, ...visibleMember },
      select: teamMemberSelection,
      orderBy: [
        { membership: { user: { name: 'asc' } } },
        { membershipId: 'asc' },
      ],
    });

    return members.map(toTeamMemberResponse);
  }

  /**
   * Puts an organization member on the team.
   *
   * The team and the membership are each looked up within the organization
   * first, for the right 404. Between those reads and the insert either could
   * be deleted; the composite foreign keys then refuse the insert, and that
   * violation is answered with the same 404 the read would have given.
   */
  async addMember(
    organizationId: string,
    teamId: string,
    input: AddTeamMemberRequest,
  ): Promise<TeamMemberResponse> {
    if (!isResourceId(teamId)) {
      throw teamNotFound();
    }

    let member;

    try {
      member = await this.prisma.$transaction(async (tx) => {
        await this.requireTeam(tx, organizationId, teamId);

        const membership = await tx.membership.findFirst({
          where: {
            id: input.membershipId,
            organizationId,
            user: { deletedAt: null },
          },
          select: { id: true },
        });

        if (!membership) {
          throw membershipNotFound();
        }

        // Scalar ids, not nested connects: both relations share
        // organizationId, and it is that shared column the foreign keys check.
        return tx.teamMembership.create({
          data: { organizationId, teamId, membershipId: membership.id },
          select: teamMemberSelection,
        });
      });
    } catch (error) {
      const unique = uniqueViolationHint(error);

      if (unique !== undefined && isTeamMemberConflict(unique)) {
        throw alreadyATeamMember();
      }

      const foreignKey = foreignKeyViolationHint(error);

      if (foreignKey !== undefined) {
        if (violatesMembershipKey(foreignKey)) {
          throw membershipNotFound();
        }

        if (violatesTeamKey(foreignKey)) {
          throw teamNotFound();
        }
      }

      throw error;
    }

    this.logger.log('Team member added', {
      teamId,
      membershipId: member.membershipId,
    });

    return toTeamMemberResponse(member);
  }

  /**
   * Takes a member off the team. They remain in the organization.
   *
   * One conditional delete. Only when it matches nothing is the team read, to
   * tell a team that is not in this organization from a membership that is
   * not on it.
   */
  async removeMember(
    organizationId: string,
    teamId: string,
    membershipId: string,
  ): Promise<void> {
    if (!isResourceId(teamId)) {
      throw teamNotFound();
    }

    if (isResourceId(membershipId)) {
      const { count } = await this.prisma.teamMembership.deleteMany({
        where: {
          organizationId,
          teamId,
          membershipId,
          team: { organization: { deletedAt: null } },
          ...visibleMember,
        },
      });

      if (count === 1) {
        this.logger.log('Team member removed', { teamId, membershipId });

        return;
      }
    }

    await this.requireTeam(this.prisma, organizationId, teamId);

    throw teamMemberNotFound();
  }

  /** The team exists in this organization, or 404. */
  private async requireTeam(
    db: Prisma.TransactionClient,
    organizationId: string,
    teamId: string,
  ): Promise<void> {
    if (!isResourceId(teamId)) {
      throw teamNotFound();
    }

    const team = await db.team.findFirst({
      where: {
        id: teamId,
        organizationId,
        organization: { deletedAt: null },
      },
      select: { id: true },
    });

    if (!team) {
      throw teamNotFound();
    }
  }

  /**
   * The organization still exists. Admission checked this, but it could be
   * soft-deleted since — and a service called with no guard must not create a
   * team in a deleted tenant.
   */
  private async requireActiveOrganization(
    tx: Prisma.TransactionClient,
    organizationId: string,
  ): Promise<void> {
    const organization = await tx.organization.findFirst({
      where: { id: organizationId, deletedAt: null },
      select: { id: true },
    });

    if (!organization) {
      throw organizationNotFound();
    }
  }
}
