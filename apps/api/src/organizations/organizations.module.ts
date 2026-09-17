import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { OrganizationsController } from './organizations.controller.js';
import { OrganizationsService } from './organizations.service.js';

/**
 * The first organization-scoped routes. TenancyModule supplies admission;
 * `@RequirePermission()` supplies authorization, needing nothing imported
 * beyond the Reflector Nest provides everywhere; OrganizationsService supplies
 * resource isolation.
 */
@Module({
  imports: [DatabaseModule, TenancyModule],
  controllers: [OrganizationsController],
  providers: [OrganizationsService],
})
export class OrganizationsModule {}
