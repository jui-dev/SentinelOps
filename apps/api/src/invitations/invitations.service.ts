import { Injectable, Logger } from '@nestjs/common';

import type { MembershipResponse } from '../auth/auth.contract.js';
import {
  emailAlreadyRegistered,
  unauthenticated,
} from '../auth/auth.errors.js';
import { toMembershipResponse } from '../auth/auth.responses.js';
import { mintOpaqueToken } from '../common/opaque-token.js';
import { PrismaService } from '../database/prisma.service.js';
import { uniqueViolationHint } from '../database/unique-violation.js';
import type { Prisma } from '../generated/prisma/client.js';
import { organizationNotFound } from '../tenancy/tenancy.errors.js';
import { isResourceId } from '../tenancy/tenancy.schemas.js';
import type {
  CreatedInvitationResponse,
  InvitationLookupResponse,
  InvitationResponse,
} from './invitations.contract.js';
import {
  alreadyAMember,
  invitationAlreadyPending,
  invitationEmailMismatch,
  invitationNotFound,
  invitationNotPending,
} from './invitations.errors.js';
import {
  toCreatedInvitationResponse,
  toInvitationLookupResponse,
  toInvitationResponse,
} from './invitations.responses.js';
import type { CreateInvitationRequest } from './invitations.schemas.js';
import { isUsableAt, resolveInvitationByToken } from './invitation-resolver.js';
import type {
  InvitationReader,
  ResolvedInvitation,
} from './invitation-resolver.js';

/** How long an invitation link works. A constant, not configuration. */
export const INVITATION_TTL_DAYS = 7;

const INVITATION_TTL_MS = INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000;

/**
 * Columns an invitation response is built from. Never the token hash, and
 * never acceptance or revocation state — only open invitations are listed.
 *
 * The inviter is not filtered on deletedAt: who made an offer stays true after
 * they leave.
 */
const invitationSelection = {
  id: true,
  email: true,
  role: true,
  expiresAt: true,
  createdAt: true,
  invitedBy: { select: { id: true, name: true } },
} as const;

/** The grant an accepted invitation produces, as `/auth/me` renders one. */
const membershipSelection = {
  id: true,
  role: true,
  organization: {
    select: { id: true, name: true, slug: true, createdAt: true },
  },
} as const;

/**
 * Whether a unique violation came from the one-open-invitation index. Matched
 * by its name, or by its columns where Prisma reports fields instead.
 */
const isOpenInvitationConflict = (hint: string): boolean =>
  hint.includes('invitations_open_organization_email_key') ||
  (hint.includes('organization') && hint.includes('email'));

/** Whether a unique violation came from the one-membership-per-user index. */
const isMembershipConflict = (hint: string): boolean =>
  hint.includes('memberships_organization_id_user_id_key') ||
  (hint.includes('organization') && hint.includes('user'));

/**
 * Invitations: offering a membership, and turning an offer into one.
 *
 * The organization-scoped methods follow the isolation rule every tenant
 * service does: the organization id is an explicit argument and part of every
 * predicate, so each is correct with no guard in front of it.
 *
 * The token methods take their organization from the invitation row and from
 * nowhere else.
 *
 * Acceptance validates everything it can before it writes anything, then
 * claims the invitation with a conditional update, then grants the membership
 * — all in one transaction. A failure before the claim has written nothing; a
 * failure after it rolls the claim back. Either way the invitation is still
 * open. See `claim`.
 */
