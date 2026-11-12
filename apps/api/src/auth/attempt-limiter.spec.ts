import { ATTEMPT_POLICIES, AttemptLimiter } from './attempt-limiter.js';

const POLICY = { limit: 3, windowMs: 60_000 };
const T0 = 1_000_000;

describe('AttemptLimiter', () => {
  it('should let a key try while it has fewer failures than the limit', () => {
    const limiter = new AttemptLimiter();

    limiter.fail('k', POLICY, T0);
    limiter.fail('k', POLICY, T0 + 1_000);

    expect(limiter.retryAfter('k', POLICY, T0 + 2_000)).toBe(0);
  });

  it('should block at the limit until the oldest failure leaves the window', () => {
    const limiter = new AttemptLimiter();

    limiter.fail('k', POLICY, T0);
    limiter.fail('k', POLICY, T0 + 10_000);
    limiter.fail('k', POLICY, T0 + 20_000);

    // The first failure expires at T0 + 60s: 30s from T0 + 30s.
    expect(limiter.retryAfter('k', POLICY, T0 + 30_000)).toBe(30);
    expect(limiter.retryAfter('k', POLICY, T0 + 60_001)).toBe(0);
  });

  it('should never answer less than a second while blocked', () => {
    const limiter = new AttemptLimiter();

    for (let i = 0; i < 3; i++) limiter.fail('k', POLICY, T0);

    expect(limiter.retryAfter('k', POLICY, T0 + 59_999)).toBe(1);
  });

  it('should forget a key that succeeded', () => {
    const limiter = new AttemptLimiter();

    for (let i = 0; i < 3; i++) limiter.fail('k', POLICY, T0);
    limiter.clear('k');

    expect(limiter.retryAfter('k', POLICY, T0 + 1)).toBe(0);
  });

  it('should count each key on its own', () => {
    const limiter = new AttemptLimiter();

    for (let i = 0; i < 3; i++) limiter.fail('a', POLICY, T0);

    expect(limiter.retryAfter('a', POLICY, T0 + 1)).toBeGreaterThan(0);
    expect(limiter.retryAfter('b', POLICY, T0 + 1)).toBe(0);
  });

  it('should limit five guesses per email and per password change, fifty per address, in fifteen minutes', () => {
    expect(ATTEMPT_POLICIES).toEqual({
      email: { limit: 5, windowMs: 900_000 },
      ip: { limit: 50, windowMs: 900_000 },
      password: { limit: 5, windowMs: 900_000 },
    });
  });
});
