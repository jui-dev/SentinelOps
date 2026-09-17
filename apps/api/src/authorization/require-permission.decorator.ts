import { SetMetadata, UseGuards } from '@nestjs/common';

import { REQUIRED_PERMISSION_KEY } from './authorization.constants.js';
import { OrganizationPermissionGuard } from './organization-permission.guard.js';
import type { Permission } from './permissions.js';

/**
 * Declares the permission a handler in an `@OrganizationController()`
 * requires.
 *
 * The metadata and the guard that enforces it arrive together — the same
 * pairing `@OrganizationController()` makes for admission — so a permission
 * cannot be declared without being enforced. Admission in turn refuses any
 * handler that declares none, which is what makes every organization route
 * deny by default.
 *
 * Methods only. A method guard always runs after the controller's admission
 * guard; a class-level one would run before or after it depending on the order
 * the decorators happened to be written in.
 *
 * Exactly one permission. A route that genuinely needs two will say whether it
 * means all of them or any of them when it arrives.
 */
export const RequirePermission =
  (permission: Permission): MethodDecorator =>
  (target, propertyKey, descriptor) => {
    SetMetadata(REQUIRED_PERMISSION_KEY, permission)(
      target,
      propertyKey,
      descriptor,
    );
    UseGuards(OrganizationPermissionGuard)(target, propertyKey, descriptor);
  };
