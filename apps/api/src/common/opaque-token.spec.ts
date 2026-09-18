import { hashOpaqueToken, mintOpaqueToken } from './opaque-token.js';

describe('opaque tokens', () => {
  it('should mint 32 random bytes as base64url', () => {
    const { token } = mintOpaqueToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
  });

  it('should mint a different token every time', () => {
    const tokens = new Set(
      Array.from({ length: 50 }, () => mintOpaqueToken().token),
    );

    expect(tokens.size).toBe(50);
  });

  it('should pair each token with its SHA-256 hash, never the token itself', () => {
    const { token, tokenHash } = mintOpaqueToken();

    expect(tokenHash).toBe(hashOpaqueToken(token));
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenHash).not.toContain(token);
  });

  it('should hash deterministically, so a token can be looked up by its hash', () => {
    expect(hashOpaqueToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
