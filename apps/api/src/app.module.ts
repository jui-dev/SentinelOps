import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { CommonModule } from './common/common.module.js';
import { configurations } from './config/configuration.js';
import { ROOT_ENV_FILE } from './config/env.js';
import { envSchema } from './config/env.validation.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { LoggerModule } from './logger/logger.module.js';

@Module({
  imports: [
    // Loads the workspace-root .env once, globally, so application modules
    // consume structured configuration instead of reading process.env directly.
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [ROOT_ENV_FILE],
      // Validation runs before any provider is instantiated, so a malformed
      // environment aborts the boot rather than failing at the first read.
      validationSchema: envSchema,
      // Exposes the validated values as the `app.*` and `database.*` domains.
      load: configurations,
    }),
    // Ahead of CommonModule, whose middleware and exception filter both log:
    // the logger is infrastructure everything else assumes.
    LoggerModule,
    // Establishes the API-wide request and error conventions before any
    // feature module is loaded.
    CommonModule,
    DatabaseModule,
    HealthModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
