import { Injectable } from '@nestjs/common';

import { Permission } from '../authorization/permissions.js';
import { rolesHolding } from '../authorization/role-permissions.js';
import type { Prisma } from '../generated/prisma/client.js';
import {
  CANDIDATES_NEEDED,
  incidentRecipients,
} from './notifications.recipients.js';
import type {
  IncidentCandidates,
  IncidentNotificationType,
} from './notifications.recipients.js';

/** One timeline entry to tell people about, as the change recorded it. */
export interface IncidentNotificationEvent {
  type: IncidentNotificationType;
  activityId: string;
  /** The entry's own time, which the notification takes as its own. */
  createdAt: Date;
}

/** Only members whose accounts still exist are told anything. */
const activeMember = { user: { deletedAt: null } } as const;

/**
 * Writes the notifications a change reports, inside the transaction that
 * makes the change.
 *
 * Called by the service that owns the change, with its transaction client,
 * after it has written the timeline entries: the entries and their
 * notifications commit together or not at all, and the recipients are read
 * under whatever locks that transaction already holds. Not an event bus —
 * a call — so nothing is emitted for a change that rolls back, and nothing
 * is lost between two commits.
 *
 * Every read names the organization, so a recipient is only ever a
 * membership of the incident's own organization; the composite foreign keys
 * would refuse anything else in any case. One notification per recipient per
 * entry: the recipient rules collapse a member who qualifies twice, and the
 * (recipient, activity) unique index is the backstop.
 */
@Injectable()
export class NotificationsWriter {
  /**
   * Tells each entry's recipients about it. Several entries from one change
   * are judged independently, against the same candidates — the incident as
   * it stands after the change — read once. Returns how many were written.
   */
  async incidentActivities(
    tx: Prisma.TransactionClient,
    change: {
      organizationId: string;
      incidentId: string;
      /** The incident's responsible team once the change has applied. */
      teamId: string;
      actor: { userId: string; membershipId: string };
      events: readonly IncidentNotificationEvent[];
    },
  ): Promise<number> {
    if (change.events.length === 0) {
      return 0;
    }

    const candidates = await this.candidates(tx, change);

    const rows = change.events.flatMap((event) =>
      incidentRecipients(event.type, candidates).map(
        (recipientMembershipId) => ({
          organizationId: change.organizationId,
          recipientMembershipId,
          type: event.type,
          actorId: change.actor.userId,
          activityId: event.activityId,
          createdAt: event.createdAt,
        }),
      ),
    );

    if (rows.length === 0) {
      return 0;
    }

    // Scalar ids, not nested connects: every relation shares organizationId.
    const { count } = await tx.notification.createMany({ data: rows });

    return count;
  }

  /** Only the candidates these events' rules need, each in one query. */
  private async candidates(
    tx: Prisma.TransactionClient,
    change: {
      organizationId: string;
      incidentId: string;
      teamId: string;
      actor: { membershipId: string };
      events: readonly IncidentNotificationEvent[];
    },
  ): Promise<IncidentCandidates> {
    const needs = change.events.map(({ type }) => CANDIDATES_NEEDED[type]);
    const { organizationId } = change;

    // One after another: a transaction is one connection, which runs one
    // statement at a time whatever is awaited together.
    const team = needs.some(({ team }) => team)
      ? await tx.teamMembership.findMany({
          where: {
            organizationId,
            teamId: change.teamId,
            membership: activeMember,
          },
          select: { membershipId: true },
        })
      : [];
    const responders = needs.some(({ responders }) => responders)
      ? await tx.incidentResponder.findMany({
          where: {
            organizationId,
            incidentId: change.incidentId,
            membership: activeMember,
          },
          select: { membershipId: true, status: true },
        })
      : [];
    const admins = needs.some(({ admins }) => admins)
      ? await tx.membership.findMany({
          where: {
            organizationId,
            role: { in: rolesHolding(Permission.INCIDENTS_MANAGE) },
            ...activeMember,
          },
          select: { id: true },
        })
      : [];

    return {
      actorMembershipId: change.actor.membershipId,
      teamMemberIds: team.map(({ membershipId }) => membershipId),
      responders,
      adminIds: admins.map(({ id }) => id),
    };
  }
}
