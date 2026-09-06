import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  // Lets Nest run onModuleDestroy on SIGINT/SIGTERM, so Prisma disconnects
  // from PostgreSQL cleanly instead of leaving the connection to time out.
  app.enableShutdownHooks();
  const config = app.get(ConfigService);
  await app.listen(config.get<string>('PORT') ?? 3001);
}
await bootstrap();
