/**
 * Selects the database the integration suite runs against, and refuses to hand
 * back anything that could be a development database.
 *
 * The integration suite truncates tables. That is only acceptable against a
 * database dedicated to it, so this guard runs before any connection is opened
 * and throws rather than returning a doubtful URL. Every rule below is
 * independent — each catches a mistake the others do not.
 */

/** Databases the integration suite is allowed to touch end with this. */
export const TEST_DATABASE_SUFFIX = '_test';

/** Postgres identifiers this guard is willing to interpolate into DDL. */
const SAFE_DATABASE_NAME = /^[A-Za-z0-9_]+$/;

export class TestDatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TestDatabaseError';
  }
}

/**
 * The database name from a connection URL, or undefined when the URL is not a
 * usable Postgres URL.
 */
export const databaseNameOf = (url: string | undefined): string | undefined => {
  if (!url) {
    return undefined;
  }

  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    return undefined;
  }

  const name = parsed.pathname.replace(/^\//, '');

  return name.length > 0 ? name : undefined;
};

/**
 * Replaces the database in a connection URL, keeping credentials and host.
 * Used to reach the cluster's maintenance database in order to CREATE DATABASE.
 */
export const withDatabase = (url: string, database: string): string => {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;

  return parsed.toString();
};

/**
 * The validated TEST_DATABASE_URL.
 *
 * Rules, in order:
 *   1. TEST_DATABASE_URL is set and is a usable postgres:// URL. DATABASE_URL is
 *      never consulted as a fallback — a fallback is exactly how a suite ends up
 *      truncating a developer's data.
 *   2. Its database name ends with `_test`. Catches a TEST_DATABASE_URL that was
 *      copied from DATABASE_URL and never edited.
 *   3. Its database name differs from DATABASE_URL's. Catches the pathological
 *      case where the development database itself is named `..._test`, which
 *      rule 2 would happily wave through.
 */
export const resolveTestDatabaseUrl = (
  env: NodeJS.ProcessEnv = process.env,
): string => {
  const url = env.TEST_DATABASE_URL;

  if (!url) {
    throw new TestDatabaseError(
      'TEST_DATABASE_URL is not set. The integration suite needs a database of ' +
        'its own because it truncates tables. Add it to your .env, e.g. ' +
        'TEST_DATABASE_URL=postgresql://postgres:password@localhost:5432/sentinelops_test',
    );
  }

  const name = databaseNameOf(url);

  if (!name) {
    throw new TestDatabaseError(
      'TEST_DATABASE_URL is not a usable postgres:// or postgresql:// URL with a ' +
        'database name.',
    );
  }

  if (!name.endsWith(TEST_DATABASE_SUFFIX)) {
    throw new TestDatabaseError(
      `TEST_DATABASE_URL points at "${name}", which does not end with ` +
        `"${TEST_DATABASE_SUFFIX}". The integration suite truncates every table it ` +
        'touches and refuses to run against a database that is not clearly its own.',
    );
  }

  if (!SAFE_DATABASE_NAME.test(name)) {
    throw new TestDatabaseError(
      `TEST_DATABASE_URL points at "${name}", which is not a plain identifier. ` +
        'The setup step creates this database by name, so it must be letters, ' +
        'digits, and underscores only.',
    );
  }

  const developmentName = databaseNameOf(env.DATABASE_URL);

  if (developmentName && developmentName === name) {
    throw new TestDatabaseError(
      `TEST_DATABASE_URL and DATABASE_URL both point at "${name}". The integration ` +
        'suite would truncate your development data. Point TEST_DATABASE_URL at a ' +
        'separate database.',
    );
  }

  return url;
};
