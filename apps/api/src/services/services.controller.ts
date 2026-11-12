import {
  Body,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';

import { CurrentUserId } from '../auth/current-user.decorator.js';
import { Permission } from '../authorization/permissions.js';
import { RequirePermission } from '../authorization/require-permission.decorator.js';
import type { OrganizationContext } from '../common/request-context.js';
import { CurrentMembership } from '../tenancy/current-membership.decorator.js';
import { OrganizationController } from '../tenancy/organization-controller.decorator.js';
import type { ServiceResponse } from './services.contract.js';
import {
  createServiceSchema,
  updateServiceSchema,
} from './services.schemas.js';
import type {
  CreateServiceRequest,
  UpdateServiceRequest,
} from './services.schemas.js';
import { ServicesService } from './services.service.js';

/**
 * An organization's services.
 *
 * The same three layers as every organization route: admission by
 * `@OrganizationController()`, authorization by `@RequirePermission()`, and
 * isolation in the service. Every member may read; changing anything needs
 * `services:manage`. Owning a service grants its team nothing.
 *
 * Path ids are validated in the service, so a malformed one answers 404 like
 * any other id this organization lacks.
 */
@OrganizationController('services')
export class ServicesController {
  constructor(private readonly services: ServicesService) {}

  @Get()
  @RequirePermission(Permission.SERVICES_READ)
  list(
    @CurrentMembership() membership: OrganizationContext,
  ): Promise<ServiceResponse[]> {
    return this.services.list(membership.organizationId);
  }

  /** Creates a service. The slug is derived from the name, never supplied. */
  @Post()
  @RequirePermission(Permission.SERVICES_MANAGE)
  create(
    @CurrentMembership() membership: OrganizationContext,
    @Body({ schema: createServiceSchema }) body: CreateServiceRequest,
    @CurrentUserId() userId: string,
  ): Promise<ServiceResponse> {
    return this.services.create(membership.organizationId, body, userId);
  }

  @Get(':serviceId')
  @RequirePermission(Permission.SERVICES_READ)
  get(
    @CurrentMembership() membership: OrganizationContext,
    @Param('serviceId') serviceId: string,
  ): Promise<ServiceResponse> {
    return this.services.get(membership.organizationId, serviceId);
  }

  /**
   * Changes a service's name, description, criticality, or owning team. The
   * slug never changes.
   */
  @Patch(':serviceId')
  @RequirePermission(Permission.SERVICES_MANAGE)
  update(
    @CurrentMembership() membership: OrganizationContext,
    @Param('serviceId') serviceId: string,
    @Body({ schema: updateServiceSchema }) body: UpdateServiceRequest,
    @CurrentUserId() userId: string,
  ): Promise<ServiceResponse> {
    return this.services.update(
      membership.organizationId,
      serviceId,
      body,
      userId,
    );
  }

  @Delete(':serviceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.SERVICES_MANAGE)
  delete(
    @CurrentMembership() membership: OrganizationContext,
    @Param('serviceId') serviceId: string,
    @CurrentUserId() userId: string,
  ): Promise<void> {
    return this.services.delete(membership.organizationId, serviceId, userId);
  }
}
