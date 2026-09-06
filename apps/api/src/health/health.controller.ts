import {
  Controller,
  Get,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

import { PrismaService } from '../database/prisma.service.js';

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Liveness — is the application process running? Deliberately touches no
   * infrastructure, so a database outage never marks the process as dead.
   */
  @Get()
  getHealth(): { status: string } {
    return { status: 'ok' };
  }

  /**
   * Readiness — is the application able to serve requests, database included?
   * The probe query runs on every request rather than reading cached state, so
   * the response always reflects the database's current reachability.
   */
  @Get('ready')
  async getReadiness(): Promise<{ status: string; database: string }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      this.logger.error(
        'Readiness probe failed: PostgreSQL is not reachable',
        error instanceof Error ? error.stack : String(error),
      );

      throw new ServiceUnavailableException({
        status: 'error',
        database: 'down',
      });
    }

    return { status: 'ok', database: 'up' };
  }
}
