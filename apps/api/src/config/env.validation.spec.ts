import { envSchema } from './env.validation.js';

const DATABASE_URL =
  'postgresql://postgres:password@localhost:5432/sentinelops';

/** The minimum valid environment: everything else in the schema has a default. */
const valid = () => ({ DATABASE_URL });

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
        }),
      ).toEqual({ NODE_ENV: 'production', PORT: 8080, DATABASE_URL });
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
        expect(envSchema.safeParse({ DATABASE_URL: url }).success).toBe(true);
      }
    });

    it('should ignore variables it does not declare', () => {
      // POSTGRES_* belongs to Docker Compose and REDIS_URL/JWT_SECRET to systems
      // that do not exist yet. None of them may fail the boot.
      const result = envSchema.safeParse({
        ...valid(),
        POSTGRES_USER: 'postgres',
        POSTGRES_PASSWORD: 'password',
        POSTGRES_DB: 'sentinelops',
        POSTGRES_PORT: '5432',
        REDIS_URL: 'redis://localhost:6379',
        JWT_SECRET: 'replace-with-a-secure-random-secret',
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        NODE_ENV: 'development',
        PORT: 3001,
        DATABASE_URL,
      });
    });
  });

  describe('defaults', () => {
    it('should default NODE_ENV to development', () => {
      expect(envSchema.parse(valid()).NODE_ENV).toBe('development');
    });

    it('should default PORT to 3001', () => {
      expect(envSchema.parse(valid()).PORT).toBe(3001);
    });

    it('should not default DATABASE_URL', () => {
      expect(envSchema.safeParse({}).success).toBe(false);
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
      'NODE_ENV',
      'PORT',
    ]);
  });
});
