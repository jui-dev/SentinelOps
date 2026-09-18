import { createHash, randomBytes } from 'node:crypto';

/**
 * Opaque bearer secrets that are stored only as a hash: refresh tokens and
 * invitation tokens.
 *
 * 32 bytes from the CSPRNG, base64url encoded. 256 bits of entropy is past the
 * point where guessing is a threat model, which is what licenses the cheap
 * hash below.
 *
 * Pure functions with no Nest dependency, so a module that needs them does not
 * have to import the one that happens to have used them first.
 */
const OPAQUE_TOKEN_BYTES = 32;

/** A fresh secret, and what is persisted for it instead. */
export interface MintedOpaqueToken {
  /** The secret. Handed to the client once and never stored. */
  token: string;
  tokenHash: string;
}

/**
 * SHA-256, hex encoded.
 *
 * Not a password hash, and deliberately so. Argon2 would be wrong twice here:
 * there is no low-entropy guess for a slow hash to frustrate, and the value is
 * looked up *by* this hash, which requires it to be deterministic -- exactly
 * what a per-password salt is designed to prevent.
 */
export const hashOpaqueToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export const mintOpaqueToken = (): MintedOpaqueToken => {
  const token = randomBytes(OPAQUE_TOKEN_BYTES).toString('base64url');

  return { token, tokenHash: hashOpaqueToken(token) };
};
