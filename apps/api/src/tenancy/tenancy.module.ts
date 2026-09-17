import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { MembershipResolver } from './membership-resolver.service.js';
import { OrganizationMembershipGuard } from './organization-membership.guard.js';

/**
 * Tenant admission, and nothing else: no routes of its own.
 *
 * A module that declares organization-scoped controllers imports this one. The
 * guard is attached with `@UseGuards` and is instantiated in the consuming
 * module's injector, which is why MembershipResolver has to be exported
 * rather than kept private.
 */
@Module({
  imports: [DatabaseModule],
  providers: [MembershipResolver, OrganizationMembershipGuard],
  exports: [MembershipResolver, OrganizationMembershipGuard],
})
export class TenancyModule {}
