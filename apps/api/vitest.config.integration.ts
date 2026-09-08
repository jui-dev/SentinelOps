import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

import { ROOT_ENV_FILE } from './src/config/env.js';

// Vitest does not read the workspace-root .env, and unlike the unit and e2e
// suites nothing here boots ConfigModule to do it. TEST_DATABASE_URL is needed
// by the global setup before any module loads, so the file is loaded here — in
// the config, which runs first and in the main process, so the forked test
// workers inherit it.
//
// Node's loader, not dotenv, for the same reason prisma.config.ts uses it:
// dotenv is only a transitive dependency of @nestjs/config here.
if (existsSync(ROOT_ENV_FILE)) {
  process.loadEnvFile(ROOT_ENV_FILE);
}

/**
 * The integration suite: real PostgreSQL, real constraints, real cascades.
 *
 * Opt-in and separate from `pnpm test` / `pnpm run test:e2e`, which stay
 * database-free. The `*.integration-spec.ts` suffix keeps these files out of the
 * unit glob — `**\/*.spec.ts` does not match a `-spec.ts` ending, the same reason
 * `*.e2e-spec.ts` files are already disjoint.
 */
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.integration-spec.ts'],
    // Creates the dedicated test database if absent and applies the committed
    // migrations to it. Runs the TEST_DATABASE_URL guard before anything
    // connects.
    globalSetup: ['./test/integration-setup.ts'],
    // The specs truncate shared tables, so they must not run concurrently.
    fileParallelism: false,
  },
});
