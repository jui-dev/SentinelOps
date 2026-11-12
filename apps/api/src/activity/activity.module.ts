import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { ActivityController } from './activity.controller.js';
import { ActivityService } from './activity.service.js';

/**
 * The activity log: reading it, on organization-scoped routes. Writing
 * happens inside each change's own transaction through recordActivity
 * (activity.recorder.ts), a plain function, so nothing here is exported.
 */
@Module({
  imports: [DatabaseModule, TenancyModule],
  controllers: [ActivityController],
  providers: [ActivityService],
})
export class ActivityModule {}
