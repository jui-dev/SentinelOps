import { Module, RequestMethod } from '@nestjs/common';
import type { MiddlewareConsumer, NestModule } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { InvitationsEnabledMiddleware } from './invitations-enabled.middleware.js';
import { InvitationsController } from './invitations.controller.js';
import { InvitationsService } from './invitations.service.js';
import { OrganizationInvitationsController } from './organization-invitations.controller.js';

/**
 * Invitations: the organization-scoped routes that manage them, and the token
 * routes an invitee uses.
 *
 * Exports the service for AuthModule, whose signup-by-invitation route starts
 * a session. It imports nothing from AuthModule in return — the token helper
 * it shares with refresh tokens lives in common/.
 *
 * Every invitation route — these controllers' and AuthModule's sign-up by
 * invitation — exists only while INVITATIONS_ENABLED is on. See
 * InvitationsEnabledMiddleware.
 */
@Module({
  imports: [DatabaseModule, TenancyModule],
  controllers: [OrganizationInvitationsController, InvitationsController],
  providers: [InvitationsService],
  exports: [InvitationsService],
})
export class InvitationsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(InvitationsEnabledMiddleware)
      .forRoutes(OrganizationInvitationsController, InvitationsController, {
        path: 'auth/register/invitation',
        method: RequestMethod.POST,
      });
  }
}
