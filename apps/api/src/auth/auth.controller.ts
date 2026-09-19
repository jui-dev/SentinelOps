import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Request, Response } from 'express';

import { authConfig } from '../config/configuration.js';
import { registerWithInvitationSchema } from '../invitations/invitations.schemas.js';
import type { RegisterWithInvitationRequest } from '../invitations/invitations.schemas.js';
import {
  clearRefreshCookie,
  readRefreshCookie,
  setRefreshCookie,
} from './auth-cookie.js';
import type {
  AuthenticatedResponse,
  CurrentUserResponse,
  RefreshedResponse,
} from './auth.contract.js';
import { invalidRefreshToken } from './auth.errors.js';
import {
  changePasswordSchema,
  loginSchema,
  registerSchema,
} from './auth.schemas.js';
import type {
  ChangePasswordRequest,
  LoginRequest,
  RegisterRequest,
} from './auth.schemas.js';
import { AuthService } from './auth.service.js';
import { CurrentUserId } from './current-user.decorator.js';
import { Public } from './public.decorator.js';

/**
 * The authentication routes.
 *
 * All but two are `@Public()`: they are how a caller obtains the
 * credential the global guard demands, so requiring one would be circular.
 * `me` and changing a password act on the signed-in account, so they need it.
 * Logout is public for a different reason -- it authenticates off the refresh
 * cookie, so an expired access token must not be able to strand a session.
 *
 * `@Res({ passthrough: true })` throughout: the handlers need the response
 * object to set a cookie, but Nest still serialises what they return.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(authConfig.KEY)
    private readonly config: ConfigType<typeof authConfig>,
  ) {}

  /**
   * Creates an organization, its first admin, and the membership binding them,
   * then returns a session. 201, because it creates an account.
   */
  @Public()
  @Post('register')
  async register(
    @Body({ schema: registerSchema }) body: RegisterRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthenticatedResponse> {
    const { response, refresh } = await this.auth.register(body);

    setRefreshCookie(res, refresh.token, refresh.expiresAt, this.config);

    return response;
  }

  /**
   * Creates an account by accepting an invitation, and returns a session. The
   * account joins the inviting organization; no organization is created. 201,
   * because it creates an account.
   */
  @Public()
  @Post('register/invitation')
  async registerWithInvitation(
    @Body({ schema: registerWithInvitationSchema })
    body: RegisterWithInvitationRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthenticatedResponse> {
    const { response, refresh } = await this.auth.registerWithInvitation(body);

    setRefreshCookie(res, refresh.token, refresh.expiresAt, this.config);

    return response;
  }

  /** 200 rather than Nest's default 201: a login creates no resource. */
  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body({ schema: loginSchema }) body: LoginRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthenticatedResponse> {
    const { response, refresh } = await this.auth.login(body);

    setRefreshCookie(res, refresh.token, refresh.expiresAt, this.config);

    return response;
  }

  /**
   * Rotates the refresh cookie and issues a new access token.
   *
   * Reads the cookie rather than a body, so the token never passes through
   * JavaScript on the client and cannot be logged by anything that logs request
   * bodies.
   */
  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<RefreshedResponse> {
    const presented = readRefreshCookie(req);

    if (!presented) {
      throw invalidRefreshToken();
    }

    try {
      const { response, refresh } = await this.auth.refresh(presented);

      setRefreshCookie(res, refresh.token, refresh.expiresAt, this.config);

      return response;
    } catch (error) {
      // The cookie is dead whichever way this failed -- expired, revoked, or
      // replayed. Leaving it in the browser guarantees the client retries with
      // a token that can only fail again.
      clearRefreshCookie(res, this.config);

      throw error;
    }
  }

  /**
   * Ends the session and clears the cookie. 204 and no body, always: an
   * unknown or absent cookie still logs the caller out rather than reporting
   * whether their token was real.
   */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(readRefreshCookie(req));

    clearRefreshCookie(res, this.config);
  }

  /**
   * Replaces the caller's password, given the current one, and returns a
   * fresh session with a new refresh cookie. Every other session ends. 200:
   * it creates no resource.
   *
   * Protected, and deliberately not organization-scoped: it is the one thing
   * an account on a one-time password is allowed to do.
   */
  @Post('password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @CurrentUserId() userId: string,
    @Body({ schema: changePasswordSchema }) body: ChangePasswordRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthenticatedResponse> {
    const { response, refresh } = await this.auth.changePassword(userId, body);
    setRefreshCookie(res, refresh.token, refresh.expiresAt, this.config);
    return response;
  }

  /** The caller and their memberships. */
  @Get('me')
  me(@CurrentUserId() userId: string): Promise<CurrentUserResponse> {
    return this.auth.currentUser(userId);
  }
}
