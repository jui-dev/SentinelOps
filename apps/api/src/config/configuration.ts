import { registerAs } from '@nestjs/config';

import { envSchema } from './env.validation.js';

/**
 * Re-derives the validated environment inside each configuration factory.
 *
 * This is not redundant validation, and removing it loses type information.
 * `ConfigModule.forRoot` validates the environment exactly once and writes the
 * result back to `process.env` — but it does so via `process.env[key] =
 * `${value}``, which stringifies. The coercion that turns PORT into a number is
 * therefore discarded on the way in, and a factory reading `process.env.PORT`
 * gets the string "3001".
 *
 * The coerced object is retained internally, but @nestjs/config 12 exposes no
 * public way to reach it from here: the property lives behind the unexported
 * VALIDATED_ENV_PROPNAME constant, and `registerAs` factories are registered
 * with a hardcoded `inject: []` and are instantiated before ConfigService
 * exists, so they cannot receive it through DI either.
 *
 * Parsing again is guaranteed to succeed — forRoot already accepted this
 * environment — and keeps coercion and defaults defined in exactly one place.
 * The alternative, hand-coercing with `Number(process.env.PORT)` per factory,
 * duplicates logic the schema already owns and is free to drift from it.
 */
const readEnv = () => envSchema.parse(process.env);

/**
 * Splits the comma-separated CORS_ORIGIN into a list, tolerating the spaces a
 * human leaves after each comma and dropping empty entries from a trailing one.
 */
const parseOrigins = (value: string): string[] =>
  value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

export const appConfig = registerAs('app', () => {
  const env = readEnv();

  return {
    port: env.PORT,
    environment: env.NODE_ENV,
    corsOrigins: parseOrigins(env.CORS_ORIGIN),
  };
});

export const databaseConfig = registerAs('database', () => {
  const env = readEnv();

  return {
    url: env.DATABASE_URL,
  };
});

/**
 * Resolves the two logging knobs, defaulting each from NODE_ENV when it is not
 * set explicitly.
 *
 * The defaults encode an intent per environment rather than one compromise
 * shared by all three: production ships machine-parseable lines at `log` and
 * above; development stays human-readable and includes `debug`; tests emit only
 * `warn` and above, so per-request logging does not bury the assertion output.
 *
 * An explicit LOG_LEVEL or LOG_FORMAT always wins — including in tests, which
 * is how a spec asserts against JSON output.
 */
export const loggingConfig = registerAs('logging', () => {
  const env = readEnv();

  const level =
    env.LOG_LEVEL ??
    (env.NODE_ENV === 'production'
      ? 'log'
      : env.NODE_ENV === 'test'
        ? 'warn'
        : 'debug');

  const format =
    env.LOG_FORMAT ?? (env.NODE_ENV === 'production' ? 'json' : 'pretty');

  return { level, format };
});

/**
 * Authentication settings: how an access token is signed and for how long, how
 * long a refresh token survives, and the attributes of the cookie carrying it.
 *
 * `cookieSecure` is derived from NODE_ENV rather than configured, on the same
 * reasoning as the logging defaults above. A flag that must be false on
 * localhost and true everywhere else is a consequence, not a knob, and exposing
 * it invites a production deployment that switches it off to make something
 * work.
 *
 * `cookiePath` is scoped to the auth routes so the refresh token is not
 * attached to every ordinary API call. It is deliberately the whole `/auth`
 * subtree rather than `/auth/refresh`, because logout needs the cookie too.
 */
export const authConfig = registerAs('auth', () => {
  const env = readEnv();

  return {
    jwtSecret: env.JWT_SECRET,
    jwtIssuer: env.JWT_ISSUER,
    accessTtlSeconds: env.JWT_ACCESS_TTL_SECONDS,
    refreshTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
    cookieSecure: env.NODE_ENV === 'production',
    cookiePath: '/api/v1/auth',
  };
});

/**
 * Every configuration domain, in the shape `ConfigModule.forRoot` expects.
 * Deliberately limited to the infrastructure that actually exists — a domain is
 * added when the thing behind it does.
 */
export const configurations = [
  appConfig,
  databaseConfig,
  loggingConfig,
  authConfig,
];
