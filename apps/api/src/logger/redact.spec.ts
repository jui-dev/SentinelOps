import { REDACTED, redact, redactUrl } from './redact.js';

describe('redact', () => {
  describe('sensitive keys', () => {
    it.each([
      ['password', { password: 'hunter2' }],
      ['passwd', { passwd: 'hunter2' }],
      ['secret', { secret: 'hunter2' }],
      ['token', { token: 'hunter2' }],
      ['apiKey', { apiKey: 'hunter2' }],
      ['api_key', { api_key: 'hunter2' }],
      ['authorization', { authorization: 'Bearer hunter2' }],
      ['auth', { auth: 'hunter2' }],
      ['cookie', { cookie: 'sid=hunter2' }],
      ['session', { session: 'hunter2' }],
      ['jwt', { jwt: 'hunter2' }],
      ['credential', { credential: 'hunter2' }],
      ['credentials', { credentials: 'hunter2' }],
      ['privateKey', { privateKey: 'hunter2' }],
      ['private_key', { private_key: 'hunter2' }],
      ['refreshToken', { refreshToken: 'hunter2' }],
      ['refresh_token', { refresh_token: 'hunter2' }],
      ['accessToken', { accessToken: 'hunter2' }],
      ['access_token', { access_token: 'hunter2' }],
      ['clientSecret', { clientSecret: 'hunter2' }],
      ['client_secret', { client_secret: 'hunter2' }],
      ['otp', { otp: 'hunter2' }],
      ['pin', { pin: 'hunter2' }],
      ['ssn', { ssn: 'hunter2' }],
    ])('should mask %s', (_case, input) => {
      expect(JSON.stringify(redact(input))).not.toContain('hunter2');
      expect(Object.values(redact(input) as object)).toEqual([REDACTED]);
    });

    it.each([
      ['upper case', 'PASSWORD'],
      ['mixed case', 'RefreshToken'],
      ['screaming snake', 'CLIENT_SECRET'],
      ['a header name', 'X-Api-Key'],
      ['an embedded match', 'userPasswordHash'],
    ])('should match %s', (_case, key) => {
      expect(redact({ [key]: 'hunter2' })).toEqual({ [key]: REDACTED });
    });

    it('should mask a non-string value entirely', () => {
      // The mask replaces the value whatever its type: an object under a
      // sensitive key is not descended into and re-emitted piecemeal.
      expect(redact({ token: { value: 'hunter2', exp: 1 } })).toEqual({
        token: REDACTED,
      });
    });

    it('should leave ordinary keys alone', () => {
      const input = { incidentId: 'inc_1', severity: 'high', count: 3 };

      expect(redact(input)).toEqual(input);
    });
  });

  describe('traversal', () => {
    it('should mask nested keys', () => {
      expect(redact({ user: { name: 'ada', password: 'hunter2' } })).toEqual({
        user: { name: 'ada', password: REDACTED },
      });
    });

    it('should mask inside arrays', () => {
      expect(redact({ users: [{ apiKey: 'hunter2' }, { name: 'ada' }] })).toEqual({
        users: [{ apiKey: REDACTED }, { name: 'ada' }],
      });
    });

    it('should pass primitives through unchanged', () => {
      expect(redact('a plain message')).toBe('a plain message');
      expect(redact(42)).toBe(42);
      expect(redact(null)).toBeNull();
      expect(redact(undefined)).toBeUndefined();
    });

    it('should not mutate its input', () => {
      const input = { password: 'hunter2', nested: { token: 'hunter2' } };

      redact(input);

      expect(input.password).toBe('hunter2');
      expect(input.nested.token).toBe('hunter2');
    });

    it('should pass an Error through untouched', () => {
      // A stack trace must survive this intact — it is the most valuable field
      // on an error line.
      const error = new Error('boom');

      expect(redact(error)).toBe(error);
    });

    it.each([
      ['a Date', new Date(0)],
      ['a Map', new Map([['token', 'hunter2']])],
      ['a Set', new Set(['a'])],
    ])('should pass %s through untouched', (_case, value) => {
      expect(redact(value)).toBe(value);
    });

    it('should truncate beyond the depth cap', () => {
      let deep: Record<string, unknown> = { password: 'hunter2' };

      for (let i = 0; i < 12; i++) {
        deep = { nested: deep };
      }

      const output = JSON.stringify(redact(deep));

      expect(output).toContain('[Object]');
      expect(output).not.toContain('hunter2');
    });

    it('should survive a cycle', () => {
      const input: Record<string, unknown> = { name: 'ada' };
      input.self = input;

      expect(() => redact(input)).not.toThrow();
      expect(JSON.stringify(redact(input))).toContain('[Object]');
    });

    it('should not treat a repeated sibling as a cycle', () => {
      const shared = { name: 'ada' };

      expect(redact({ a: shared, b: shared })).toEqual({
        a: { name: 'ada' },
        b: { name: 'ada' },
      });
    });
  });
});

describe('redactUrl', () => {
  it('should return a query-less path unchanged', () => {
    expect(redactUrl('/api/v1/health')).toBe('/api/v1/health');
  });

  it('should mask a sensitive value but keep its key', () => {
    // The endpoint and the parameter names stay diagnosable; only the
    // credential goes.
    expect(redactUrl('/api/v1/x?token=hunter2&page=2')).toBe(
      `/api/v1/x?token=${REDACTED}&page=2`,
    );
  });

  it('should leave ordinary parameters alone', () => {
    expect(redactUrl('/api/v1/incidents?limit=25&severity=high')).toBe(
      '/api/v1/incidents?limit=25&severity=high',
    );
  });

  it('should mask every sensitive parameter', () => {
    const output = redactUrl('/x?access_token=hunter2&q=ok&apiKey=hunter2');

    expect(output).not.toContain('hunter2');
    expect(output).toContain('q=ok');
  });

  it('should tolerate a valueless parameter', () => {
    expect(redactUrl('/x?flag&token=hunter2')).toBe(`/x?flag&token=${REDACTED}`);
  });

  it('should tolerate a malformed escape rather than throwing', () => {
    // decodeURIComponent throws on a bare '%'. A logger must never be the thing
    // that crashes a request.
    expect(() => redactUrl('/x?%=1')).not.toThrow();
  });

  it('should mask a percent-encoded sensitive key', () => {
    expect(redactUrl('/x?access%5Ftoken=hunter2')).not.toContain('hunter2');
  });
});
