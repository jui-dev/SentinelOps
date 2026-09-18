/**
 * The wire contract for invitations.
 *
 * Declared rather than inferred from Prisma models, for the reason
 * auth.contract.ts gives. No response here carries the token hash, and only
 * `CreatedInvitationResponse` carries the token itself.
 */

/** Who made an offer, as the organization's own list renders them. */
export interface InviterResponse {
  id: string;
  name: string;
}

/**
 * An open invitation, as the organization that issued it sees one.
 *
 * Only open invitations are listed, so the status is one of two: `expired`
 * still occupies the email's slot until it is replaced or revoked.
 */
export interface InvitationResponse {
  id: string;
  email: string;
  role: string;
  status: 'pending' | 'expired';
  expiresAt: string;
  createdAt: string;
  invitedBy: InviterResponse;
}

/**
 * What creating an invitation returns: the one and only time the token is
 * disclosed. The client builds the link from it; the API never sees it again
 * except as something to hash.
 */
export interface CreatedInvitationResponse {
  invitation: InvitationResponse;
  token: string;
  /** Whether an open invitation for the same email was revoked to make way. */
  replacedExisting: boolean;
}

/**
 * What a token holder is told about the invitation they hold, before they
 * accept it. The organization's id and slug are included because the holder is
 * about to become a member and the client navigates by the slug.
 */
export interface InvitationLookupResponse {
  organization: { id: string; name: string; slug: string };
  email: string;
  role: string;
  expiresAt: string;
  invitedBy: { name: string };
}
