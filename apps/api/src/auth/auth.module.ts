import { Module, RequestMethod } from '@nestjs/common';
import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import type { ConfigType } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { authConfig } from '../config/configuration.js';
import { DatabaseModule } from '../database/database.module.js';
import { InvitationsModule } from '../invitations/invitations.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { PasswordService } from './password.service.js';
import { RegistrationEnabledMiddleware } from './registration-enabled.middleware.js';
import { RefreshTokenService } from './refresh-token.service.js';
import { TokenService } from './token.service.js';

@Module({
  imports: [
    DatabaseModule,
    // For registration by invitation, which creates an account and a session
    // by accepting an invitation.
    InvitationsModule,
    JwtModule.registerAsync({
      // The secret is the only thing configured here. Expiry and issuer are
      // passed per call in TokenService instead, so the values a token is
      // signed with and the values it is verified against are read from one
      // place and cannot drift apart.
      imports: [ConfigModule],
      inject: [authConfig.KEY],
      useFactory: (config: ConfigType<typeof authConfig>) => ({
        secret: config.jwtSecret,
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    PasswordService,
    TokenService,
    RefreshTokenService,
    {
      // Registered here rather than in CommonModule on purpose. APP_GUARD is
      // global wherever it is declared, but keeping it in the module that owns
      // authentication means a spec importing CommonModule alone -- as the
      // validation e2e suite does -- still gets the pipe and filter without
      // acquiring a guard it has no token for.
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
  exports: [TokenService],
})
export class AuthModule implements NestModule {
  /** Creating an organization exists only while REGISTRATION_ENABLED is on. */
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(RegistrationEnabledMiddleware)
      .forRoutes({ path: 'auth/register', method: RequestMethod.POST });
  }
}
