import type { ResolvedInvitation } from './invitation-resolver.js';
import {
  toCreatedInvitationResponse,
  toInvitationLookupResponse,
  toInvitationResponse,
} from './invitations.responses.js';

const NOW = new Date('2026-09-17T12:00:00.000Z');
const CREATED = new Date('2026-09-15T12:00:00.000Z');
const EXPIRES = new Date('2026-09-22T12:00:00.000Z');

const row = {
  id: 'invitation-1',
  email: 'grace@example.com',
  role: 'MEMBER',
  expiresAt: EXPIRES,
  createdAt: CREATED,
  invitedBy: { id: 'user-1', name: 'Ada Lovelace' },
};

describe('invitation response mappers', () => {
  describe('toInvitationResponse', () => {
    it('should emit exactly the declared fields', () => {
      expect(
        toInvitationResponse(
          {
            ...row,
            tokenHash: 'secret-hash',
            acceptedAt: null,
            revokedAt: null,
            organizationId: 'org-1',
          } as typeof row,
          NOW,
        ),
      ).toEqual({
        id: 'invitation-1',
        email: 'grace@example.com',
        role: 'MEMBER',
        status: 'pending',
        expiresAt: '2026-09-22T12:00:00.000Z',
        createdAt: '2026-09-15T12:00:00.000Z',
        invitedBy: { id: 'user-1', name: 'Ada Lovelace' },
      });
    });

    it('should report an open invitation past its expiry as expired', () => {
      expect(
        toInvitationResponse(row, new Date('2026-09-22T12:00:00.000Z')).status,
      ).toBe('expired');
    });
  });

  describe('toCreatedInvitationResponse', () => {
    it('should carry the token beside the invitation, not inside it', () => {
      const response = toCreatedInvitationResponse(row, 'the-token', true, NOW);

      expect(response).toEqual({
        invitation: toInvitationResponse(row, NOW),
        token: 'the-token',
        replacedExisting: true,
      });
      expect(JSON.stringify(response.invitation)).not.toContain('the-token');
    });
  });

  describe('toInvitationLookupResponse', () => {
    const resolved: ResolvedInvitation = {
      id: 'invitation-1',
      organizationId: 'org-1',
      email: 'grace@example.com',
      role: 'ADMIN',
      expiresAt: EXPIRES,
      acceptedAt: null,
      revokedAt: null,
      organization: {
        id: 'org-1',
        name: 'Acme Operations',
        slug: 'acme-ops',
        createdAt: CREATED,
        deletedAt: null,
      },
      invitedBy: { name: 'Ada Lovelace' },
    };

    it('should tell the holder what they are offered, and nothing internal', () => {
      expect(toInvitationLookupResponse(resolved)).toEqual({
        organization: {
          id: 'org-1',
          name: 'Acme Operations',
          slug: 'acme-ops',
        },
        email: 'grace@example.com',
        role: 'ADMIN',
        expiresAt: '2026-09-22T12:00:00.000Z',
        invitedBy: { name: 'Ada Lovelace' },
      });
    });
  });
});
