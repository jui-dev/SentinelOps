import { lockActiveMembership } from '../organizations/active-membership.js';
import { Injectable, Logger } from '@nestjs/common';

import { recordActivity } from '../activity/activity.recorder.js';
import { opaqueSlug, slugify } from '../common/slug.js';
import { PrismaService } from '../database/prisma.service.js';
import { foreignKeyViolationHint } from '../database/foreign-key-violation.js';
import { uniqueViolationHint } from '../database/unique-violation.js';
import { Prisma } from '../generated/prisma/client.js';
import { NotificationsWriter } from '../notifications/notifications.writer.js';
import { membershipNotFound } from '../organizations/organizations.errors.js';
import { organizationNotFound } from '../tenancy/tenancy.errors.js';
import { isResourceId } from '../tenancy/tenancy.schemas.js';
import type { TeamMemberResponse, TeamResponse } from './teams.contract.js';
import {
  alreadyATeamMember,
  teamMemberNotFound,
  teamNameTaken,
  teamHasIncidents,
  teamNotFound,
  teamOwnsServices,
} from './teams.errors.js';
import { toTeamMemberResponse, toTeamResponse } from './teams.responses.js';
import { withinTeamScope } from './teams.scope.js';
import type { TeamReader } from './teams.scope.js';
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
const visibleMember = {
  membership: { user: { deletedAt: null }, removedAt: null },
} as const;

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
 * A team delete refused because incidents name it as their responsible team:
 * the constraint name, or its referencing column. Only two keys can refuse a
 * team delete — team memberships cascade — so after the owner key, a
 * `team_id` key is the incidents'. Checked after the owner key, so a team
 * that both owns services and has incidents is told about the services,
 * which can be moved.
 */
const violatesIncidentTeamKey = (hint: string): boolean =>
  hint.includes('incidents') ||
  hint.includes('team_id') ||
  hint.includes('teamid');

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
 * Visibility is a second, separate question, and only the reads ask it: which
 * of the organization's teams this particular caller may see (teams.scope.ts).
 * The two compose as conditions rather than one replacing the other, so
 * `teams:read-all` widens a reader to the organization and never past it —
 * which is why the tenant-isolation tests are written against a reader who
 * holds it. The writes do not ask it at all: they are governed by
 * `teams:manage`, and requireTeam, which they share, stays free of any
 * reader's scope.
 *
 * Tenant consistency of team membership does not rely on this service either:
 * the composite foreign keys on team_memberships make a team member from
 * another organization unrepresentable. The checks here exist to give the
 * right 404, not to keep the data consistent.
 */
@Injectable()
export class TeamsService {
  private readonly logger = new Logger(TeamsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsWriter,
  ) {}

  /**
   * The teams this reader may see in the organization, by name (see
   * teams.scope.ts): every one of them for whoever oversees the
   * organization, and for everyone else the ones they are on now.
   *
   * A reader on no team is answered with an empty list, which is the true
   * answer to what they asked, not an error.
   */
  async list(
    organizationId: string,
    reader: TeamReader,
  ): Promise<TeamResponse[]> {
    const teams = await this.prisma.team.findMany({
      where: withinTeamScope(organizationId, reader),
      select: teamSelection,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });

    return teams.map(toTeamResponse);
  }

