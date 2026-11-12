import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { ActivityModule } from './activity/activity.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CommonModule } from './common/common.module.js';
import { configurations } from './config/configuration.js';
import { ROOT_ENV_FILE } from './config/env.js';
import { envSchema } from './config/env.validation.js';
import { DatabaseModule } from './database/database.module.js';
import { DevModule } from './dev/dev.module.js';
import { HealthModule } from './health/health.module.js';
import { IncidentAnalysesModule } from './incident-analyses/incident-analyses.module.js';
import { IncidentsModule } from './incidents/incidents.module.js';
import { InvitationsModule } from './invitations/invitations.module.js';
import { LoggerModule } from './logger/logger.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { OrganizationsModule } from './organizations/organizations.module.js';
import { KnownIssuesModule } from './known-issues/known-issues.module.js';
import { ServicesModule } from './services/services.module.js';
import { TeamsModule } from './teams/teams.module.js';

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
    // Also imported by AuthModule for registration by invitation; listed here
    // so the application's feature modules read in one place.
    InvitationsModule,
    TeamsModule,
    ServicesModule,
    KnownIssuesModule,
    ActivityModule,
    IncidentsModule,
    IncidentAnalysesModule,
    NotificationsModule,
    // TEMPORARY: ensures a known login in development only. Remove with
    // src/dev/ — see src/dev/dev-account.ts.
    DevModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
