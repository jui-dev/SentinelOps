import { hashOpaqueToken } from '../common/opaque-token.js';
import {
  invitationStatusAt,
  isUsableAt,
  resolveInvitationByToken,
} from './invitation-resolver.js';
import type {
  InvitationReader,
  ResolvedInvitation,
} from './invitation-resolver.js';

const NOW = new Date('2026-09-17T12:00:00.000Z');
const LATER = new Date('2026-09-24T12:00:00.000Z');
const EARLIER = new Date('2026-09-10T12:00:00.000Z');

const resolved = (
  overrides: Partial<ResolvedInvitation> = {},
): ResolvedInvitation => ({
  id: 'invitation-1',
  organizationId: 'org-1',
  email: 'grace@example.com',
  role: 'MEMBER',
  expiresAt: LATER,
  acceptedAt: null,
  revokedAt: null,
  organization: {
    id: 'org-1',
    name: 'Acme Operations',
    slug: 'acme-ops',
    createdAt: EARLIER,
    deletedAt: null,
  },
  invitedBy: { name: 'Ada Lovelace' },
  ...overrides,
});

describe('invitation resolution', () => {
  describe('resolveInvitationByToken', () => {
    it('should look the invitation up by the hash of the token, never selecting the hash', async () => {
      const findUnique = vi.fn().mockResolvedValue(null);
      const db = { invitation: { findUnique } } as unknown as InvitationReader;

      await resolveInvitationByToken(db, 'presented-token');

      const [args] = findUnique.mock.calls[0] as [
        { where: unknown; select: Record<string, unknown> },
      ];

      expect(args.where).toEqual({
        tokenHash: hashOpaqueToken('presented-token'),
      });
      expect(args.select).not.toHaveProperty('tokenHash');
      expect(JSON.stringify(args)).not.toContain('presented-token');
    });
  });

  describe('invitationStatusAt', () => {
    it.each([
      ['pending', {}],
      ['expired', { expiresAt: EARLIER }],
      ['expired', { expiresAt: NOW }],
      ['accepted', { acceptedAt: EARLIER }],
      ['accepted', { acceptedAt: EARLIER, expiresAt: EARLIER }],
      ['revoked', { revokedAt: EARLIER }],
      ['revoked', { revokedAt: EARLIER, acceptedAt: EARLIER }],
    ] as const)('should be %s for %o', (expected, overrides) => {
      expect(invitationStatusAt(resolved(overrides), NOW)).toBe(expected);
    });
  });

  describe('isUsableAt', () => {
    it('should accept a pending invitation in a live organization', () => {
      expect(isUsableAt(resolved(), NOW)).toBe(true);
    });

    it.each([
      ['expired', resolved({ expiresAt: EARLIER })],
      ['accepted', resolved({ acceptedAt: EARLIER })],
      ['revoked', resolved({ revokedAt: EARLIER })],
      [
        'in a deleted organization',
        resolved({
          organization: { ...resolved().organization, deletedAt: EARLIER },
        }),
      ],
    ])('should refuse one that is %s', (_label, invitation) => {
      expect(isUsableAt(invitation, NOW)).toBe(false);
    });
  });
});
