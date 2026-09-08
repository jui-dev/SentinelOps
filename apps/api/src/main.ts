import { NestFactory } from '@nestjs/core';
import type { ConfigType } from '@nestjs/config';
import { AppModule } from './app.module.js';
import { appConfig } from './config/configuration.js';
import { AppLogger } from './logger/app.logger.js';

async function bootstrap() {
  // Nest's framework startup logs are emitted before any provider exists, so
  // they are buffered and replayed through AppLogger once it is installed
  // below. The flush happens inside `app.init()`, which for an HTTP app runs as
  // part of `listen()` — after `useLogger`, which is what makes this work.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  // The leading slash is load-bearing. Nest passes this prefix straight to
  // `app.use(prefix, notFoundHandler)`, and Express 5 never matches a path
  // without it — unmatched routes would bypass the exception filter entirely
  // and fall through to Express's default HTML error page.
  app.setGlobalPrefix('/api/v1');
  // Lets Nest run onModuleDestroy on SIGINT/SIGTERM, so Prisma disconnects
  // from PostgreSQL cleanly instead of leaving the connection to time out.
  app.enableShutdownHooks();
  // Installs the application logger globally, so every `new Logger(Context)` in
  // the codebase — and Nest's own internals — route through it. Nothing else
  // imports AppLogger; this is the single seam.
  app.useLogger(app.get(AppLogger));
  // Resolved by token rather than by name: the port is already validated and
  // coerced to a number, and its default lives in the schema, not here.
  const { port } = app.get<ConfigType<typeof appConfig>>(appConfig.KEY);
  await app.listen(port);
}
await bootstrap();
