import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database/database.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { IncidentAnalysesController } from './incident-analyses.controller.js';
import { IncidentAnalysesService } from './incident-analyses.service.js';

/**
 * Incident analyses: organization-scoped routes only. TenancyModule supplies
 * admission, `@RequirePermission()` authorization, and
 * IncidentAnalysesService isolation. It does not import IncidentsModule: an
 * incident is read from its table, and only its error code and number
 * parsing are shared.
 */
@Module({
  imports: [DatabaseModule, TenancyModule],
  controllers: [IncidentAnalysesController],
  providers: [IncidentAnalysesService],
})
export class IncidentAnalysesModule {}
