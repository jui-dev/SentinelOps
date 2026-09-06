import {
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: ConfigService) {
    // Prisma 7 removed the Rust query engine, so a driver adapter is required
    // for every database and the connection string is handed to the adapter
    // rather than declared in schema.prisma.
    super({
      adapter: new PrismaPg({
        connectionString: config.getOrThrow<string>('DATABASE_URL'),
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      // The pg driver adapter opens connections lazily, so $connect() alone
      // resolves even when PostgreSQL is unreachable. One probe query makes the
      // startup log truthful and surfaces a bad DATABASE_URL immediately rather
      // than at the first real query.
      await this.$queryRaw`SELECT 1`;
      this.logger.log('Connected to PostgreSQL');
    } catch (error) {
      // A momentarily unavailable database must not crash-loop the process:
      // liveness stays up and GET /api/v1/health/ready reports the outage. The
      // failure is logged loudly rather than swallowed. No connection state is
      // cached — the readiness probe remains the source of truth.
      this.logger.error(
        'Failed to connect to PostgreSQL during startup. The API will keep running, but readiness will fail until the database is reachable.',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
