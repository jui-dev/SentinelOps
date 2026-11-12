import { listActivityQuerySchema } from './activity.schemas.js';

describe('listActivityQuerySchema', () => {
  it('should show the Changes view when no view is asked for', () => {
    expect(listActivityQuerySchema.parse({})).toEqual({ view: 'changes' });
  });

  it('should take an area, a person, a search and a period on Changes', () => {
    expect(
      listActivityQuerySchema.parse({
        area: 'TEAMS',
        actorId: '01934f2a-7b1c-7d3e-9f40-a1b2c3d4e5f6',
        q: '  risk ',
        since: '2026-11-05T00:00:00.000+06:00',
      }),
    ).toEqual({
      view: 'changes',
      area: 'TEAMS',
      actorId: '01934f2a-7b1c-7d3e-9f40-a1b2c3d4e5f6',
      q: 'risk',
      since: '2026-11-05T00:00:00.000+06:00',
    });
  });

  it('should refuse an area on the Security view, and Security as an area', () => {
    expect(
      listActivityQuerySchema.safeParse({ view: 'security', area: 'TEAMS' })
        .success,
    ).toBe(false);
    expect(
      listActivityQuerySchema.safeParse({ area: 'SECURITY' }).success,
    ).toBe(false);
  });

  it('should take a result on the Security view, and only there', () => {
    expect(
      listActivityQuerySchema.parse({
        view: 'security',
        result: 'SIGN_IN_BLOCKED',
      }),
    ).toEqual({ view: 'security', result: 'SIGN_IN_BLOCKED' });
    expect(
      listActivityQuerySchema.safeParse({ result: 'SIGNED_IN' }).success,
    ).toBe(false);
    expect(
      listActivityQuerySchema.safeParse({
        view: 'security',
        result: 'TEAM_CREATED',
      }).success,
    ).toBe(false);
  });

  it('should refuse a key it does not know, an empty search and a page size', () => {
    for (const query of [{ limit: '10' }, { q: '   ' }, { since: 'monday' }]) {
      expect(listActivityQuerySchema.safeParse(query).success).toBe(false);
    }
  });
});
