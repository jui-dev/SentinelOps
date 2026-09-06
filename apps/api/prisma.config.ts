import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { defineConfig, env } from 'prisma/config';

// Prisma 7 no longer loads .env files automatically. The workspace root .env is
// this repository's single source of truth, so the Prisma CLI is pointed at
// that exact file rather than given an env mechanism of its own. Node's built-in
// loader is used deliberately: `dotenv` is only present here as a transitive
// dependency of @nestjs/config, and depending on a transitive package is fragile.
const rootEnvFile = join(import.meta.dirname, '..', '..', '.env');

if (existsSync(rootEnvFile)) {
  process.loadEnvFile(rootEnvFile);
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
