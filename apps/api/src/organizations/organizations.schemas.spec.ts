import { updateOrganizationSchema } from './organizations.schemas.js';

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
