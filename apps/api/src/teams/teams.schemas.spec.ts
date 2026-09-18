import {
  addTeamMemberSchema,
  createTeamSchema,
  updateTeamSchema,
} from './teams.schemas.js';

const MEMBERSHIP = '0199a1b2-c3d4-7000-8000-0000000000b1';

describe('team schemas', () => {
  describe('createTeamSchema', () => {
    it('should trim the name and description', () => {
      expect(
        createTeamSchema.parse({
          name: '  Platform  ',
          description: '  Owns the runtime.  ',
        }),
      ).toEqual({ name: 'Platform', description: 'Owns the runtime.' });
    });

    it('should accept a name alone', () => {
      expect(createTeamSchema.parse({ name: 'Platform' })).toEqual({
        name: 'Platform',
      });
    });

    it.each(['', '   '])(
      'should store the blank description %j as null',
      (description) => {
        expect(
          createTeamSchema.parse({ name: 'Platform', description }),
        ).toEqual({ name: 'Platform', description: null });
      },
    );

    it.each(['', '   ', 'x'.repeat(101)])(
      'should refuse the name %j',
      (name) => {
        expect(createTeamSchema.safeParse({ name }).success).toBe(false);
      },
    );

    it('should refuse a description over 500 characters', () => {
      expect(
        createTeamSchema.safeParse({
          name: 'Platform',
          description: 'x'.repeat(501),
        }).success,
      ).toBe(false);
    });

    it.each([
      { slug: 'chosen' },
      { organizationId: '0199a1b2-c3d4-7000-8000-00000000000a' },
      { id: '0199a1b2-c3d4-7000-8000-0000000000c1' },
      { memberCount: 3 },
    ])('should refuse the extra key in %o', (extra) => {
      expect(
        createTeamSchema.safeParse({ name: 'Platform', ...extra }).success,
      ).toBe(false);
    });
  });

  describe('updateTeamSchema', () => {
    it('should accept a name, a description, or both', () => {
      expect(updateTeamSchema.parse({ name: ' SRE ' })).toEqual({
        name: 'SRE',
      });
      expect(updateTeamSchema.parse({ description: 'On call.' })).toEqual({
        description: 'On call.',
      });
    });

    it('should clear the description with null or a blank value', () => {
      expect(updateTeamSchema.parse({ description: null })).toEqual({
        description: null,
      });
      expect(updateTeamSchema.parse({ description: '  ' })).toEqual({
        description: null,
      });
    });

    it('should refuse an empty body', () => {
      expect(updateTeamSchema.safeParse({}).success).toBe(false);
    });

    it.each([{ slug: 'renamed' }, { organizationId: MEMBERSHIP }])(
      'should refuse the extra key in %o',
      (extra) => {
        expect(
          updateTeamSchema.safeParse({ name: 'SRE', ...extra }).success,
        ).toBe(false);
      },
    );
  });

  describe('addTeamMemberSchema', () => {
    it('should accept a membership id', () => {
      expect(addTeamMemberSchema.parse({ membershipId: MEMBERSHIP })).toEqual({
        membershipId: MEMBERSHIP,
      });
    });

    it.each(['', 'not-a-uuid', 42, null])(
      'should refuse the membership id %j',
      (membershipId) => {
        expect(addTeamMemberSchema.safeParse({ membershipId }).success).toBe(
          false,
        );
      },
    );

    it('should refuse a user id or organization id alongside it', () => {
      expect(
        addTeamMemberSchema.safeParse({
          membershipId: MEMBERSHIP,
          organizationId: MEMBERSHIP,
        }).success,
      ).toBe(false);
    });
  });
});
