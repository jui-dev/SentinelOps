import { appConfig, configurations, databaseConfig } from './configuration.js';

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

  describe('configurations', () => {
    it('should register exactly the app and database domains', () => {
      expect(configurations).toEqual([appConfig, databaseConfig]);
    });
  });
});
