import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';

import { REQUIRED_PERMISSION_KEY } from './authorization.constants.js';
import { OrganizationPermissionGuard } from './organization-permission.guard.js';
import { Permission } from './permissions.js';
import { RequirePermission } from './require-permission.decorator.js';

class ProbeController {
  @RequirePermission(Permission.ORGANIZATION_UPDATE)
  update(): void {}

  undeclared(): void {}
}

describe('RequirePermission', () => {
  const reflector = new Reflector();

  it('should record the permission on the handler', () => {
    expect(
      reflector.get(REQUIRED_PERMISSION_KEY, ProbeController.prototype.update),
    ).toBe(Permission.ORGANIZATION_UPDATE);
  });

  it('should attach the permission guard to the same handler', () => {
    // Declared and enforced together: the metadata never exists without the
    // guard that reads it.
    expect(
      Reflect.getMetadata(GUARDS_METADATA, ProbeController.prototype.update),
    ).toEqual([OrganizationPermissionGuard]);
  });

  it('should attach nothing at class level', () => {
    // A class-level guard could run before admission.
    expect(
      Reflect.getMetadata(GUARDS_METADATA, ProbeController),
    ).toBeUndefined();
  });

  it('should leave other handlers undeclared', () => {
    expect(
      reflector.get(
        REQUIRED_PERMISSION_KEY,
        ProbeController.prototype.undeclared,
      ),
    ).toBeUndefined();
  });
});
