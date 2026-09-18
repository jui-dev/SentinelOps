import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { ServicesController } from './services.controller.js';
import { ServicesService } from './services.service.js';

/**
 * Services: organization-scoped routes only. TenancyModule supplies admission,
 * `@RequirePermission()` authorization, and ServicesService isolation. It does
 * not import TeamsModule: an owner is checked against the teams table.
 */
@Module({
  imports: [DatabaseModule, TenancyModule],
  controllers: [ServicesController],
  providers: [ServicesService],
})
export class ServicesModule {}
