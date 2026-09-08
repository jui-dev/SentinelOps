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

export const appConfig = registerAs('app', () => {
  const env = readEnv();

  return {
    port: env.PORT,
    environment: env.NODE_ENV,
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
 * Every configuration domain, in the shape `ConfigModule.forRoot` expects.
 * Deliberately limited to the infrastructure that actually exists — a domain is
 * added when the thing behind it does.
 */
export const configurations = [appConfig, databaseConfig, loggingConfig];
