import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { KnownIssuesController } from './known-issues.controller.js';
import { KnownIssuesService } from './known-issues.service.js';

/**
 * Known issues: organization-scoped routes only, admitted, authorized and
 * isolated as services are. Declaring links to them inside IncidentsService's
 * own transaction (see known-issues.declare.ts), so nothing here is exported.
 */
@Module({
  imports: [DatabaseModule, TenancyModule],
  controllers: [KnownIssuesController],
  providers: [KnownIssuesService],
})
export class KnownIssuesModule {}
