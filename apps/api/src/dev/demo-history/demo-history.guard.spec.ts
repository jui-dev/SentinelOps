import { demoHistoryRefusal, resolveAnchor } from './demo-history.guard.js';

const LOCAL = 'postgresql://postgres:password@localhost:5432/sentinelops';

describe('demoHistoryRefusal', () => {
  it.each([
    LOCAL,
    'postgresql://postgres:password@127.0.0.1:5432/sentinelops',
    'postgresql://postgres:password@[::1]:5432/sentinelops',
  ])('should accept development against %s', (databaseUrl) => {
    expect(
      demoHistoryRefusal({ environment: 'development', databaseUrl }),
    ).toBeUndefined();
  });

  it.each(['production', 'test'])('should refuse %s', (environment) => {
    expect(demoHistoryRefusal({ environment, databaseUrl: LOCAL })).toContain(
      environment,
    );
  });

  it.each([
    'postgresql://app:secret@db.example.com:5432/sentinelops',
    'postgresql://app:secret@10.0.0.12:5432/sentinelops',
    'postgresql://app:secret@localhost.example.com:5432/sentinelops',
  ])('should refuse a database elsewhere: %s', (databaseUrl) => {
    expect(
      demoHistoryRefusal({ environment: 'development', databaseUrl }),
    ).toContain('on this machine');
  });

  it('should refuse a DATABASE_URL that is not a URL', () => {
    expect(
      demoHistoryRefusal({ environment: 'development', databaseUrl: 'nope' }),
    ).toBeDefined();
  });
});

describe('resolveAnchor', () => {
  const now = new Date('2026-09-20T15:42:00.000Z');

  it('should default to today, 00:00 UTC', () => {
    expect(resolveAnchor([], now)).toEqual(
      new Date('2026-09-20T00:00:00.000Z'),
    );
  });

  it('should take a pinned day, past pnpm’s separator', () => {
    expect(resolveAnchor(['--', '--anchor=2026-08-01'], now)).toEqual(
      new Date('2026-08-01T00:00:00.000Z'),
    );
  });

  it.each(['2026-02-30', '2026-9-1', 'yesterday', ''])(
    'should refuse --anchor=%s',
    (value) => {
      expect(() => resolveAnchor([`--anchor=${value}`], now)).toThrow();
    },
  );

  it('should refuse a day after today', () => {
    expect(() => resolveAnchor(['--anchor=2026-09-21'], now)).toThrow();
  });

  it('should refuse anything else', () => {
    expect(() => resolveAnchor(['--reset-everything'], now)).toThrow();
  });
});
