import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from './../src/generated/prisma/client.js';
import {
  databaseNameOf,
  resolveTestDatabaseUrl,
  withDatabase,
} from './test-database.js';

/** Postgres: duplicate_database — the database already exists. */
const DUPLICATE_DATABASE = '42P04';

const isDuplicateDatabase = (error: unknown): boolean => {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    if ((error as { code?: unknown }).code === DUPLICATE_DATABASE) {
      return true;
    }
  }

  // The driver adapter surfaces the SQLSTATE in the message rather than as a
  // `code` on every path, so both are checked.
  return error instanceof Error && error.message.includes(DUPLICATE_DATABASE);
};

/**
 * Prepares the dedicated test database, once per integration run.
 *
 * The guard runs first and throws before any connection is opened, so a
 * misconfigured TEST_DATABASE_URL cannot reach a CREATE DATABASE, let alone a
 * TRUNCATE.
 */
export default async function setup(): Promise<void> {
  const url = resolveTestDatabaseUrl();
  const database = databaseNameOf(url) as string;

  // CREATE DATABASE cannot run inside a transaction and cannot target the
  // database being created, so it is issued against the cluster's maintenance
  // database. PrismaClient is used rather than `pg` directly: pg is a transitive
  // dependency of the adapter, and under pnpm's strict layout depending on a
  // transitive package would mean adding one.
  const admin = new PrismaClient({
    adapter: new PrismaPg({ connectionString: withDatabase(url, 'postgres') }),
  });

  try {
    // The name is validated as a plain identifier by the guard above.
    await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
    console.log(`[integration] created database ${database}`);
  } catch (error) {
    if (!isDuplicateDatabase(error)) {
      throw error;
    }
  } finally {
    await admin.$disconnect();
  }

  // `migrate deploy` rather than `migrate dev`: it only applies committed
  // migrations and never generates one, so the test database can never become
  // the source of a migration.
  //
  // DATABASE_URL is overridden here rather than in the npm script because an
  // inline `VAR=value` prefix is POSIX-shell syntax and this project is
  // developed on Windows. prisma.config.ts calls process.loadEnvFile(), which
  // does not overwrite an already-set variable, so this value wins over .env.
  execSync('pnpm exec prisma migrate deploy', {
    cwd: join(import.meta.dirname, '..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}
