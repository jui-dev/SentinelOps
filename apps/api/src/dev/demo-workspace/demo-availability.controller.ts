import { Controller, Get, Inject } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { Public } from '../../auth/public.decorator.js';
import { appConfig } from '../../config/configuration.js';
import { PrismaService } from '../../database/prisma.service.js';
import { demoNotFound } from './demo-workspace.errors.js';

/** What `GET /demo` returns: whether the login page offers the demo. */
export interface DemoAvailabilityResponse {
  available: boolean;
}

/**
 * TEMPORARY — whether this machine has a demo organization, for the login
 * page, which offers its accounts only then. Public: it is asked before
 * anyone signs in, and says only yes or no. Outside development there is
 * no such route: 404, as for any path that does not exist.
 */
@Controller('demo')
export class DemoAvailabilityController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(appConfig.KEY)
    private readonly app: ConfigType<typeof appConfig>,
  ) {}

  @Public()
  @Get()
  async availability(): Promise<DemoAvailabilityResponse> {
    if (this.app.environment !== 'development') {
      throw demoNotFound();
    }

    const demo = await this.prisma.organization.findFirst({
      where: { isDemo: true, deletedAt: null },
      select: { id: true },
    });

    return { available: demo !== null };
  }
}
