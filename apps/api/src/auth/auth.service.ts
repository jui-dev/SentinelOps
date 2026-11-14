import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { recordAccountActivity } from '../activity/activity.recorder.js';
import type { ActivityChange } from '../activity/activity.contract.js';
import { slugify } from '../common/slug.js';
import { PrismaService } from '../database/prisma.service.js';
import { uniqueViolationHint } from '../database/unique-violation.js';
import type { RegisterWithInvitationRequest } from '../invitations/invitations.schemas.js';
import { InvitationsService } from '../invitations/invitations.service.js';
import type {
  AuthenticatedResponse,
  CurrentUserResponse,
  RefreshedResponse,
} from './auth.contract.js';
import {
  emailAlreadyRegistered,
  invalidCredentials,
  invalidCurrentPassword,
  organizationSlugTaken,
  passwordUnchanged,
  tooManyAttempts,
  unauthenticated,
} from './auth.errors.js';
import { ATTEMPT_POLICIES, AttemptLimiter } from './attempt-limiter.js';
import { toCurrentUserResponse, toUserResponse } from './auth.responses.js';
import type {
  ChangePasswordRequest,
  LoginRequest,
  RegisterRequest,
} from './auth.schemas.js';
import { PasswordService } from './password.service.js';
import type { IssuedRefreshToken } from './refresh-token.service.js';
import { RefreshTokenService } from './refresh-token.service.js';
import { TokenService } from './token.service.js';

/**
 * A completed authentication: what the client is told, and the cookie the
 * controller still has to set.
 *
 * The refresh token is returned separately rather than folded into the
 * response, so it is structurally impossible to serialise it into a body by
 * accident.
 */
export interface AuthenticationResult {
  response: AuthenticatedResponse;
  refresh: IssuedRefreshToken;
}

export interface RefreshResult {
  response: RefreshedResponse;
  refresh: IssuedRefreshToken;
}

