import { Module, StandardSchemaValidationPipe } from '@nestjs/common';
import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';

import { AllExceptionsFilter } from './all-exceptions.filter.js';
import { RequestIdMiddleware } from './request-id.middleware.js';
import { validationExceptionFactory } from './validation-exception.factory.js';

/**
 * The API's request/response conventions, in one place: correlation ids,
 * schema validation, and the single error contract.
 *
 * These are registered as APP_PIPE / APP_FILTER providers rather than through
 * `useGlobalPipes` / `useGlobalFilters` in main.ts, so that anything importing
 * AppModule — every e2e spec — gets the real production wiring for free
 * instead of re-declaring it by hand.
 */
@Module({
  providers: [
    {
      provide: APP_PIPE,
      // Nest 12 ships this pipe and depends on @standard-schema/spec directly,
      // so Zod schemas are usable as-is: no adapter, no extra dependency. It is
      // a no-op for any parameter that does not declare a schema, which makes
      // registering it globally safe and validation opt-in per parameter.
      useFactory: () =>
        new StandardSchemaValidationPipe({
          exceptionFactory: validationExceptionFactory,
        }),
    },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class CommonModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Express 5's own wildcard syntax, written out rather than left as '*'.
    // Nest would auto-convert '*' to this, but only after logging a
    // legacy-route deprecation warning on every boot once a global prefix is
    // set — the path it converts is '/api/v1/*', not the bare all-wildcard it
    // stays quiet about.
    consumer.apply(RequestIdMiddleware).forRoutes('{*path}');
  }
}
