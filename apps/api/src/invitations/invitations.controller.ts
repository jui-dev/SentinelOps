import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';

import type { MembershipResponse } from '../auth/auth.contract.js';
import { CurrentUserId } from '../auth/current-user.decorator.js';
import { Public } from '../auth/public.decorator.js';
import type { InvitationLookupResponse } from './invitations.contract.js';
import { invitationTokenRequestSchema } from './invitations.schemas.js';
import type { InvitationTokenRequest } from './invitations.schemas.js';
import { InvitationsService } from './invitations.service.js';

/**
 * The routes an invitee uses. Not organization-scoped: the organization is the
 * one the invitation names, and nothing in the request can change it. Their
 * authority is possession of the token — plus, for acceptance, being the
 * account it was issued to — rather than a permission.
 *
 * Both are POST with the token in the body, never in the path or a query
 * string, because paths are written to the access log.
 *
 * Creating an account from an invitation starts a session, so it lives with
 * the other session routes, at `POST /auth/register/invitation`.
 */
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  /** What a usable invitation offers. 404 for every unusable one. */
  @Public()
  @Post('lookup')
  @HttpCode(HttpStatus.OK)
  lookup(
    @Body({ schema: invitationTokenRequestSchema })
    body: InvitationTokenRequest,
  ): Promise<InvitationLookupResponse> {
    return this.invitations.lookup(body.token);
  }

  /** Accepts an invitation as the signed-in user, and returns the new grant. */
  @Post('accept')
  @HttpCode(HttpStatus.OK)
  accept(
    @CurrentUserId() userId: string,
    @Body({ schema: invitationTokenRequestSchema })
    body: InvitationTokenRequest,
  ): Promise<MembershipResponse> {
    return this.invitations.accept(body.token, userId);
  }
}
