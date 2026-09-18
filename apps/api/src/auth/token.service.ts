import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import { hashOpaqueToken, mintOpaqueToken } from '../common/opaque-token.js';
import { authConfig } from '../config/configuration.js';
import type { AccessTokenPayload } from './auth.contract.js';

/**
 * A freshly minted refresh token and the values that get persisted for it.
 * The token itself is an opaque secret; see common/opaque-token.ts.
 */
export interface MintedRefreshToken {
  /** The secret. Goes to the client in a cookie and is never stored. */
  token: string;
  /** What goes in the database instead. */
  tokenHash: string;
  expiresAt: Date;
}

/**
 * The stateless half of tokens: signing and verifying access tokens, minting
 * and hashing refresh tokens.
 *
 * Deliberately touches no database. That keeps it unit-testable without one and
 * keeps the persistence rules (rotation, reuse detection, revocation) in
 * RefreshTokenService, where they can be reasoned about as a single lifecycle.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(authConfig.KEY)
    private readonly config: ConfigType<typeof authConfig>,
  ) {}

  get accessTtlSeconds(): number {
    return this.config.accessTtlSeconds;
  }

  /**
   * Signs an access token carrying the user id and nothing else.
   *
   * `expiresIn` and `issuer` are passed per call rather than configured on
   * JwtModule so that the values a token is signed with and the values it is
   * verified against are read from the same place, and cannot drift apart.
   */
  signAccessToken(userId: string): Promise<string> {
    return this.jwt.signAsync(
      {},
      {
        subject: userId,
        issuer: this.config.jwtIssuer,
        expiresIn: this.config.accessTtlSeconds,
      },
    );
  }

  /**
   * Verifies signature, expiry, and issuer, rejecting anything that fails.
   *
   * The issuer check is why a token minted by an unrelated service that happens
   * to share the secret is still refused.
   */
  verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    return this.jwt.verifyAsync<AccessTokenPayload>(token, {
      issuer: this.config.jwtIssuer,
    });
  }

  /** A new opaque refresh token, its stored hash, and its absolute expiry. */
  mintRefreshToken(now: Date = new Date()): MintedRefreshToken {
    const { token, tokenHash } = mintOpaqueToken();
    const expiresAt = new Date(
      now.getTime() + this.config.refreshTtlDays * 24 * 60 * 60 * 1000,
    );

    return { token, tokenHash, expiresAt };
  }

  /** SHA-256, hex encoded. See hashOpaqueToken for why not Argon2. */
  hashRefreshToken(token: string): string {
    return hashOpaqueToken(token);
  }

  /**
   * A new rotation-family id, allocated once per login and shared by every
   * token descended from it.
   *
   * UUIDv4, unlike the UUIDv7 primary keys elsewhere: v7's value is index
   * locality on insert, and this column is only ever read by equality. It also
   * has to be generated here rather than by the database, because the whole
   * point is that several rows share one.
   */
  newFamilyId(): string {
    return randomUUID();
  }
}
