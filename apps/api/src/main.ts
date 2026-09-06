import { NestFactory } from '@nestjs/core';
import type { ConfigType } from '@nestjs/config';
import { AppModule } from './app.module.js';
import { appConfig } from './config/configuration.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  // Lets Nest run onModuleDestroy on SIGINT/SIGTERM, so Prisma disconnects
  // from PostgreSQL cleanly instead of leaving the connection to time out.
  app.enableShutdownHooks();
  // Resolved by token rather than by name: the port is already validated and
  // coerced to a number, and its default lives in the schema, not here.
  const { port } = app.get<ConfigType<typeof appConfig>>(appConfig.KEY);
  await app.listen(port);
}
await bootstrap();
