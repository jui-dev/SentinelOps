import { hashOpaqueToken } from '../common/opaque-token.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { Role } from '../generated/prisma/enums.js';

/**
 * Resolving an invitation from a presented token, for the domain operations
 * that act on it.
 *
 * Internal. Nothing here is a response: `ResolvedInvitation` carries the
 * organization's deletion state and the invitation's lifecycle timestamps,
 * which the rules below need and no client is told. Mapping one to the public
 * lookup contract is invitations.responses.ts's job, and nothing here depends
 * on that shape.
 *
 * The token is hashed and discarded. Neither it nor its hash is selected, so
 * neither can reach a caller through this value.
 */

/** Anything that can query invitations: the client, or a transaction. */
export type InvitationReader = Pick<Prisma.TransactionClient, 'invitation'>;

export interface ResolvedInvitation {
  id: string;
  organizationId: string;
  email: string;
  role: Role;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  organization: {
    id: string;
    name: string;
    slug: string;
    createdAt: Date;
    deletedAt: Date | null;
  };
  invitedBy: { name: string };
}

const resolvedInvitationSelection = {
  id: true,
  organizationId: true,
  email: true,
  role: true,
  expiresAt: true,
  acceptedAt: true,
  revokedAt: true,
  organization: {
    select: {
      id: true,
      name: true,
      slug: true,
      createdAt: true,
      deletedAt: true,
    },
  },
  // Attribution is history, not access: a soft-deleted inviter is still who
  // made the offer, so this deliberately does not filter on deletedAt.
  invitedBy: { select: { name: true } },
} as const;

/** The invitation a token names, whatever its state, or null. */
export const resolveInvitationByToken = (
  db: InvitationReader,
  token: string,
): Promise<ResolvedInvitation | null> =>
  db.invitation.findUnique({
    where: { tokenHash: hashOpaqueToken(token) },
    select: resolvedInvitationSelection,
  });

/**
 * Where an invitation is in its lifecycle. Derived, never stored: revocation
 * wins over acceptance, and expiry only matters while neither has happened.
 */
export type InvitationStatus = 'pending' | 'expired' | 'accepted' | 'revoked';

export const invitationStatusAt = (
  invitation: Pick<
    ResolvedInvitation,
    'acceptedAt' | 'revokedAt' | 'expiresAt'
  >,
  now: Date,
): InvitationStatus => {
  if (invitation.revokedAt) return 'revoked';
  if (invitation.acceptedAt) return 'accepted';
  if (invitation.expiresAt.getTime() <= now.getTime()) return 'expired';

  return 'pending';
};

/**
 * Whether the invitation can be accepted at `now`: it is pending, and its
 * organization still exists.
 *
 * A read of state that may already be stale. The claim that consumes an
 * invitation re-asserts the lifecycle conditions in its own predicate, which is
 * what makes acceptance safe under concurrency; this check is what lets every
 * other failure be answered before anything is written.
 */
export const isUsableAt = (
  invitation: ResolvedInvitation,
  now: Date,
): boolean =>
  invitation.organization.deletedAt === null &&
  invitationStatusAt(invitation, now) === 'pending';
