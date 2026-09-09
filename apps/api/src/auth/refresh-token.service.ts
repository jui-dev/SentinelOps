import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import {
  invalidRefreshToken,
  refreshTokenExpired,
  refreshTokenReused,
} from './auth.errors.js';
import { TokenService } from './token.service.js';

/** A refresh token handed to a client, and when it stops working. */
export interface IssuedRefreshToken {
  token: string;
  expiresAt: Date;
}

/** The outcome of a successful rotation. */
export interface RotatedRefreshToken extends IssuedRefreshToken {
  userId: string;
}

/**
 * Thrown when the conditional revoke matches no row, meaning another request
 * rotated this same token first.
 *
 * A private sentinel rather than the public error, because it has to escape the
 * transaction before the family can be revoked: throwing the real error from
 * inside would roll the revocation back along with everything else.
 */
class ConcurrentRotation extends Error {}

/**
 * The stateful half of refresh tokens: issuing them, rotating them, and
 * revoking them.
 *
 * Every token is stored only as a SHA-256 hash, so a database disclosure hands
 * an attacker nothing presentable. The plaintext exists for exactly as long as
 * it takes to put it in a Set-Cookie header.
 */
@Injectable()
export class RefreshTokenService {
  private readonly logger = new Logger(RefreshTokenService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  /**
   * Issues the first token of a new family. Called once per login, and once per
   * registration.
   */
  async issue(
    userId: string,
    now: Date = new Date(),
  ): Promise<IssuedRefreshToken> {
    const minted = this.tokens.mintRefreshToken(now);

    await this.prisma.refreshToken.create({
      data: {
        userId,
        tokenHash: minted.tokenHash,
        familyId: this.tokens.newFamilyId(),
        expiresAt: minted.expiresAt,
      },
      select: { id: true },
    });

    return { token: minted.token, expiresAt: minted.expiresAt };
  }

  /**
   * Exchanges a presented token for its successor.
   *
   * The rules, in the order they are checked:
   *
   *   unknown hash    -> 401, and nothing is disclosed about why
   *   already revoked -> reuse: the entire family dies, then 401
   *   expired         -> 401
   *   deleted user    -> 401
   *   otherwise       -> revoke it, insert its successor, return that
   *
   * Reuse detection is the reason a revoked row is kept until it expires rather
   * than deleted on rotation. Deleting it would make a replayed token
   * indistinguishable from an unknown one, and the theft would go unnoticed.
   */
  async rotate(
    presentedToken: string,
    now: Date = new Date(),
  ): Promise<RotatedRefreshToken> {
    const tokenHash = this.tokens.hashRefreshToken(presentedToken);

    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        familyId: true,
        expiresAt: true,
        revokedAt: true,
        user: { select: { deletedAt: true } },
      },
    });

    if (!existing) {
      throw invalidRefreshToken();
    }

    if (existing.revokedAt) {
      // Revoked *outside* any transaction, so it survives the throw below.
      await this.revokeFamily(existing.familyId, now);

      this.logger.warn(
        'Refresh token reuse detected; every token in the family has been revoked',
        { userId: existing.userId, familyId: existing.familyId },
      );

      throw refreshTokenReused();
    }

    if (existing.expiresAt.getTime() <= now.getTime()) {
      throw refreshTokenExpired();
    }

    // Checked here rather than in the guard: this is the point at which a
    // deleted account actually loses its session, which is what makes the
    // guard's own database-free design acceptable.
    if (existing.user.deletedAt) {
      throw invalidRefreshToken();
    }

    const minted = this.tokens.mintRefreshToken(now);

    try {
      await this.prisma.$transaction(async (tx) => {
        // Conditional on still being unrevoked, so two simultaneous refreshes
        // with the same token cannot both succeed and leave two live tokens in
        // one family. The loser matches no row.
        const claimed = await tx.refreshToken.updateMany({
          where: { id: existing.id, revokedAt: null },
          data: { revokedAt: now },
        });

        if (claimed.count !== 1) {
          throw new ConcurrentRotation();
        }

        await tx.refreshToken.create({
          data: {
            userId: existing.userId,
            tokenHash: minted.tokenHash,
            familyId: existing.familyId,
            expiresAt: minted.expiresAt,
          },
          select: { id: true },
        });
      });
    } catch (error) {
      if (error instanceof ConcurrentRotation) {
        await this.revokeFamily(existing.familyId, now);

        this.logger.warn(
          'Concurrent use of one refresh token; every token in the family has been revoked',
          { userId: existing.userId, familyId: existing.familyId },
        );

        throw refreshTokenReused();
      }

      throw error;
    }

    return {
      userId: existing.userId,
      token: minted.token,
      expiresAt: minted.expiresAt,
    };
  }

  /**
   * Ends the session a token belongs to.
   *
   * Idempotent and silent: an unknown or already-revoked token is not an error,
   * because logout must succeed for a client whose cookie is stale, and because
   * answering differently would say whether a token was ever real.
   */
  async revokeSessionOf(
    presentedToken: string,
    now: Date = new Date(),
  ): Promise<void> {
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.tokens.hashRefreshToken(presentedToken) },
      select: { familyId: true },
    });

    if (!existing) {
      return;
    }

    await this.revokeFamily(existing.familyId, now);
  }

  /**
   * Revokes every token still live in one family, in a single statement.
   *
   * Filtering on `revokedAt: null` keeps the original revocation timestamps of
   * tokens already rotated away, so the history of a compromised family stays
   * readable.
   */
  async revokeFamily(
    familyId: string,
    now: Date = new Date(),
  ): Promise<number> {
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: now },
    });

    return count;
  }
}
