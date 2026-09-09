import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';
import type {
  AuthenticatedResponse,
  CurrentUserResponse,
  RefreshedResponse,
} from './auth.contract.js';
import {
  emailAlreadyRegistered,
  invalidCredentials,
  organizationSlugTaken,
  unauthenticated,
} from './auth.errors.js';
import { toCurrentUserResponse, toUserResponse } from './auth.responses.js';
import type { LoginRequest, RegisterRequest } from './auth.schemas.js';
import { slugify } from './auth.schemas.js';
import { PasswordService } from './password.service.js';
import type { IssuedRefreshToken } from './refresh-token.service.js';
import { RefreshTokenService } from './refresh-token.service.js';
import { TokenService } from './token.service.js';

/** Postgres unique violation, as Prisma reports it. */
const UNIQUE_VIOLATION = 'P2002';

/**
 * Names the constraint a unique violation came from.
 *
 * Two shapes, because Prisma reports this differently depending on how it
 * reached the database. The classic query engine fills `meta.target` with a
 * field list; the Prisma 7 driver adapter this project uses leaves that
 * undefined and puts the Postgres constraint name
 * (`users_email_key`) under `meta.driverAdapterError.cause.constraint`
 * instead. Reading only one of them is how a 409 silently becomes a 500.
 *
 * Returns a lowercase haystack rather than a field name: the two sources
 * disagree about whether the answer is `email` or `users_email_key`, and the
 * caller only needs to know which column was involved.
 */
const constraintHintOf = (
  error: InstanceType<typeof Prisma.PrismaClientKnownRequestError>,
): string => {
  const meta = error.meta as Record<string, unknown> | undefined;
  const hints: string[] = [];
  const target = meta?.target;

  if (typeof target === 'string') {
    hints.push(target);
  } else if (Array.isArray(target)) {
    hints.push(...target.map(String));
  }

  const cause = (meta?.driverAdapterError as { cause?: unknown } | undefined)
    ?.cause as
    { constraint?: { index?: string; fields?: string[] } } | undefined;

  if (cause?.constraint?.index) {
    hints.push(cause.constraint.index);
  }

  if (Array.isArray(cause?.constraint?.fields)) {
    hints.push(...cause.constraint.fields);
  }

  return hints.join(' ').toLowerCase();
};

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
} as const;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  /**
   * Creates an organization, its first user, and the membership that makes them
   * its owner, then logs them in.
   *
   * One transaction, because the three rows are meaningless apart: a user with
   * no membership can do nothing in a tenant-scoped product, and an
   * organization with no owner cannot be administered. Either all three exist
   * or none do.
   *
   * Uniqueness is enforced by the database rather than by checking first. A
   * read-then-write check races: two registrations for one address can both
   * find it free and both proceed. Catching the constraint violation cannot.
   */
  async register(request: RegisterRequest): Promise<AuthenticationResult> {
    const slug = request.organizationSlug ?? slugify(request.organizationName);

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
            // The first member of an organization owns it. OWNER is not
            // requestable: it is a consequence of having created the tenant.
            role: 'OWNER',
          },
          select: { id: true },
        });

        return created;
      });
    } catch (error) {
      throw this.translateRegistrationFailure(error);
    }

    this.logger.log('Registered a new organization and its owner', {
      userId: user.id,
      slug,
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
   */
  async login(request: LoginRequest): Promise<AuthenticationResult> {
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

      throw invalidCredentials();
    }

    if (!(await this.passwords.verify(user.passwordHash, request.password))) {
      throw invalidCredentials();
    }

    const { passwordHash: _passwordHash, ...safe } = user;

    return this.authenticate(safe);
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
          where: { organization: { deletedAt: null } },
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
   * Postgres constraint name depending on the driver -- see constraintHintOf.
   *
   * Anything else is rethrown untouched, so a genuine fault surfaces as a
   * masked 500 with its stack in the log rather than as a misleading 409.
   */
  private translateRegistrationFailure(error: unknown): unknown {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== UNIQUE_VIOLATION
    ) {
      return error;
    }

    const hint = constraintHintOf(error);

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
