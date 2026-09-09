import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import type { Options } from '@node-rs/argon2';

/**
 * Argon2id, spelled as its numeric value.
 *
 * @node-rs/argon2 declares `Algorithm` as an ambient `const enum`, which
 * TypeScript refuses to read under `isolatedModules` — the setting that lets
 * every file be transpiled independently, and one this project is not going to
 * give up for one constant. The value is asserted in the spec, so a change in
 * the package cannot pass silently.
 */
const ARGON2ID = 2 as NonNullable<Options['algorithm']>;

/**
 * OWASP's first recommended Argon2id configuration: 19 MiB of memory, two
 * passes, one lane. Memory is the parameter that actually costs an attacker
 * with GPUs, which is why it is high and the iteration count is low.
 *
 * These govern hashing only. Verification reads the algorithm, version, and
 * parameters back out of the encoded hash, so raising them here does not
 * invalidate a single existing password.
 */
const HASH_OPTIONS: Options = {
  algorithm: ARGON2ID,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

/**
 * The password hashed to produce the dummy verification target. Its value is
 * irrelevant and it is never compared against anything a user supplies.
 */
const DUMMY_PASSWORD = 'sentinelops-timing-equalisation-placeholder';

/**
 * Password hashing, and the timing defence that goes with it.
 *
 * Argon2id in PHC string format: the algorithm, version, parameters, and a
 * per-password random salt all travel inside the stored string, so nothing else
 * needs a column and rehashing at stronger parameters later is a background job
 * rather than a migration.
 */
@Injectable()
export class PasswordService implements OnModuleInit {
  private readonly logger = new Logger(PasswordService.name);

  /**
   * A real hash, computed once at boot, that `verifyDummy` burns time against.
   *
   * Computed rather than hardcoded so it always carries the *current*
   * parameters: a constant baked in today would still be verified at today's
   * cost after HASH_OPTIONS is raised, and the timing gap it exists to close
   * would quietly reopen.
   */
  private dummyHash = '';

  async onModuleInit(): Promise<void> {
    // At boot rather than on first use: computing it lazily would make exactly
    // one login slower than every other, which is itself a signal.
    this.dummyHash = await hash(DUMMY_PASSWORD, HASH_OPTIONS);
    this.logger.log('Password hashing ready (argon2id, 19 MiB, t=2, p=1)');
  }

  hash(password: string): Promise<string> {
    return hash(password, HASH_OPTIONS);
  }

  /**
   * Verifies a password against a stored hash, answering false rather than
   * throwing for a malformed or truncated hash. A corrupt row is a failed
   * login, not a 500 that tells the caller their email exists.
   */
  async verify(storedHash: string, password: string): Promise<boolean> {
    try {
      return await verify(storedHash, password);
    } catch (error) {
      this.logger.warn(
        'Password verification failed against a stored hash that could not be parsed',
        { reason: error instanceof Error ? error.message : String(error) },
      );

      return false;
    }
  }

  /**
   * Spends the same time a real verification would, and discards the result.
   *
   * Called when no user matched, or when the matched user has no password set.
   * Without it, an unknown address returns in about a millisecond and a known
   * one in fifty, which turns the login endpoint into an account oracle that
   * needs no valid credentials at all.
   */
  async verifyDummy(password: string): Promise<void> {
    await this.verify(this.dummyHash, password);
  }
}
