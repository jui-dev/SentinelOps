import { Module } from '@nestjs/common';

import { PrismaService } from './prisma.service.js';

/**
 * Owns the application's database connection. Deliberately contains no
 * repositories or domain services — those arrive with the domain models.
 */
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
