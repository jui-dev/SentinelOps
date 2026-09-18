import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { TeamsController } from './teams.controller.js';
import { TeamsService } from './teams.service.js';

/**
 * Teams: organization-scoped routes only. TenancyModule supplies admission,
 * `@RequirePermission()` authorization, and TeamsService isolation.
 */
@Module({
  imports: [DatabaseModule, TenancyModule],
  controllers: [TeamsController],
  providers: [TeamsService],
})
export class TeamsModule {}
