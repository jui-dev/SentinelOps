import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { ROOT_ENV_FILE } from './config/env.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';

@Module({
  imports: [
    // Loads the workspace-root .env once, globally, so application modules
    // inject ConfigService instead of reading process.env directly.
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [ROOT_ENV_FILE],
    }),
    DatabaseModule,
    HealthModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
