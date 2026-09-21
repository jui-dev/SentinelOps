import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { TeamsController } from './teams.controller.js';
import { TeamsService } from './teams.service.js';

/**
 * Teams: organization-scoped routes only. TenancyModule supplies admission,
 * `@RequirePermission()` authorization, and TeamsService isolation;
 * NotificationsModule the writer that tells a member of their placement.
 */
@Module({
  imports: [DatabaseModule, TenancyModule, NotificationsModule],
  controllers: [TeamsController],
  providers: [TeamsService],
})
export class TeamsModule {}
