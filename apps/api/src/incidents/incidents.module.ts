import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { IncidentsController } from './incidents.controller.js';
import { IncidentsService } from './incidents.service.js';
import { MemberResponsesController } from './member-responses.controller.js';

/**
 * Incidents, and each member's responses to them: organization-scoped
 * routes only. TenancyModule supplies
 * admission, `@RequirePermission()` authorization, and IncidentsService
 * isolation. It imports neither ServicesModule nor TeamsModule: a service and
 * a team are checked against their tables, and only their error codes are
 * shared.
 */
@Module({
  imports: [DatabaseModule, TenancyModule],
  controllers: [IncidentsController, MemberResponsesController],
  providers: [IncidentsService],
})
export class IncidentsModule {}
