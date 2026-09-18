import {
  createServiceSchema,
  updateServiceSchema,
} from './services.schemas.js';

const TEAM = '0199a1b2-c3d4-7000-8000-0000000000c1';

describe('service schemas', () => {
  describe('createServiceSchema', () => {
    it('should trim the name and description, and keep the owner and criticality', () => {
      expect(
        createServiceSchema.parse({
          name: '  Payment API  ',
          description: '  Takes card payments.  ',
          ownerTeamId: TEAM,
          criticality: 'CRITICAL',
        }),
      ).toEqual({
        name: 'Payment API',
        description: 'Takes card payments.',
        ownerTeamId: TEAM,
        criticality: 'CRITICAL',
      });
    });

    it('should accept a name and owner alone, leaving criticality to the default', () => {
      expect(
        createServiceSchema.parse({ name: 'Storefront', ownerTeamId: TEAM }),
      ).toEqual({ name: 'Storefront', ownerTeamId: TEAM });
    });

    it.each(['', '   '])(
      'should store the blank description %j as null',
      (description) => {
        expect(
          createServiceSchema.parse({
            name: 'Storefront',
            ownerTeamId: TEAM,
            description,
          }),
        ).toEqual({ name: 'Storefront', ownerTeamId: TEAM, description: null });
      },
    );

    it('should require an owning team', () => {
      expect(
        createServiceSchema.safeParse({ name: 'Storefront' }).success,
      ).toBe(false);
      expect(
        createServiceSchema.safeParse({ name: 'Storefront', ownerTeamId: null })
          .success,
      ).toBe(false);
    });

    it('should refuse a malformed owner id', () => {
      const result = createServiceSchema.safeParse({
        name: 'Storefront',
        ownerTeamId: 'not-a-uuid',
      });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.path).toEqual(['ownerTeamId']);
    });

    it.each(['', '   ', 'x'.repeat(101)])(
      'should refuse the name %j',
      (name) => {
        expect(
          createServiceSchema.safeParse({ name, ownerTeamId: TEAM }).success,
        ).toBe(false);
      },
    );

    it('should refuse a description over 500 characters', () => {
      expect(
        createServiceSchema.safeParse({
          name: 'Storefront',
          ownerTeamId: TEAM,
          description: 'x'.repeat(501),
        }).success,
      ).toBe(false);
    });

    it.each(['critical', 'MEDIUM', 'TIER_1', 1, ''])(
      'should refuse the criticality %j',
      (criticality) => {
        expect(
          createServiceSchema.safeParse({
            name: 'Storefront',
            ownerTeamId: TEAM,
            criticality,
          }).success,
        ).toBe(false);
      },
    );

    it.each([
      { slug: 'chosen' },
      { organizationId: '0199a1b2-c3d4-7000-8000-00000000000a' },
      { id: '0199a1b2-c3d4-7000-8000-0000000000d1' },
      { status: 'HEALTHY' },
    ])('should refuse the extra key in %o', (extra) => {
      expect(
        createServiceSchema.safeParse({
          name: 'Storefront',
          ownerTeamId: TEAM,
          ...extra,
        }).success,
      ).toBe(false);
    });
  });

  describe('updateServiceSchema', () => {
    it.each([
      { name: 'Checkout' },
      { description: null },
      { ownerTeamId: TEAM },
      { criticality: 'LOW' },
      { archived: true },
      { archived: false },
    ])('should accept %o alone', (body) => {
      expect(updateServiceSchema.safeParse(body).success).toBe(true);
    });

    it('should refuse an empty change', () => {
      expect(updateServiceSchema.safeParse({}).success).toBe(false);
    });

    it('should refuse clearing the owner: ownership moves, it is never removed', () => {
      expect(updateServiceSchema.safeParse({ ownerTeamId: null }).success).toBe(
        false,
      );
    });

    it.each([{ archived: 'yes' }, { archived: null }])(
      'should refuse the archived state %o: it is a boolean',
      (body) => {
        expect(updateServiceSchema.safeParse(body).success).toBe(false);
      },
    );

    it.each([
      { slug: 'chosen' },
      { organizationId: TEAM },
      { archivedAt: '2026-09-18T00:00:00.000Z' },
    ])('should refuse the extra key in %o', (extra) => {
      expect(
        updateServiceSchema.safeParse({ name: 'Checkout', ...extra }).success,
      ).toBe(false);
    });
  });
});
