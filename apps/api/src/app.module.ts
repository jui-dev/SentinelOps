import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AuthModule } from './auth/auth.module.js';
import { CommonModule } from './common/common.module.js';
import { configurations } from './config/configuration.js';
import { ROOT_ENV_FILE } from './config/env.js';
import { envSchema } from './config/env.validation.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { LoggerModule } from './logger/logger.module.js';
import { OrganizationsModule } from './organizations/organizations.module.js';

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
    // Ahead of HealthModule because it registers the global guard that
    // HealthModule's routes opt out of with @Public().
    AuthModule,
    HealthModule,
    // After AuthModule, whose global guard authenticates the caller before
    // this module's controller-level admission guard runs. Nest orders global
    // guards before controller guards regardless of module order; the
    // placement just keeps the dependency readable.
    OrganizationsModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
