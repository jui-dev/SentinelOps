import { Global, Module } from '@nestjs/common';

import { AppLogger } from './app.logger.js';

/**
 * Provides the application's logger.
 *
 * Global so that `main.ts` can resolve AppLogger with `app.get()` in order to
 * install it, and so a future module could inject the instance directly if it
 * ever needed to. Domain modules are not expected to: they use the `Logger`
 * facade, which routes here once `app.useLogger()` has run.
 */
@Global()
@Module({
  providers: [AppLogger],
  exports: [AppLogger],
})
export class LoggerModule {}
