import type {
  CreatedInvitationResponse,
  InvitationLookupResponse,
  InvitationResponse,
} from './invitations.contract.js';
import type { ResolvedInvitation } from './invitation-resolver.js';

/**
 * Row-to-wire mappers for invitations. Same rules as auth.responses.ts: every
 * emitted field is named, nothing is spread from a row, and inputs are
 * structural rather than Prisma model types.
 *
 * `toCreatedInvitationResponse` is the only mapper that accepts a token, and
 * none accepts a token hash.
 */

/** An open invitation: neither accepted nor revoked. */
interface OpenInvitationRow {
  id: string;
  email: string;
  role: string;
  expiresAt: Date;
  createdAt: Date;
  invitedBy: { id: string; name: string };
}

export const toInvitationResponse = (
  invitation: OpenInvitationRow,
  now: Date,
): InvitationResponse => ({
  id: invitation.id,
  email: invitation.email,
  role: invitation.role,
  status:
    invitation.expiresAt.getTime() <= now.getTime() ? 'expired' : 'pending',
  expiresAt: invitation.expiresAt.toISOString(),
  createdAt: invitation.createdAt.toISOString(),
  invitedBy: { id: invitation.invitedBy.id, name: invitation.invitedBy.name },
});

export const toCreatedInvitationResponse = (
  invitation: OpenInvitationRow,
  token: string,
  replacedExisting: boolean,
  now: Date,
): CreatedInvitationResponse => ({
  invitation: toInvitationResponse(invitation, now),
  token,
  replacedExisting,
});

/**
 * What a token holder is shown. Never the organization's deletion state or the
 * invitation's lifecycle timestamps — a holder who can see this at all is
 * holding a usable invitation.
 */
export const toInvitationLookupResponse = (
  invitation: ResolvedInvitation,
): InvitationLookupResponse => ({
  organization: {
    id: invitation.organization.id,
    name: invitation.organization.name,
    slug: invitation.organization.slug,
  },
  email: invitation.email,
  role: invitation.role,
  expiresAt: invitation.expiresAt.toISOString(),
  invitedBy: { name: invitation.invitedBy.name },
});
