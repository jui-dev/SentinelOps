import { z } from 'zod';

/**
 * The environment contract for the API, validated once during startup by
 * `ConfigModule.forRoot`. A value that fails here aborts the boot before the
 * HTTP server binds, rather than surfacing at the first read.
 *
 * Only variables the application itself reads belong in this schema. The
 * POSTGRES_* variables are Docker Compose's contract for the local container
 * (see docker/docker-compose.yml) — DATABASE_URL already carries the host,
 * port, credentials, and database name, so the API does not depend on them.
 * Variables for systems that do not exist yet (REDIS_URL, JWT_SECRET) are
 * deliberately absent: requiring them would fail the boot over infrastructure
 * nothing currently uses.
 *
 * Undeclared variables are dropped from this schema's output, but ConfigModule
 * merges them back afterwards, so the rest of process.env stays reachable
 * through ConfigService.
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  // Environment variables always arrive as strings, so the port is coerced
  // here rather than parsed by hand at the call site.
  PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  // Required with no default: there is no sensible connection string to guess,
  // and a wrong one fails slowly and confusingly at the first query.
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
});

export type Env = z.infer<typeof envSchema>;
