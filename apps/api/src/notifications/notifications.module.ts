import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { NotificationsWriter } from './notifications.writer.js';

/**
 * Each member's notifications: organization-scoped routes, and the writer
 * the services whose changes they report call inside their own transactions.
 * TenancyModule supplies admission, `@RequirePermission()` authorization, and
 * NotificationsService isolation.
 */
@Module({
  imports: [DatabaseModule, TenancyModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationsWriter],
  exports: [NotificationsWriter],
})
export class NotificationsModule {}
