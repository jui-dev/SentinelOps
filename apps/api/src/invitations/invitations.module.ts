import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
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
 */
@Module({
  imports: [DatabaseModule, TenancyModule],
  controllers: [OrganizationInvitationsController, InvitationsController],
  providers: [InvitationsService],
  exports: [InvitationsService],
})
export class InvitationsModule {}
