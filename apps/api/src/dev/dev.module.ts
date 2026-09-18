import { Module } from '@nestjs/common';

import { PasswordService } from '../auth/password.service.js';
import { DatabaseModule } from '../database/database.module.js';
import { DevAccountService } from './dev-account.service.js';

/**
 * TEMPORARY — the development account. See dev-account.ts.
 *
 * Provides its own PasswordService rather than reaching into AuthModule, so
 * removing this module touches nothing else.
 */
@Module({
  imports: [DatabaseModule],
  providers: [DevAccountService, PasswordService],
})
export class DevModule {}
