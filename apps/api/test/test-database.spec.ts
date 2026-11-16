import {
  TestDatabaseError,
  databaseNameOf,
  resolveTestDatabaseUrl,
  withDatabase,
} from './test-database.js';

const DEV = 'postgresql://postgres:password@localhost:5432/sentinelops';
const TEST = 'postgresql://postgres:password@localhost:5432/sentinelops_test';

/**
 * The guard is the only thing standing between `TRUNCATE` and a developer's
 * data, so it is tested like any other unit. Needs no database.
 */
describe('test database guard', () => {
  const env = (overrides: Record<string, string | undefined>) =>
    overrides as NodeJS.ProcessEnv;

  describe('databaseNameOf', () => {
    it('should read the database name from a url', () => {
      expect(databaseNameOf(TEST)).toBe('sentinelops_test');
    });

    it.each([
      ['undefined', undefined],
      ['an empty string', ''],
      ['a non-url', 'not-a-url'],
      ['a non-postgres protocol', 'mysql://u:p@localhost:3306/db'],
      [
        'a url with no database',
        'postgresql://postgres:password@localhost:5432',
      ],
    ])('should return undefined for %s', (_case, url) => {
      expect(databaseNameOf(url)).toBeUndefined();
    });
  });

  describe('withDatabase', () => {
    it('should swap the database while keeping credentials and host', () => {
      expect(withDatabase(TEST, 'postgres')).toBe(
        'postgresql://postgres:password@localhost:5432/postgres',
      );
    });
  });

  describe('accepting a dedicated test database', () => {
    it('should return the url when every rule holds', () => {
      expect(
        resolveTestDatabaseUrl(
          env({ TEST_DATABASE_URL: TEST, DATABASE_URL: DEV }),
        ),
      ).toBe(TEST);
    });

    it('should not require DATABASE_URL to be set', () => {
      expect(resolveTestDatabaseUrl(env({ TEST_DATABASE_URL: TEST }))).toBe(
        TEST,
      );
    });

    it('should accept a different host with a _test database', () => {
      const remote = 'postgresql://u:p@db.internal:5432/sentinelops_test';

      expect(resolveTestDatabaseUrl(env({ TEST_DATABASE_URL: remote }))).toBe(
        remote,
      );
    });
  });

  describe('refusing anything else', () => {
    it('should refuse when TEST_DATABASE_URL is unset', () => {
      expect(() => resolveTestDatabaseUrl(env({ DATABASE_URL: DEV }))).toThrow(
        TestDatabaseError,
      );
    });

    it('should never fall back to DATABASE_URL', () => {
      // A fallback is exactly how a suite ends up truncating development data.
      expect(() => resolveTestDatabaseUrl(env({ DATABASE_URL: DEV }))).toThrow(
        /TEST_DATABASE_URL is not set/,
      );
    });

    it('should refuse a database that does not end with _test', () => {
      expect(() =>
        resolveTestDatabaseUrl(env({ TEST_DATABASE_URL: DEV })),
      ).toThrow(/does not end with "_test"/);
    });

    it('should refuse when it matches the development database name', () => {
      // The pathological case rule 2 alone would wave through: the development
      // database is itself named with a _test suffix.
      const both =
        'postgresql://postgres:password@localhost:5432/sentinelops_test';

      expect(() =>
        resolveTestDatabaseUrl(
          env({ TEST_DATABASE_URL: both, DATABASE_URL: both }),
        ),
      ).toThrow(/both point at "sentinelops_test"/);
    });

    it.each([
      ['a non-url', 'not-a-url'],
      [
        'a non-postgres protocol',
        'mysql://u:p@localhost:3306/sentinelops_test',
      ],
      [
        'a url with no database',
        'postgresql://postgres:password@localhost:5432',
      ],
    ])('should refuse %s', (_case, url) => {
      expect(() =>
        resolveTestDatabaseUrl(env({ TEST_DATABASE_URL: url })),
      ).toThrow(TestDatabaseError);
    });

    it('should refuse a name that is not a plain identifier', () => {
      // The setup step interpolates this name into CREATE DATABASE.
      const injected =
        'postgresql://postgres:password@localhost:5432/x%22%3B%20DROP_test';

      expect(() =>
        resolveTestDatabaseUrl(env({ TEST_DATABASE_URL: injected })),
      ).toThrow(/not a plain identifier/);
    });
  });
});
