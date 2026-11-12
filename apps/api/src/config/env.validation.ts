import { LOG_LEVELS } from '@nestjs/common';
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
 * Variables for systems that do not exist yet (REDIS_URL) are deliberately
 * absent: requiring them would fail the boot over infrastructure nothing
 * currently uses.
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
  // The minimum level to emit; every level at or above it is enabled.
  //
  // Optional rather than defaulted, here and for LOG_FORMAT below, because the
  // sensible default depends on NODE_ENV and a Zod `.default()` cannot read a
  // sibling field. The derivation lives in the `logging` configuration factory,
  // which sees the whole parsed environment — so it stays in exactly one place
  // rather than being split between a default here and a fallback there.
  //
  // Taken from Nest's own LOG_LEVELS so this enum cannot drift from the levels
  // the logger actually supports.
  LOG_LEVEL: z.enum(LOG_LEVELS).optional(),
  // `json` for machine-parseable one-line entries, `pretty` for the colourised
  // human format.
  LOG_FORMAT: z.enum(['json', 'pretty']).optional(),
  // Signing key for access tokens. Required with no default, for the same
  // reason as DATABASE_URL and one more: a defaulted signing key is a key every
  // deployment that forgot to set one shares, which is indistinguishable from
  // having no authentication at all.
  //
  // 32 characters is the floor, not a recommendation. Generate one with:
  //   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
  JWT_SECRET: z.string().min(32),
  // Stamped as `iss` and required to match on verification, so a token minted
  // by another system that happens to share the secret is still rejected.
  JWT_ISSUER: z.string().min(1).default('sentinelops'),
  // Access token lifetime. Short by design: the access token carries no
  // revocation check (the guard performs no database read), so its expiry is
  // the only thing that ends a session early. Refresh covers the difference.
  //
  // Seconds rather than a "15m" string: this is validated as a number here,
  // like PORT, instead of being parsed at the point of use.
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  // Refresh token lifetime, in whole days. Rotation means a token this old is
  // only reachable by a client that has been idle for the whole period.
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  // Browser origins allowed to send credentialed requests, comma-separated.
  // The refresh cookie only reaches the API if the origin is listed here, so
  // this is load-bearing for the web app rather than decorative.
  CORS_ORIGIN: z.string().min(1).default('http://localhost:3000'),
  // Whether the invitation routes exist. Off unless switched on: invitations
  // are kept for when email delivery arrives, and until then members are
  // added by an admin with a one-time password. While off, every invitation
  // route answers exactly as an unknown path does.
  INVITATIONS_ENABLED: z.stringbool().default(false),
  // Whether anyone may create an organization from the website. Off unless
  // switched on: organizations are created by whoever runs the server, who
  // turns this on for as long as that takes. While off, POST /auth/register
  // answers exactly as an unknown path does.
  REGISTRATION_ENABLED: z.stringbool().default(false),
});

export type Env = z.infer<typeof envSchema>;