  /**
   * One team, looked up by its id and the reader's scope together.
   *
   * A team outside that scope is 404 TEAM_NOT_FOUND, exactly as a malformed
   * id, a nonexistent team, and one in another organization are: the four
   * are indistinguishable, so the status cannot be asked which uuids name
   * real teams.
   */
  async get(
    organizationId: string,
    reader: TeamReader,
    teamId: string,
  ): Promise<TeamResponse> {
    if (!isResourceId(teamId)) {
      throw teamNotFound();
    }

    const team = await this.prisma.team.findFirst({
      where: withinTeamScope(organizationId, reader, { id: teamId }),
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
    actorId: string,
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

          const created = await tx.team.create({
            data: {
              organizationId,
              name: input.name,
              slug,
              description: input.description ?? null,
            },
            select: teamSelection,
          });

          await recordActivity(tx, {
            organizationId,
            action: 'TEAM_CREATED',
            actorId,
            subject: { type: 'TEAM', id: created.id, name: created.name },
            changes: [
              { field: 'name', before: null, after: created.name },
              {
                field: 'description',
                before: null,
                after: created.description,
              },
            ],
          });

          return created;
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
    actorId: string,
  ): Promise<TeamResponse> {
    if (!isResourceId(teamId)) {
      throw teamNotFound();
    }

    try {
      const team = await this.prisma.$transaction(async (tx) => {
        const before = await tx.team.findFirst({
          where: { id: teamId, organizationId },
          select: { name: true, description: true },
        });
        const updated = await tx.team.update({
          where: {
            organizationId_id: { organizationId, id: teamId },
            organization: { deletedAt: null },
          },
          data: { name: input.name, description: input.description },
          select: teamSelection,
        });

        await recordActivity(tx, {
          organizationId,
          action: 'TEAM_UPDATED',
          actorId,
          subject: { type: 'TEAM', id: updated.id, name: updated.name },
          changes: [
            {
              field: 'name',
              before: before?.name ?? null,
              after: updated.name,
            },
            {
              field: 'description',
              before: before?.description ?? null,
              after: updated.description,
            },
          ],
          onlyIfChanged: true,
        });

        return updated;
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
   * would race a service being assigned to the team in between. A team that
   * has been responsible for an incident is refused the same way, by the
   * incidents' key, and permanently: incidents are never deleted.
   */
  async delete(
    organizationId: string,
    teamId: string,
    actorId: string,
  ): Promise<void> {
    if (!isResourceId(teamId)) {
      throw teamNotFound();
    }

    let count: number;

    try {
      count = await this.prisma.$transaction(async (tx) => {
        const team = await tx.team.findFirst({
          where: { id: teamId, organizationId },
          select: { id: true, name: true },
        });
        const { count: deleted } = await tx.team.deleteMany({
          where: {
            id: teamId,
            organizationId,
            organization: { deletedAt: null },
          },
        });

        if (deleted === 1 && team) {
          await recordActivity(tx, {
            organizationId,
            action: 'TEAM_DELETED',
            actorId,
            subject: { type: 'TEAM', id: team.id, name: team.name },
          });
        }

        return deleted;
      });
    } catch (error) {
      const hint = foreignKeyViolationHint(error);

      if (hint !== undefined && violatesServiceOwnerKey(hint)) {
        throw teamOwnsServices();
      }

      if (hint !== undefined && violatesIncidentTeamKey(hint)) {
        throw teamHasIncidents();
      }

      throw error;
    }

    if (count === 0) {
      throw teamNotFound();
    }

    this.logger.log('Team deleted', { teamId });
  }

  /**
   * The team's members whose accounts still exist, by name.
   *
   * The reader's own teams only, unless they oversee the organization. The
   * team is established as visible *before* any placement is read, so a team
   * outside the scope answers 404 TEAM_NOT_FOUND whether or not anyone is on
   * it — never an empty roster, and never TEAM_MEMBER_NOT_FOUND, either of
   * which would say the team exists.
   */
  async listMembers(
    organizationId: string,
    reader: TeamReader,
    teamId: string,
  ): Promise<TeamMemberResponse[]> {
    await this.requireVisibleTeam(organizationId, reader, teamId);

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
   * Puts an organization member on the team, and tells them so — unless the
   * acting member placed themselves.
   *
   * The team and the membership are each looked up within the organization
   * first, for the right 404. Between those reads and the insert either could
   * be deleted; the composite foreign keys then refuse the insert, and that
   * violation is answered with the same 404 the read would have given.
   *
   * The notification is written in the same transaction, at the placement's
   * own time: both happen or neither does. Placing someone twice is refused
   * by the unique index, which rolls the second back with its notification.
   */
  async addMember(
    organizationId: string,
    teamId: string,
    input: AddTeamMemberRequest,
    actor: { membershipId: string },
  ): Promise<TeamMemberResponse> {
    if (!isResourceId(teamId)) {
      throw teamNotFound();
    }

    let member;

    try {
      member = await this.prisma.$transaction(async (tx) => {
        await this.requireTeam(tx, organizationId, teamId);

        const membership = (await lockActiveMembership(
          tx,
          organizationId,
          input.membershipId,
        ))
          ? await tx.membership.findFirst({
              where: {
                id: input.membershipId,
                organizationId,
                user: { deletedAt: null },
              },
              select: { id: true },
            })
          : null;

        if (!membership) {
          throw membershipNotFound();
        }

        // Scalar ids, not nested connects: both relations share
        // organizationId, and it is that shared column the foreign keys check.
        const placed = await tx.teamMembership.create({
          data: { organizationId, teamId, membershipId: membership.id },
          select: teamMemberSelection,
        });

        const actorUserId = await this.resolveActor(tx, organizationId, actor);

        await this.notifications.teamMembership(tx, {
          organizationId,
          teamId,
          type: 'TEAM_MEMBERSHIP_ADDED',
          memberMembershipId: placed.membershipId,
          actor: { userId: actorUserId, membershipId: actor.membershipId },
          createdAt: placed.createdAt,
        });

        await recordActivity(tx, {
          organizationId,
          action: 'TEAM_MEMBER_ADDED',
          actorId: actorUserId,
          subject: await this.teamSubject(tx, organizationId, teamId),
          changes: [
            {
              field: 'member',
              before: null,
              after: placed.membership.user.name,
            },
          ],
        });

        return placed;
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
   * Takes a member off the team, and tells them so — unless the acting
   * member took themselves off. They remain in the organization.
   *
   * One transaction: the removal and its notification commit together or not
   * at all. It first holds the team's key (see lockTeam), so it cannot
   * deadlock with the team being deleted; then one conditional delete, and
   * the notification only when that delete removed the placement — removing
   * someone who is not on the team, or twice, tells nobody. Only when nothing
   * was removed is the team read, to tell a team that is not in this
   * organization from a membership that is not on it.
   */
  async removeMember(
    organizationId: string,
    teamId: string,
    membershipId: string,
    actor: { membershipId: string },
  ): Promise<void> {
    if (!isResourceId(teamId)) {
      throw teamNotFound();
    }

    if (isResourceId(membershipId)) {
      const removed = await this.prisma.$transaction(async (tx) => {
        if (!(await this.lockTeam(tx, organizationId, teamId))) {
          return false;
        }

        // Named before they are taken off, for the activity log.
        const leaving = await tx.membership.findFirst({
          where: { id: membershipId, organizationId },
          select: { user: { select: { name: true } } },
        });

        const { count } = await tx.teamMembership.deleteMany({
          where: {
            organizationId,
            teamId,
            membershipId,
            team: { organization: { deletedAt: null } },
            ...visibleMember,
          },
        });

        if (count !== 1) {
          return false;
        }

        const actorUserId = await this.resolveActor(tx, organizationId, actor);

        await this.notifications.teamMembership(tx, {
          organizationId,
          teamId,
          type: 'TEAM_MEMBERSHIP_REMOVED',
          memberMembershipId: membershipId,
          actor: { userId: actorUserId, membershipId: actor.membershipId },
          createdAt: new Date(),
        });

        await recordActivity(tx, {
          organizationId,
          action: 'TEAM_MEMBER_REMOVED',
          actorId: actorUserId,
          subject: await this.teamSubject(tx, organizationId, teamId),
          changes: [
            {
              field: 'member',
              before: leaving?.user.name ?? null,
              after: null,
            },
          ],
        });

        return true;
      });

      if (removed) {
        this.logger.log('Team member removed', { teamId, membershipId });

        return;
      }
    }

    await this.requireTeam(this.prisma, organizationId, teamId);

    throw teamMemberNotFound();
  }

  /** The team as the activity log names it, inside the change's transaction. */
  private async teamSubject(
    tx: Prisma.TransactionClient,
    organizationId: string,
    teamId: string,
  ): Promise<{ type: 'TEAM'; id: string; name: string }> {
    const team = await tx.team.findFirstOrThrow({
      where: { id: teamId, organizationId },
      select: { id: true, name: true },
    });

    return { type: 'TEAM', id: team.id, name: team.name };
  }

  /**
   * The user behind the acting membership, within this organization: whom a
   * notification attributes the change to. A grant gone since admission is
   * answered as admission would now answer it.
   */
  private async resolveActor(
    tx: Prisma.TransactionClient,
    organizationId: string,
    actor: { membershipId: string },
  ): Promise<string> {
    const membership = await tx.membership.findFirst({
      where: {
        id: actor.membershipId,
        organizationId,
        user: { deletedAt: null },
      },
      select: { userId: true },
    });

    if (!membership) {
      throw organizationNotFound();
    }

    return membership.userId;
  }

  /**
   * Holds the team's key until the transaction ends, or answers false when
   * the organization has no such team.
   *
   * A removal deletes the placement and then writes a notification naming
   * the team, whose foreign key takes this same lock. Taken second, it could
   * deadlock with the team being deleted — which holds the team and waits to
   * cascade the placement this transaction holds. Taken first, the deletion
   * simply waits, then cascades the new notification with the team.
   *
   * Raw SQL for one reason: Prisma's query API cannot express a locking read.
   * `FOR KEY SHARE`, the weakest lock that blocks deleting the row: renaming
   * the team, or placing others on it, is not held up.
   */
  private async lockTeam(
    tx: Prisma.TransactionClient,
    organizationId: string,
    teamId: string,
  ): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id
      FROM teams
      WHERE organization_id = ${organizationId}::uuid
        AND id = ${teamId}::uuid
      FOR KEY SHARE
    `;

    return rows.length === 1;
  }

  /**
   * The team is one this reader may see, or 404.
   *
   * Deliberately separate from requireTeam, which the management paths
   * share: those are governed by `teams:manage` and must not acquire a
   * reader's scope. This one is for reads that reach past the team itself,
   * and answers before they do.
   */
  private async requireVisibleTeam(
    organizationId: string,
    reader: TeamReader,
    teamId: string,
  ): Promise<void> {
    if (!isResourceId(teamId)) {
      throw teamNotFound();
    }

    const team = await this.prisma.team.findFirst({
      where: withinTeamScope(organizationId, reader, { id: teamId }),
      select: { id: true },
    });

    if (!team) {
      throw teamNotFound();
    }
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
