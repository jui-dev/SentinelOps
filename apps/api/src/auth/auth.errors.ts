import { ConflictException, UnauthorizedException } from '@nestjs/common';

/**
 * The machine-readable `code` values this module puts on the error contract.
 *
 * These are the first codes in the codebase: Stage 2.3 built the field and left
 * it unpopulated. A client branches on these, so they are part of the public
 * API and change only with the same care as a route.
 */
export const AuthErrorCode = {
  EMAIL_ALREADY_REGISTERED: 'EMAIL_ALREADY_REGISTERED',
  ORGANIZATION_SLUG_TAKEN: 'ORGANIZATION_SLUG_TAKEN',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  INVALID_REFRESH_TOKEN: 'INVALID_REFRESH_TOKEN',
  REFRESH_TOKEN_EXPIRED: 'REFRESH_TOKEN_EXPIRED',
  REFRESH_TOKEN_REUSED: 'REFRESH_TOKEN_REUSED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
} as const;

export type AuthErrorCode = (typeof AuthErrorCode)[keyof typeof AuthErrorCode];

export const emailAlreadyRegistered = (): ConflictException =>
  new ConflictException('That email address is already registered', {
    errorCode: AuthErrorCode.EMAIL_ALREADY_REGISTERED,
  });

export const organizationSlugTaken = (): ConflictException =>
  new ConflictException('That organization slug is already taken', {
    errorCode: AuthErrorCode.ORGANIZATION_SLUG_TAKEN,
  });

/**
 * The single answer to every way a login can fail: unknown email, soft-deleted
 * user, no password set, wrong password.
 *
 * One message and one code for all four, because distinguishing them tells an
 * attacker which addresses are worth attacking. The message is deliberately
 * vague in a way the others here are not.
 */
export const invalidCredentials = (): UnauthorizedException =>
  new UnauthorizedException('Invalid email or password', {
    errorCode: AuthErrorCode.INVALID_CREDENTIALS,
  });

export const invalidRefreshToken = (): UnauthorizedException =>
  new UnauthorizedException('Invalid refresh token', {
    errorCode: AuthErrorCode.INVALID_REFRESH_TOKEN,
  });

export const refreshTokenExpired = (): UnauthorizedException =>
  new UnauthorizedException('Refresh token has expired', {
    errorCode: AuthErrorCode.REFRESH_TOKEN_EXPIRED,
  });

/**
 * A refresh token was presented after it had already been rotated away.
 *
 * Told apart from an unknown token on purpose: the legitimate client needs to
 * know its session was terminated rather than that it merely expired, and the
 * distinction is not useful to an attacker who, by this point, already holds a
 * token that no longer works.
 */
export const refreshTokenReused = (): UnauthorizedException =>
  new UnauthorizedException(
    'Refresh token has already been used. The session has been terminated.',
    { errorCode: AuthErrorCode.REFRESH_TOKEN_REUSED },
  );

export const unauthenticated = (message: string): UnauthorizedException =>
  new UnauthorizedException(message, {
    errorCode: AuthErrorCode.UNAUTHENTICATED,
  });
