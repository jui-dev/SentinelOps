import { Module } from '@nestjs/common';

import { PasswordService } from '../auth/password.service.js';
import { DatabaseModule } from '../database/database.module.js';
import { TenancyModule } from '../tenancy/tenancy.module.js';
import { DevAccountService } from './dev-account.service.js';
import { DemoHistoryService } from './demo-history/demo-history.service.js';
import { DemoWorkspaceController } from './demo-workspace/demo-workspace.controller.js';
import { DemoWorkspaceService } from './demo-workspace/demo-workspace.service.js';

/**
 * TEMPORARY — the development account, the demo history the demo:history
 * command writes for it, and the demo workspace its Admin keeps from
 * Settings. See dev-account.ts.
 *
 * Provides its own PasswordService rather than reaching into AuthModule, so
 * removing this module touches nothing else.
 */
@Module({
  imports: [DatabaseModule, TenancyModule],
  controllers: [DemoWorkspaceController],
  providers: [
    DevAccountService,
    DemoHistoryService,
    DemoWorkspaceService,
    PasswordService,
  ],
})
export class DevModule {}