/** Columns every response about a user is built from. Never passwordHash. */
const userSelection = {
  id: true,
  email: true,
  name: true,
  createdAt: true,
  passwordChangeRequired: true,
} as const;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly refreshTokens: RefreshTokenService,
    private readonly invitations: InvitationsService,
    private readonly attempts: AttemptLimiter,
  ) {}

  /**
   * Creates an organization, its first user, and the membership that makes them
   * its admin, then logs them in.
   *
   * One transaction, because the three rows are meaningless apart: a user with
   * no membership can do nothing in a tenant-scoped product, and an
   * organization with no admin cannot be administered. Either all three exist
   * or none do.
   *
   * Uniqueness is enforced by the database rather than by checking first. A
   * read-then-write check races: two registrations for one address can both
   * find it free and both proceed. Catching the constraint violation cannot.
   */
  async register(request: RegisterRequest): Promise<AuthenticationResult> {
    const slug = request.organizationSlug ?? slugify(request.organizationName);

    // A name with nothing to derive a slug from is answered with a 400 asking
    // for an explicit one, which is honest, rather than inventing
    // `organization-1`. Nor is a suffix appended on collision: a caller who
    // typed "Acme" and silently received `acme-2` has a URL they did not choose
    // and cannot predict; the 409 lets them decide.
    if (!slug) {
      throw new BadRequestException({
        message: 'Request validation failed',
        details: [
          {
            field: 'organizationSlug',
            message:
              'Could not derive a URL-safe slug from the organization name. Supply organizationSlug explicitly.',
          },
        ],
      });
    }

    // Hashed before the transaction opens. Argon2id at these parameters takes
    // tens of milliseconds, and holding a database transaction open across it
    // would pin a connection for the duration for no reason.
    const passwordHash = await this.passwords.hash(request.password);

    let user;

    try {
      user = await this.prisma.$transaction(async (tx) => {
        const organization = await tx.organization.create({
          data: { name: request.organizationName, slug },
          select: { id: true },
        });

        const created = await tx.user.create({
          data: { email: request.email, name: request.name, passwordHash },
          select: userSelection,
        });

        await tx.membership.create({
          data: {
            organizationId: organization.id,
            userId: created.id,
            // Whoever creates an organization administers it: someone has to
            // be able to add its members, teams, and services.
            role: 'ADMIN',
          },
          select: { id: true },
        });

        return created;
      });
    } catch (error) {
      throw this.translateRegistrationFailure(error);
    }

    this.logger.log('Registered a new organization and its admin', {
      userId: user.id,
      slug,
    });

    return this.authenticate(user);
  }

  /**
   * Creates an account by accepting an invitation, then logs it in.
   *
   * The account joins the inviting organization rather than creating one, and
   * its email is the one the invitation was issued to — the request carries
   * none. InvitationsService owns the acceptance and its transaction; this
   * supplies what an account is.
   *
   * The token is checked before the password is hashed. This route is
   * anonymous, and Argon2 is the expensive part, so an unusable token must not
   * cost one. The check is repeated inside the transaction, where it counts.
   */
  async registerWithInvitation(
    request: RegisterWithInvitationRequest,
    now: Date = new Date(),
  ): Promise<AuthenticationResult> {
    await this.invitations.requireUsable(this.prisma, request.token, now);

    const passwordHash = await this.passwords.hash(request.password);

    let user;

    try {
      ({ account: user } = await this.invitations.acceptAsNewAccount(
        request.token,
        (tx, email) =>
          tx.user.create({
            data: { email, name: request.name, passwordHash },
            select: userSelection,
          }),
        now,
      ));
    } catch (error) {
      // An address registered between the check and the insert. Anything
      // else — including every invitation error — passes through untouched.
      throw this.translateRegistrationFailure(error);
    }

    this.logger.log('Registered a new account by invitation', {
      userId: user.id,
    });

    return this.authenticate(user);
  }

  /**
   * Verifies a password and starts a session.
   *
   * Every way this can fail answers identically: unknown email, soft-deleted
   * account, an account with no password set, and a wrong password all produce
   * one 401 with one message. Telling them apart would turn the endpoint into
   * an oracle for which addresses have accounts.
   *
   * Guessing is limited (see AttemptLimiter): too many failures for one email
   * address, or from one network address, answer 429 TOO_MANY_ATTEMPTS
   * without checking the password at all, until the window passes. An email
   * is counted whether or not an account has it, so a block reveals nothing
   * either. A correct password clears its email's count.
   *
   * The activity log hears of it, for an account that exists: a sign-in,
   * with whether it used a one-time password; a wrong password; and the
   * wrong password that blocks the address. The failures are written
   * without being waited for, so a known address answers no slower than an
   * unknown one — a pause there would say the account exists.
   */
  async login(
    request: LoginRequest,
    client: { ip?: string } = {},
    now: number = Date.now(),
  ): Promise<AuthenticationResult> {
    const keys = [
      { key: `email:${request.email}`, policy: ATTEMPT_POLICIES.email },
      ...(client.ip
        ? [{ key: `ip:${client.ip}`, policy: ATTEMPT_POLICIES.ip }]
        : []),
    ];
    const wait = Math.max(
      ...keys.map(({ key, policy }) =>
        this.attempts.retryAfter(key, policy, now),
      ),
    );

    if (wait > 0) {
      throw tooManyAttempts(wait);
    }

    const failed = () => {
      for (const { key, policy } of keys) {
        this.attempts.fail(key, policy, now);
      }

      return invalidCredentials();
    };

    /** A wrong password for an account that exists, and a block it causes. */
    const failedFor = (userId: string) => {
      const error = failed();
      const blockedFor = this.attempts.retryAfter(
        `email:${request.email}`,
        ATTEMPT_POLICIES.email,
        now,
      );

      // In order: the wrong password, then the block it caused.
      this.recordUnwaited(userId, [
        { action: 'SIGN_IN_FAILED', changes: [] },
        ...(blockedFor > 0
          ? [
              {
                action: 'SIGN_IN_BLOCKED' as const,
                changes: [
                  {
                    field: 'blockedUntil',
                    before: null,
                    after: new Date(now + blockedFor * 1000).toISOString(),
                  },
                ],
              },
            ]
          : []),
      ]);

      return error;
    };

    const user = await this.prisma.user.findFirst({
      // findFirst rather than findUnique: deletedAt is not part of the unique
      // index, and a soft-deleted account must not be able to log in. This is
      // the first read path in the codebase, and the convention it sets is that
      // every query filters `deletedAt: null` unless it deliberately does not.
      where: { email: request.email, deletedAt: null },
      select: { ...userSelection, passwordHash: true },
    });

    if (!user?.passwordHash) {
      // Burn the same time a real verification would. Without this, an unknown
      // address answers in about a millisecond and a known one in fifty, which
      // is an account oracle that needs no valid credentials at all.
      await this.passwords.verifyDummy(request.password);

      throw failed();
    }

    if (!(await this.passwords.verify(user.passwordHash, request.password))) {
      throw failedFor(user.id);
    }

    this.attempts.clear(`email:${request.email}`);

    const { passwordHash: _passwordHash, ...safe } = user;

    await recordAccountActivity(this.prisma, {
      userId: user.id,
      action: 'SIGNED_IN',
      changes: user.passwordChangeRequired
        ? [{ field: 'with', before: null, after: 'ONE_TIME_PASSWORD' }]
        : [],
    });

    return this.authenticate(safe);
  }

  /**
   * Replaces the caller's password, and starts a fresh session.
   *
   * The current password is required even though the caller is
   * authenticated: an access token left in an unattended browser must not be
   * enough to take the account over. It is checked like a login's, but a
   * wrong one answers 400 rather than 401 — the session itself is fine.
   *
   * One transaction writes the new hash, clears `passwordChangeRequired`, and
   * revokes every refresh token the user holds — every other session ends.
   * The update is conditional on the hash just verified, so two changes
   * racing with the same current password cannot both succeed: the loser is
   * told its current password is wrong, which by then it is.
   *
   * Returns a new session, as login does, so the device that changed the
   * password stays signed in.
   */
  async changePassword(
    userId: string,
    request: ChangePasswordRequest,
    now: Date = new Date(),
  ): Promise<AuthenticationResult> {
    // Guessing the current password is limited as signing in is.
    const attemptKey = `password:${userId}`;
    const wait = this.attempts.retryAfter(
      attemptKey,
      ATTEMPT_POLICIES.password,
      now.getTime(),
    );

    if (wait > 0) {
      throw tooManyAttempts(wait);
    }

    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { ...userSelection, passwordHash: true },
    });

    if (!user) {
      // As in currentUser: the token verified, but its account is gone.
      throw unauthenticated('Invalid or expired access token');
    }

    if (
      !user.passwordHash ||
      !(await this.passwords.verify(user.passwordHash, request.currentPassword))
    ) {
      this.attempts.fail(attemptKey, ATTEMPT_POLICIES.password, now.getTime());

      throw invalidCurrentPassword();
    }

    this.attempts.clear(attemptKey);

    if (request.newPassword === request.currentPassword) {
      throw passwordUnchanged();
    }

    const passwordHash = await this.passwords.hash(request.newPassword);

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.user.updateMany({
        where: { id: userId, deletedAt: null, passwordHash: user.passwordHash },
        data: { passwordHash, passwordChangeRequired: false },
      });

      if (count === 0) {
        throw invalidCurrentPassword();
      }

      await this.refreshTokens.revokeAllFor(tx, userId, now);

      // Whether it replaced a one-time password the Admin gave them.
      await recordAccountActivity(tx, {
        userId,
        action: 'PASSWORD_CHANGED',
        changes: user.passwordChangeRequired
          ? [{ field: 'replaced', before: null, after: 'ONE_TIME_PASSWORD' }]
          : [],
      });
    });

    this.logger.log('Changed a password; every other session was ended', {
      userId,
    });

    const { passwordHash: _passwordHash, ...safe } = user;

    return this.authenticate({ ...safe, passwordChangeRequired: false });
  }

  /**
   * Writes sign-in events, one after another, without the caller waiting for
   * them. A failure to write is logged and goes no further: the answer to the
   * sign-in does not depend on it.
   */
  private recordUnwaited(
    userId: string,
    events: {
      action: 'SIGN_IN_FAILED' | 'SIGN_IN_BLOCKED';
      changes: ActivityChange[];
    }[],
  ): void {
    void (async () => {
      for (const { action, changes } of events) {
        await recordAccountActivity(this.prisma, { userId, action, changes });
      }
    })().catch((error: unknown) => {
      this.logger.error('Could not record a sign-in event', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  /**
   * Exchanges a refresh token for a new access token and its successor.
   *
   * All of the interesting rules -- expiry, revocation, reuse detection -- live
   * in RefreshTokenService, where they can be read as one lifecycle.
   */
  async refresh(presentedToken: string): Promise<RefreshResult> {
    const rotated = await this.refreshTokens.rotate(presentedToken);

    return {
      response: {
        accessToken: await this.tokens.signAccessToken(rotated.userId),
        expiresIn: this.tokens.accessTtlSeconds,
        tokenType: 'Bearer',
      },
      refresh: { token: rotated.token, expiresAt: rotated.expiresAt },
    };
  }

  /**
   * Ends the session the presented token belongs to.
   *
   * Never fails. A stale, unknown, or absent cookie still results in a logged
   * out client, because the alternative is an endpoint that reports whether a
   * token was ever real.
   */
  async logout(presentedToken: string | undefined): Promise<void> {
    if (!presentedToken) {
      return;
    }

    await this.refreshTokens.revokeSessionOf(presentedToken);
  }

  /**
   * The caller, and the organizations they belong to.
   *
   * Filters soft-deleted rows on both sides: a deleted account is not a caller,
   * and a deleted organization is not a membership worth reporting.
   */
  async currentUser(userId: string): Promise<CurrentUserResponse> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        ...userSelection,
        memberships: {
          // An organization they were removed from is no longer theirs.
          where: { organization: { deletedAt: null }, removedAt: null },
          select: {
            id: true,
            role: true,
            organization: {
              select: { id: true, name: true, slug: true, createdAt: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!user) {
      // The token verified, so it was minted by this application, but the
      // account behind it is gone. Access tokens carry no revocation check by
      // design; this is where that catches up.
      throw unauthenticated('Invalid or expired access token');
    }

    return toCurrentUserResponse(user);
  }

  /** Mints the pair that every successful authentication returns. */
  private async authenticate(user: {
    id: string;
    email: string;
    name: string;
    createdAt: Date;
    passwordChangeRequired: boolean;
  }): Promise<AuthenticationResult> {
    const [accessToken, refresh] = await Promise.all([
      this.tokens.signAccessToken(user.id),
      this.refreshTokens.issue(user.id),
    ]);

    return {
      response: {
        accessToken,
        expiresIn: this.tokens.accessTtlSeconds,
        tokenType: 'Bearer',
        user: toUserResponse(user),
      },
      refresh,
    };
  }

  /**
   * Turns a unique-constraint violation into the right 409.
   *
   * Matched by substring, because the hint is either a bare field name or a
   * Postgres constraint name depending on the driver -- see
   * uniqueViolationHint.
   *
   * Anything else is rethrown untouched, so a genuine fault surfaces as a
   * masked 500 with its stack in the log rather than as a misleading 409.
   */
  private translateRegistrationFailure(error: unknown): unknown {
    const hint = uniqueViolationHint(error);

    if (hint === undefined) {
      return error;
    }

    if (hint.includes('email')) {
      return emailAlreadyRegistered();
    }

    if (hint.includes('slug')) {
      return organizationSlugTaken();
    }

    // A unique violation on a constraint this method does not know about is a
    // bug in this method, not a client error. Let it surface as a 500 with its
    // stack rather than guessing at a 409.
    return error;
  }
}
