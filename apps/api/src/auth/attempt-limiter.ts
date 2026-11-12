import { Injectable } from '@nestjs/common';

/** How many failures a key may have within a sliding window. */
export interface AttemptPolicy {
  limit: number;
  windowMs: number;
}

const FIFTEEN_MINUTES = 15 * 60_000;

/**
 * The limits on guessing a password.
 *
 *   email     failed sign-ins for one email address, whether or not an account
 *             has it — so a block says nothing about which addresses exist.
 *   ip        failed sign-ins from one address, across every email: one
 *             machine trying many accounts. Generous, as an office can share
 *             an address.
 *   password  wrong current passwords when one signed-in user changes theirs.
 */
export const ATTEMPT_POLICIES = {
  email: { limit: 5, windowMs: FIFTEEN_MINUTES },
  ip: { limit: 50, windowMs: FIFTEEN_MINUTES },
  password: { limit: 5, windowMs: FIFTEEN_MINUTES },
} as const satisfies Record<string, AttemptPolicy>;

/** Sweep forgotten keys once this many failures have been recorded. */
const SWEEP_EVERY = 1_000;

/**
 * Counts recent failures per key and says when a key must wait.
 *
 * A sliding window: a key with `limit` failures in the last `windowMs` is
 * blocked until the oldest of them leaves the window. Success clears a key.
 *
 * Held in this process's memory, which is right for one API instance. Several
 * instances behind a load balancer would each count on their own; moving the
 * counts to the database or Redis is a change to this class alone.
 *
 * Times are passed in, never read here, so tests decide what "now" is.
 */
@Injectable()
export class AttemptLimiter {
  private readonly failures = new Map<string, number[]>();
  private sinceSweep = 0;

  /** Whole seconds until `key` may try again; 0 when it may now. */
  retryAfter(key: string, policy: AttemptPolicy, now: number): number {
    const recent = this.recent(key, policy, now);

    if (recent.length < policy.limit) {
      return 0;
    }

    // The failure whose expiry brings the count back under the limit.
    const releasing = recent[recent.length - policy.limit];

    return Math.max(1, Math.ceil((releasing + policy.windowMs - now) / 1000));
  }

  /** Records one failure for `key`. */
  fail(key: string, policy: AttemptPolicy, now: number): void {
    this.failures.set(key, [...this.recent(key, policy, now), now]);

    if (++this.sinceSweep >= SWEEP_EVERY) {
      this.sweep(now);
    }
  }

  /** Forgets every failure for `key`: it has just succeeded. */
  clear(key: string): void {
    this.failures.delete(key);
  }

  private recent(key: string, policy: AttemptPolicy, now: number): number[] {
    return (this.failures.get(key) ?? []).filter(
      (at) => at > now - policy.windowMs,
    );
  }

  /** Drops keys with no failure inside the longest window. */
  private sweep(now: number): void {
    this.sinceSweep = 0;
    const longest = Math.max(
      ...Object.values(ATTEMPT_POLICIES).map(({ windowMs }) => windowMs),
    );

    for (const [key, times] of this.failures) {
      if (times.every((at) => at <= now - longest)) {
        this.failures.delete(key);
      }
    }
  }
}
