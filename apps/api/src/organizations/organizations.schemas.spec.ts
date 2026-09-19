import {
  createMemberSchema,
  MAX_INITIAL_TEAMS,
  updateOrganizationSchema,
} from './organizations.schemas.js';

describe('updateOrganizationSchema', () => {
  it('should accept a name and trim it', () => {
    expect(updateOrganizationSchema.parse({ name: '  Acme Ops  ' })).toEqual({
      name: 'Acme Ops',
    });
  });

  it.each([
    ['missing', {}],
    ['empty', { name: '' }],
    ['only whitespace', { name: '   ' }],
    ['too long', { name: 'a'.repeat(101) }],
    ['not a string', { name: 42 }],
  ])('should reject a name that is %s', (_label, body) => {
    expect(updateOrganizationSchema.safeParse(body).success).toBe(false);
  });

  it.each(['slug', 'organizationId', 'role', 'deletedAt', 'id', 'membership'])(
    'should reject the extra key %s rather than drop it',
    (key) => {
      const result = updateOrganizationSchema.safeParse({
        name: 'Acme Ops',
        [key]: 'x',
      });

      expect(result.success).toBe(false);
    },
  );
});

describe('createMemberSchema', () => {
  const PAYMENTS = '0199a1b2-c3d4-7000-8000-0000000000d1';
  const PLATFORM = '0199a1b2-c3d4-7000-8000-0000000000d2';
  const valid = {
    name: 'Grace Hopper',
    email: 'grace@example.com',
    temporaryPassword: 'one-time-password-123',
  };

  it('should accept a member with no teams at all', () => {
    expect(createMemberSchema.parse(valid).teamIds).toBeUndefined();
  });

  it('should accept an empty team list', () => {
    expect(createMemberSchema.parse({ ...valid, teamIds: [] }).teamIds).toEqual(
      [],
    );
  });

  it('should collapse a team named twice, in any letter case, to one', () => {
    expect(
      createMemberSchema.parse({
        ...valid,
        teamIds: [PAYMENTS, PLATFORM, PAYMENTS, PAYMENTS.toUpperCase()],
      }).teamIds,
    ).toEqual([PAYMENTS, PLATFORM]);
  });

  it.each([['not-a-uuid'], [42], [null]])(
    'should refuse the team id %j',
    (teamId) => {
      expect(
        createMemberSchema.safeParse({ ...valid, teamIds: [teamId] }).success,
      ).toBe(false);
    },
  );

  it('should refuse a team list that is not a list', () => {
    expect(
      createMemberSchema.safeParse({ ...valid, teamIds: PAYMENTS }).success,
    ).toBe(false);
  });

  it(`should refuse more than ${MAX_INITIAL_TEAMS} teams`, () => {
    const teamIds = Array.from(
      { length: MAX_INITIAL_TEAMS + 1 },
      (_, index) =>
        `0199a1b2-c3d4-7000-8000-${String(index).padStart(12, '0')}`,
    );

    expect(createMemberSchema.safeParse({ ...valid, teamIds }).success).toBe(
      false,
    );
  });
});
