import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';

import {
  appConfig,
  configurations,
  databaseConfig,
} from './../src/config/configuration.js';
import { envSchema } from './../src/config/env.validation.js';

const DATABASE_URL =
  'postgresql://postgres:password@localhost:5432/sentinelops';

/**
 * Mirrors AppModule's registration minus the env file: `ignoreEnvFile` keeps the
 * developer's real workspace .env out of these assertions, so the stubbed
 * process.env is the only input.
 */
const bootConfigModule = () =>
  Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        validationSchema: envSchema,
        load: configurations,
      }),
    ],
  }).compile();

describe('Configuration (e2e)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('a valid environment', () => {
    let moduleRef: TestingModule;

    beforeEach(async () => {
      vi.stubEnv('NODE_ENV', 'test');
      vi.stubEnv('PORT', '3001');
      vi.stubEnv('DATABASE_URL', DATABASE_URL);

      moduleRef = await bootConfigModule();
    });

    afterEach(async () => {
      await moduleRef.close();
    });

    it('should expose the app domain by dot path', () => {
      const config = moduleRef.get(ConfigService);

      expect(config.get('app.port')).toBe(3001);
      expect(config.get('app.environment')).toBe('test');
    });

    it('should expose the database domain by dot path', () => {
      expect(moduleRef.get(ConfigService).get('database.url')).toBe(
        DATABASE_URL,
      );
    });

    it('should resolve the domains by injection token', () => {
      expect(moduleRef.get(appConfig.KEY)).toEqual({
        port: 3001,
        environment: 'test',
      });
      expect(moduleRef.get(databaseConfig.KEY)).toEqual({ url: DATABASE_URL });
    });

    it('should preserve the port as a number through the container', () => {
      expect(typeof moduleRef.get(ConfigService).get('app.port')).toBe(
        'number',
      );
    });
  });

  describe('an invalid environment', () => {
    // Each case stubs an invalid value rather than deleting the variable:
    // validatePredefined defaults to true, so a deleted key could be repopulated
    // from the ambient environment and make the assertion flaky.
    const cases = [
      ['a malformed DATABASE_URL', 'DATABASE_URL', 'not-a-url'],
      [
        'a non-postgres DATABASE_URL',
        'DATABASE_URL',
        'mysql://u:p@localhost/db',
      ],
      ['a non-numeric PORT', 'PORT', 'not-a-number'],
      ['an out-of-range PORT', 'PORT', '99999'],
      ['an unknown NODE_ENV', 'NODE_ENV', 'staging'],
    ] as const;

    beforeEach(() => {
      vi.stubEnv('NODE_ENV', 'test');
      vi.stubEnv('PORT', '3001');
      vi.stubEnv('DATABASE_URL', DATABASE_URL);
    });

    it.each(cases)('should refuse to boot with %s', async (_, key, value) => {
      vi.stubEnv(key, value);

      await expect(bootConfigModule()).rejects.toThrow(
        'Config validation error',
      );
    });

    it('should name the offending variable in the error', async () => {
      vi.stubEnv('PORT', 'not-a-number');

      await expect(bootConfigModule()).rejects.toThrow(/PORT/);
    });
  });
});