@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Offers `input.role` in the organization to `input.email`, replacing any
   * open invitation for that address.
   *
   * At most one invitation per organization and email is open at a time, and
   * the database enforces it. Replacing is revoke-then-insert in one
   * transaction. When two creates for the same address overlap — both insert
   * before either commits — the second insert fails on that index and is
   * answered 409: its caller has no link, and the other caller's link is not
   * silently killed by a retry. A create that starts after another committed
   * simply replaces it, so a burst may yield several 201s; only the last
   * surviving invitation is open.
   *
   * `actor` is who is making the offer, recorded as the inviter.
   */
  async create(
    organizationId: string,
    actor: { userId: string },
    input: CreateInvitationRequest,
    now: Date = new Date(),
  ): Promise<CreatedInvitationResponse> {
    const { token, tokenHash } = mintOpaqueToken();

    let created;

    try {
      created = await this.prisma.$transaction(async (tx) => {
        await this.requireActiveOrganization(tx, organizationId);

        const member = await tx.membership.findFirst({
          where: {
            organizationId,
            user: { email: input.email, deletedAt: null },
          },
          select: { id: true },
        });

        if (member) {
          throw alreadyAMember();
        }

        const replaced = await tx.invitation.updateMany({
          where: {
            organizationId,
            email: input.email,
            acceptedAt: null,
            revokedAt: null,
          },
          data: { revokedAt: now },
        });

        const invitation = await tx.invitation.create({
          data: {
            organizationId,
            email: input.email,
            role: input.role,
            tokenHash,
            invitedById: actor.userId,
            expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
          },
          select: invitationSelection,
        });

        return { invitation, replacedExisting: replaced.count > 0 };
      });
    } catch (error) {
      const hint = uniqueViolationHint(error);

      if (hint !== undefined && isOpenInvitationConflict(hint)) {
        throw invitationAlreadyPending();
      }

      throw error;
    }

    this.logger.log('Invitation created', {
      invitationId: created.invitation.id,
      role: created.invitation.role,
      replacedExisting: created.replacedExisting,
    });

    return toCreatedInvitationResponse(
      created.invitation,
      token,
      created.replacedExisting,
      now,
    );
  }

  /**
   * Every open invitation in the organization, newest first: pending ones, and
   * expired ones that nobody has replaced or revoked yet.
   */
  async listOpen(
    organizationId: string,
    now: Date = new Date(),
  ): Promise<InvitationResponse[]> {
    const invitations = await this.prisma.invitation.findMany({
      where: {
        organizationId,
        acceptedAt: null,
        revokedAt: null,
        organization: { deletedAt: null },
      },
      select: invitationSelection,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return invitations.map((invitation) =>
      toInvitationResponse(invitation, now),
    );
  }

  /**
   * Revokes an open invitation, expired or not, so its link stops working.
   *
   * One conditional statement scoped by the organization. Only when it matches
   * nothing is the row read again, to tell an invitation that is not in this
   * organization (404) from one that is no longer open (409).
   */
  async revoke(
    organizationId: string,
    invitationId: string,
    now: Date = new Date(),
  ): Promise<void> {
    if (!isResourceId(invitationId)) {
      throw invitationNotFound();
    }

    const scope = {
      id: invitationId,
      organizationId,
      organization: { deletedAt: null },
    };

    const { count } = await this.prisma.invitation.updateMany({
      where: { ...scope, acceptedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });

    if (count === 1) {
      this.logger.log('Invitation revoked', { invitationId });

      return;
    }

    const existing = await this.prisma.invitation.findFirst({
      where: scope,
      select: { id: true },
    });

    throw existing ? invitationNotPending() : invitationNotFound();
  }

  /** What a token holder may see about a usable invitation. */
  async lookup(
    token: string,
    now: Date = new Date(),
  ): Promise<InvitationLookupResponse> {
    return toInvitationLookupResponse(
      await this.requireUsable(this.prisma, token, now),
    );
  }

  /**
   * Accepts an invitation as the signed-in user.
   *
   * Order: the invitation must be usable, the caller must still exist, their
   * email must be the invited one, and they must not already be a member.
   * Only then is the invitation claimed and the membership granted.
   */
  async accept(
    token: string,
    userId: string,
    now: Date = new Date(),
  ): Promise<MembershipResponse> {
    const { invitation, membership } = await this.prisma.$transaction(
      async (tx) => {
        const invitation = await this.requireUsable(tx, token, now);

        const caller = await tx.user.findFirst({
          where: { id: userId, deletedAt: null },
          select: { id: true, email: true },
        });

        if (!caller) {
          // As in GET /auth/me: the token verified, but its account is gone.
          throw unauthenticated('Invalid or expired access token');
        }

        if (caller.email !== invitation.email) {
          throw invitationEmailMismatch();
        }

        const existing = await tx.membership.findUnique({
          where: {
            organizationId_userId: {
              organizationId: invitation.organizationId,
              userId: caller.id,
            },
          },
          select: { id: true },
        });

        if (existing) {
          throw alreadyAMember();
        }

        await this.claim(tx, invitation, now);

        return {
          invitation,
          membership: await this.grant(tx, invitation, caller.id),
        };
      },
    );

    this.logAccepted(invitation);

    return toMembershipResponse(membership);
  }

  /**
   * Accepts an invitation by creating the account it was issued to.
   *
   * The caller — AuthService — owns what an account is and the session that
   * follows, so it supplies `createAccount`, which runs inside this
   * transaction and receives the *invitation's* email: the address is never
   * taken from the request. A unique violation it raises (the address was
   * registered concurrently) rolls the claim back and propagates to the
   * caller to translate.
   *
   * Order: the invitation must be usable, and no account may already hold the
   * address — soft-deleted ones included, since they still own their unique
   * email. Only then is the invitation claimed, the account created, and the
   * membership granted.
   */
  async acceptAsNewAccount<Account extends { id: string }>(
    token: string,
    createAccount: (
      tx: Prisma.TransactionClient,
      email: string,
    ) => Promise<Account>,
    now: Date = new Date(),
  ): Promise<{ account: Account; membership: MembershipResponse }> {
    const { invitation, account, membership } = await this.prisma.$transaction(
      async (tx) => {
        const invitation = await this.requireUsable(tx, token, now);

        const taken = await tx.user.findUnique({
          where: { email: invitation.email },
          select: { id: true },
        });

        if (taken) {
          throw emailAlreadyRegistered();
        }

        await this.claim(tx, invitation, now);

        const account = await createAccount(tx, invitation.email);

        return {
          invitation,
          account,
          membership: await this.grant(tx, invitation, account.id),
        };
      },
    );

    this.logAccepted(invitation);

    return { account, membership: toMembershipResponse(membership) };
  }

  /**
   * Answers every unusable invitation with the same 404, before anything is
   * written. Exposed so a caller can reject a bad token before doing expensive
   * work — the signup route checks it before hashing a password.
   */
  async requireUsable(
    db: InvitationReader,
    token: string,
    now: Date,
  ): Promise<ResolvedInvitation> {
    const invitation = await resolveInvitationByToken(db, token);

    if (!invitation || !isUsableAt(invitation, now)) {
      throw invitationNotFound();
    }

    return invitation;
  }

  /**
   * Consumes the invitation — the concurrency boundary.
   *
   * The checks before this read state that may already be stale, so the
   * lifecycle conditions are asserted again in the update's own predicate.
   * Postgres serialises concurrent updates of one row and re-evaluates the
   * predicate for the one that waited, so of two concurrent acceptances, or an
   * acceptance racing a revocation or a replacement, exactly one matches.
   * The loser is told what anyone with an unusable token is told.
   */
  private async claim(
    tx: Prisma.TransactionClient,
    invitation: ResolvedInvitation,
    now: Date,
  ): Promise<void> {
    const { count } = await tx.invitation.updateMany({
      where: {
        id: invitation.id,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { acceptedAt: now },
    });

    if (count !== 1) {
      throw invitationNotFound();
    }
  }

  /** Logged only once the acceptance has committed. */
  private logAccepted(invitation: ResolvedInvitation): void {
    this.logger.log('Invitation accepted', {
      invitationId: invitation.id,
      organizationId: invitation.organizationId,
      role: invitation.role,
    });
  }

  /**
   * Creates the membership the invitation offered. A unique violation here
   * means the user became a member after the check above; it rolls the claim
   * back with everything else.
   */
  private async grant(
    tx: Prisma.TransactionClient,
    invitation: ResolvedInvitation,
    userId: string,
  ) {
    try {
      return await tx.membership.create({
        data: {
          organizationId: invitation.organizationId,
          userId,
          role: invitation.role,
        },
        select: membershipSelection,
      });
    } catch (error) {
      const hint = uniqueViolationHint(error);

      if (hint !== undefined && isMembershipConflict(hint)) {
        throw alreadyAMember();
      }

      throw error;
    }
  }

  /**
   * The organization still exists. Admission checked this, but the
   * organization could be deleted since — and a service called with no guard
   * must not write an offer for a deleted tenant.
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
