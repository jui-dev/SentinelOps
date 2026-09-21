import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';

/**
 * Each member's notifications: organization-scoped routes only. TenancyModule
 * supplies admission, `@RequirePermission()` authorization, and
 * NotificationsService isolation.
 */
@Module({
  imports: [DatabaseModule, TenancyModule],
  controllers: [NotificationsController],
  providers: [NotificationsService],
})
export class NotificationsModule {}
