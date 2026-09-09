import { envSchema } from './env.validation.js';

const DATABASE_URL =
  'postgresql://postgres:password@localhost:5432/sentinelops';
const JWT_SECRET = 'a-test-signing-key-of-at-least-32-characters';

/** The minimum valid environment: everything else in the schema has a default. */
const valid = () => ({ DATABASE_URL, JWT_SECRET });

/** What the schema produces from `valid()` alone, defaults included. */
const defaults = {
  NODE_ENV: 'development',
  PORT: 3001,
  DATABASE_URL,
  JWT_SECRET,
  JWT_ISSUER: 'sentinelops',
  JWT_ACCESS_TTL_SECONDS: 900,
  REFRESH_TOKEN_TTL_DAYS: 30,
  CORS_ORIGIN: 'http://localhost:3000',
};

/** The first issue Zod reports for `key`, or undefined when `key` validated. */
const issueFor = (env: Record<string, unknown>, key: string) => {
  const result = envSchema.safeParse(env);

  return result.success
    ? undefined
    : result.error.issues.find((issue) => issue.path[0] === key);
};

describe('envSchema', () => {
  describe('valid configuration', () => {
    it('should accept a fully specified environment', () => {
      expect(
        envSchema.parse({
          NODE_ENV: 'production',
          PORT: '8080',
          DATABASE_URL,
          JWT_SECRET,
        }),
      ).toEqual({ ...defaults, NODE_ENV: 'production', PORT: 8080 });
    });

    it('should coerce PORT from a string to a number', () => {
      // Environment variables always arrive as strings, so the coercion here is
      // what lets app.port be consumed as a number without a cast.
      expect(typeof envSchema.parse({ ...valid(), PORT: '3001' }).PORT).toBe(
        'number',
      );
    });

    it('should accept both postgres:// and postgresql:// URLs', () => {
      for (const url of [
        'postgres://u:p@localhost:5432/db',
        'postgresql://u:p@localhost:5432/db',
      ]) {
        expect(
          envSchema.safeParse({ ...valid(), DATABASE_URL: url }).success,
        ).toBe(true);
      }
    });

    it('should ignore variables it does not declare', () => {
      // POSTGRES_* belongs to Docker Compose and REDIS_URL to a system that
      // does not exist yet. None of them may fail the boot.
      const result = envSchema.safeParse({
        ...valid(),
        POSTGRES_USER: 'postgres',
        POSTGRES_PASSWORD: 'password',
        POSTGRES_DB: 'sentinelops',
        POSTGRES_PORT: '5432',
        REDIS_URL: 'redis://localhost:6379',
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual(defaults);
    });
  });

  describe('LOG_LEVEL', () => {
    it.each([['verbose'], ['debug'], ['log'], ['warn'], ['error'], ['fatal']])(
      'should accept %s',
      (level) => {
        expect(
          envSchema.safeParse({ ...valid(), LOG_LEVEL: level }).success,
        ).toBe(true);
      },
    );

    it('should reject a level the logger does not support', () => {
      expect(
        issueFor({ ...valid(), LOG_LEVEL: 'trace' }, 'LOG_LEVEL'),
      ).toBeDefined();
    });

    it('should be omitted from the output when unset', () => {
      // Optional rather than defaulted: the default depends on NODE_ENV and is
      // derived in the logging configuration factory instead.
      expect(envSchema.parse(valid())).not.toHaveProperty('LOG_LEVEL');
    });
  });

  describe('LOG_FORMAT', () => {
    it.each([['json'], ['pretty']])('should accept %s', (format) => {
      expect(
        envSchema.safeParse({ ...valid(), LOG_FORMAT: format }).success,
      ).toBe(true);
    });

    it('should reject an unknown format', () => {
      expect(
        issueFor({ ...valid(), LOG_FORMAT: 'logfmt' }, 'LOG_FORMAT'),
      ).toBeDefined();
    });

    it('should be omitted from the output when unset', () => {
      expect(envSchema.parse(valid())).not.toHaveProperty('LOG_FORMAT');
    });
  });

  describe('defaults', () => {
    it('should default NODE_ENV to development', () => {
      expect(envSchema.parse(valid()).NODE_ENV).toBe('development');
    });

    it('should default PORT to 3001', () => {
      expect(envSchema.parse(valid()).PORT).toBe(3001);
    });

    it('should not default DATABASE_URL or JWT_SECRET', () => {
      expect(envSchema.safeParse({}).success).toBe(false);
    });

    it('should default the authentication knobs', () => {
      expect(envSchema.parse(valid())).toMatchObject({
        JWT_ISSUER: 'sentinelops',
        JWT_ACCESS_TTL_SECONDS: 900,
        REFRESH_TOKEN_TTL_DAYS: 30,
        CORS_ORIGIN: 'http://localhost:3000',
      });
    });
  });

  describe('DATABASE_URL', () => {
    it('should reject a missing value', () => {
      expect(issueFor({}, 'DATABASE_URL')).toBeDefined();
    });

    it('should reject an empty value', () => {
      expect(issueFor({ DATABASE_URL: '' }, 'DATABASE_URL')).toBeDefined();
    });

    it('should reject a non-postgres protocol', () => {
      expect(
        issueFor(
          { DATABASE_URL: 'mysql://u:p@localhost:3306/db' },
          'DATABASE_URL',
        ),
      ).toBeDefined();
    });

    it('should reject a value that is not a URL', () => {
      expect(
        issueFor({ DATABASE_URL: 'not-a-url' }, 'DATABASE_URL'),
      ).toBeDefined();
    });
  });

  describe('PORT', () => {
    it('should reject a non-numeric value', () => {
      expect(
        issueFor({ ...valid(), PORT: 'not-a-number' }, 'PORT'),
      ).toBeDefined();
    });

    it('should reject a value above the maximum port', () => {
      expect(issueFor({ ...valid(), PORT: '99999' }, 'PORT')).toBeDefined();
    });

    it('should reject a value below the minimum port', () => {
      expect(issueFor({ ...valid(), PORT: '0' }, 'PORT')).toBeDefined();
    });

    it('should reject a non-integer value', () => {
      expect(issueFor({ ...valid(), PORT: '3001.5' }, 'PORT')).toBeDefined();
    });
  });

  describe('NODE_ENV', () => {
    it.each(['development', 'test', 'production'])(
      'should accept %s',
      (environment) => {
        expect(
          envSchema.parse({ ...valid(), NODE_ENV: environment }).NODE_ENV,
        ).toBe(environment);
      },
    );

    it('should reject an unknown environment', () => {
      expect(
        issueFor({ ...valid(), NODE_ENV: 'staging' }, 'NODE_ENV'),
      ).toBeDefined();
    });
  });

  it('should report every failure at once rather than stopping at the first', () => {
    const result = envSchema.safeParse({ NODE_ENV: 'staging', PORT: 'nope' });

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path[0]).sort()).toEqual([
      'DATABASE_URL',
      'JWT_SECRET',
      'NODE_ENV',
      'PORT',
    ]);
  });

  describe('JWT_SECRET', () => {
    it('should reject a missing value', () => {
      expect(issueFor({ DATABASE_URL }, 'JWT_SECRET')).toBeDefined();
    });

    it('should reject a secret shorter than 32 characters', () => {
      // A short secret is a guessable secret, and a guessable signing key is
      // indistinguishable from having no authentication at all.
      expect(
        issueFor({ ...valid(), JWT_SECRET: 'a'.repeat(31) }, 'JWT_SECRET'),
      ).toBeDefined();
    });

    it('should accept a secret of exactly 32 characters', () => {
      expect(
        envSchema.safeParse({ ...valid(), JWT_SECRET: 'a'.repeat(32) }).success,
      ).toBe(true);
    });
  });

  describe('token lifetimes', () => {
    it('should coerce the TTLs from strings to numbers', () => {
      const env = envSchema.parse({
        ...valid(),
        JWT_ACCESS_TTL_SECONDS: '600',
        REFRESH_TOKEN_TTL_DAYS: '7',
      });

      expect(env.JWT_ACCESS_TTL_SECONDS).toBe(600);
      expect(env.REFRESH_TOKEN_TTL_DAYS).toBe(7);
    });

    it.each([
      ['JWT_ACCESS_TTL_SECONDS', '0'],
      ['JWT_ACCESS_TTL_SECONDS', '-1'],
      ['JWT_ACCESS_TTL_SECONDS', '1.5'],
      ['REFRESH_TOKEN_TTL_DAYS', '0'],
      ['REFRESH_TOKEN_TTL_DAYS', 'nope'],
    ])('should reject %s=%s', (key, value) => {
      expect(issueFor({ ...valid(), [key]: value }, key)).toBeDefined();
    });
  });

  describe('CORS_ORIGIN', () => {
    it('should accept a comma-separated list', () => {
      expect(
        envSchema.parse({
          ...valid(),
          CORS_ORIGIN: 'http://localhost:3000,https://app.example.com',
        }).CORS_ORIGIN,
      ).toBe('http://localhost:3000,https://app.example.com');
    });

    it('should reject an empty value', () => {
      expect(
        issueFor({ ...valid(), CORS_ORIGIN: '' }, 'CORS_ORIGIN'),
      ).toBeDefined();
    });
  });
});
