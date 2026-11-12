import {
  appConfig,
  authConfig,
  configurations,
  databaseConfig,
  featuresConfig,
  loggingConfig,
} from './configuration.js';

const DATABASE_URL =
  'postgresql://postgres:password@localhost:5432/sentinelops';
const JWT_SECRET = 'a-test-signing-key-of-at-least-32-characters';

describe('configuration', () => {
  beforeEach(() => {
    // ConfigModule has already validated and written these back to process.env
    // by the time the factories run, so this mirrors the real startup state.
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('PORT', '3001');
    vi.stubEnv('DATABASE_URL', DATABASE_URL);
    vi.stubEnv('JWT_SECRET', JWT_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe('appConfig', () => {
    it('should expose the app domain', () => {
      expect(appConfig()).toEqual({
        port: 3001,
        environment: 'test',
        corsOrigins: ['http://localhost:3000'],
      });
    });

    it('should expose the port as a number, not the raw string', () => {
      // The whole reason the factory re-parses: process.env.PORT is "3001".
      expect(process.env.PORT).toBe('3001');
      expect(typeof appConfig().port).toBe('number');
    });

    it('should apply the schema defaults when the variables are absent', () => {
      vi.stubEnv('PORT', undefined);
      vi.stubEnv('NODE_ENV', undefined);

      expect(appConfig()).toEqual({
        port: 3001,
        environment: 'development',
        corsOrigins: ['http://localhost:3000'],
      });
    });

    it('should split CORS_ORIGIN into a list, trimming the spaces', () => {
      vi.stubEnv(
        'CORS_ORIGIN',
        'http://localhost:3000, https://app.example.com,',
      );

      expect(appConfig().corsOrigins).toEqual([
        'http://localhost:3000',
        'https://app.example.com',
      ]);
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
    ])('should derive the defaults for %s', (environment, level, format) => {
      vi.stubEnv('NODE_ENV', environment);

      expect(loggingConfig()).toEqual({ level, format });
    });

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

  describe('authConfig', () => {
    it('should expose the auth domain', () => {
      // NODE_ENV is 'test' from the stub above, so the cookie is not secure.
      expect(authConfig()).toEqual({
        jwtSecret: JWT_SECRET,
        jwtIssuer: 'sentinelops',
        accessTtlSeconds: 900,
        refreshTtlDays: 30,
        cookieSecure: false,
        cookiePath: '/api/v1/auth',
      });
    });

    it('should expose the TTLs as numbers, not the raw strings', () => {
      vi.stubEnv('JWT_ACCESS_TTL_SECONDS', '600');
      vi.stubEnv('REFRESH_TOKEN_TTL_DAYS', '7');

      expect(authConfig().accessTtlSeconds).toBe(600);
      expect(authConfig().refreshTtlDays).toBe(7);
    });

    it.each([
      ['production', true],
      ['development', false],
      ['test', false],
    ])('should derive cookieSecure for %s', (environment, secure) => {
      // Derived rather than configured: a flag that must be false on localhost
      // and true everywhere else is a consequence, not a knob.
      vi.stubEnv('NODE_ENV', environment);

      expect(authConfig().cookieSecure).toBe(secure);
    });

    it('should be registered under the auth token', () => {
      expect(authConfig.KEY).toBe('CONFIGURATION(auth)');
    });
  });

  describe('featuresConfig', () => {
    it('should leave invitations and registration off unless switched on', () => {
      vi.stubEnv('INVITATIONS_ENABLED', undefined);
      vi.stubEnv('REGISTRATION_ENABLED', undefined);

      expect(featuresConfig()).toEqual({
        invitationsEnabled: false,
        registrationEnabled: false,
      });
    });

    it('should switch invitations on', () => {
      vi.stubEnv('INVITATIONS_ENABLED', 'true');
      vi.stubEnv('REGISTRATION_ENABLED', undefined);

      expect(featuresConfig()).toEqual({
        invitationsEnabled: true,
        registrationEnabled: false,
      });
    });

    it('should switch registration on', () => {
      vi.stubEnv('INVITATIONS_ENABLED', undefined);
      vi.stubEnv('REGISTRATION_ENABLED', 'true');

      expect(featuresConfig()).toEqual({
        invitationsEnabled: false,
        registrationEnabled: true,
      });
    });
  });

  describe('configurations', () => {
    it('should register exactly the app, database, logging, auth, and features domains', () => {
      expect(configurations).toEqual([
        appConfig,
        databaseConfig,
        loggingConfig,
        authConfig,
        featuresConfig,
      ]);
    });
  });
});
