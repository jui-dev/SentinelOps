import {
  createInvitationSchema,
  invitationTokenRequestSchema,
  registerWithInvitationSchema,
} from './invitations.schemas.js';

describe('invitation schemas', () => {
  describe('createInvitationSchema', () => {
    it('should normalise the email and accept an invitable role', () => {
      expect(
        createInvitationSchema.parse({
          email: '  Grace@Example.COM ',
          role: 'ADMIN',
        }),
      ).toEqual({ email: 'grace@example.com', role: 'ADMIN' });
    });

    it.each(['OWNER', 'owner', 'member', 'SUPERADMIN', '', null])(
      'should refuse the role %j',
      (role) => {
        expect(
          createInvitationSchema.safeParse({ email: 'g@example.com', role })
            .success,
        ).toBe(false);
      },
    );

    it.each([
      { organizationId: '0199a1b2-c3d4-7000-8000-00000000000a' },
      { invitedById: '0199a1b2-c3d4-7000-8000-000000000001' },
      { expiresAt: '2030-01-01T00:00:00.000Z' },
      { token: 'chosen' },
    ])('should refuse the extra key in %o', (extra) => {
      expect(
        createInvitationSchema.safeParse({
          email: 'g@example.com',
          role: 'RESPONDER',
          ...extra,
        }).success,
      ).toBe(false);
    });

    it('should refuse an invalid email', () => {
      expect(
        createInvitationSchema.safeParse({ email: 'nope', role: 'RESPONDER' })
          .success,
      ).toBe(false);
    });
  });

  describe('invitationTokenRequestSchema', () => {
    it('should accept a minted token', () => {
      const token = 'a'.repeat(43);

      expect(invitationTokenRequestSchema.parse({ token })).toEqual({ token });
    });

    it.each([
      ['empty', { token: '' }],
      ['oversized', { token: 'a'.repeat(129) }],
      ['missing', {}],
      ['not a string', { token: 42 }],
      ['carrying extra keys', { token: 'abc', organizationId: 'x' }],
    ])('should refuse a token that is %s', (_label, body) => {
      expect(invitationTokenRequestSchema.safeParse(body).success).toBe(false);
    });
  });

  describe('registerWithInvitationSchema', () => {
    const valid = {
      token: 'a'.repeat(43),
      name: '  Grace Hopper ',
      password: 'a sufficiently long passphrase',
    };

    it('should accept a token, a name, and a password', () => {
      expect(registerWithInvitationSchema.parse(valid)).toEqual({
        ...valid,
        name: 'Grace Hopper',
      });
    });

    it.each([
      { email: 'someone-else@example.com' },
      { organizationName: 'Elsewhere' },
      { role: 'OWNER' },
    ])('should refuse the extra key in %o', (extra) => {
      expect(
        registerWithInvitationSchema.safeParse({ ...valid, ...extra }).success,
      ).toBe(false);
    });

    it('should apply the password policy', () => {
      expect(
        registerWithInvitationSchema.safeParse({ ...valid, password: 'short' })
          .success,
      ).toBe(false);
    });

    it('should refuse a blank name', () => {
      expect(
        registerWithInvitationSchema.safeParse({ ...valid, name: '   ' })
          .success,
      ).toBe(false);
    });
  });
});
