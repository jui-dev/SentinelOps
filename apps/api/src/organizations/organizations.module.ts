import { Module } from '@nestjs/common';

import { PasswordService } from '../auth/password.service.js';
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
  // Its own PasswordService, stateless, rather than importing AuthModule for
  // one hashing function: adding a member creates an account.
  providers: [OrganizationsService, PasswordService],
})
export class OrganizationsModule {}
