import { join } from 'node:path';

/**
 * Absolute path to the workspace-root `.env` — the single source of truth for
 * local configuration, shared with the Prisma CLI (see `prisma.config.ts`).
 *
 * Resolved from this module's own location rather than `process.cwd()` so it is
 * correct regardless of where a command is invoked from, and identical whether
 * the API runs from `src/` (vitest) or `dist/` (built output): both sit two
 * levels below `apps/api`.
 */
export const ROOT_ENV_FILE = join(
  import.meta.dirname,
  '..',
  '..',
  '..',
  '..',
  '.env',
);
