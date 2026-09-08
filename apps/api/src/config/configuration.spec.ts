import {
  appConfig,
  configurations,
  databaseConfig,
  loggingConfig,
} from './configuration.js';

const DATABASE_URL =
  'postgresql://postgres:password@localhost:5432/sentinelops';

describe('configuration', () => {
  beforeEach(() => {
    // ConfigModule has already validated and written these back to process.env
    // by the time the factories run, so this mirrors the real startup state.
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('PORT', '3001');
    vi.stubEnv('DATABASE_URL', DATABASE_URL);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('appConfig', () => {
    it('should expose the app domain', () => {
      expect(appConfig()).toEqual({ port: 3001, environment: 'test' });
    });

    it('should expose the port as a number, not the raw string', () => {
      // The whole reason the factory re-parses: process.env.PORT is "3001".
      expect(process.env.PORT).toBe('3001');
      expect(typeof appConfig().port).toBe('number');
    });

    it('should apply the schema defaults when the variables are absent', () => {
      vi.stubEnv('PORT', undefined);
      vi.stubEnv('NODE_ENV', undefined);

      expect(appConfig()).toEqual({ port: 3001, environment: 'development' });
    });

    it('should be registered under the app token', () => {
      expect(appConfig.KEY).toBe('CONFIGURATION(app)');
    });
  });

  describe('databaseConfig', () => {
    it('should expose the database domain', () => {
      expect(databaseConfig()).toEqual({ url: DATABASE_URL });
    });

    it('should be registered under the database token', () => {
      expect(databaseConfig.KEY).toBe('CONFIGURATION(database)');
    });
  });

  describe('loggingConfig', () => {
    it('should expose the logging domain', () => {
      // NODE_ENV is 'test' from the stub above.
      expect(loggingConfig()).toEqual({ level: 'warn', format: 'pretty' });
    });

    it.each([
      ['production', 'log', 'json'],
      ['test', 'warn', 'pretty'],
      ['development', 'debug', 'pretty'],
    ])(
      'should derive the defaults for %s',
      (environment, level, format) => {
        vi.stubEnv('NODE_ENV', environment);

        expect(loggingConfig()).toEqual({ level, format });
      },
    );

    it('should let an explicit LOG_LEVEL win over the derived default', () => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('LOG_LEVEL', 'verbose');

      expect(loggingConfig().level).toBe('verbose');
    });

    it('should let an explicit LOG_FORMAT win over the derived default', () => {
      // How a test asserts against JSON output without being production.
      vi.stubEnv('LOG_FORMAT', 'json');

      expect(loggingConfig().format).toBe('json');
    });

    it('should be registered under the logging token', () => {
      expect(loggingConfig.KEY).toBe('CONFIGURATION(logging)');
    });
  });

  describe('configurations', () => {
    it('should register exactly the app, database, and logging domains', () => {
      expect(configurations).toEqual([appConfig, databaseConfig, loggingConfig]);
    });
  });
});
