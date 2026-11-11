import { ForbiddenException, HttpException, SetMetadata } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import {
  runWithRequestContext,
  setRequestOrganization,
  setRequestUser,
} from '../common/request-context.js';
import type { OrganizationContext } from '../common/request-context.js';
import type { Role } from '../generated/prisma/enums.js';
import { REQUIRED_PERMISSION_KEY } from './authorization.constants.js';
import { AuthorizationErrorCode } from './authorization.errors.js';
import { OrganizationPermissionGuard } from './organization-permission.guard.js';
import { Permission } from './permissions.js';

const ORG_A = '0199a1b2-c3d4-7000-8000-00000000000a';
const ORG_B = '0199a1b2-c3d4-7000-8000-00000000000b';

const membershipAs = (role: Role): OrganizationContext => ({
  organizationId: ORG_A,
  membershipId: '0199a1b2-c3d4-7000-8000-0000000000aa',
  role,
});

interface RequestShape {
  params?: Record<string, string>;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: unknown;
}

const handlerRequiring = (permission?: Permission): (() => void) => {
  const handler = function handler() {};

  if (permission) {
    SetMetadata(REQUIRED_PERMISSION_KEY, permission)(handler);
  }

  return handler;
};

const contextWith = (
  handler: () => void,
  request: RequestShape = {},
): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => class Controller {},
  }) as unknown as ExecutionContext;

const guard = new OrganizationPermissionGuard(new Reflector());

/** Runs `callback` inside a request admitted with `membership`, if any. */
const inRequest = <T>(
  membership: OrganizationContext | null,
  callback: () => T,
): T =>
  runWithRequestContext({ requestId: 'req-1' }, () => {
    setRequestUser('0199a1b2-c3d4-7000-8000-000000000001');

    if (membership) {
      setRequestOrganization(membership);
    }

    return callback();
  });

const thrownBy = (callback: () => unknown): unknown => {
  try {
    callback();
  } catch (caught) {
    return caught;
  }

  throw new Error('Expected the guard to throw');
};

describe('OrganizationPermissionGuard', () => {
  describe('allowing', () => {
    it.each<[Role, Permission]>([
      ['ADMIN', Permission.ORGANIZATION_UPDATE],
      ['RESPONDER', Permission.ORGANIZATION_READ],
      ['RESPONDER', Permission.MEMBERSHIPS_READ],
    ])('should let %s through to a %s handler', (role, permission) => {
      expect(
        inRequest(membershipAs(role), () =>
          guard.canActivate(contextWith(handlerRequiring(permission))),
        ),
      ).toBe(true);
    });

    it('should decide synchronously', () => {
      const result = inRequest(membershipAs('ADMIN'), () =>
        guard.canActivate(
          contextWith(handlerRequiring(Permission.ORGANIZATION_UPDATE)),
        ),
      );

      expect(result).not.toBeInstanceOf(Promise);
    });
  });

  describe('denying', () => {
    const denial = (request: RequestShape = {}) =>
      inRequest(membershipAs('RESPONDER'), () =>
        thrownBy(() =>
          guard.canActivate(
            contextWith(
              handlerRequiring(Permission.ORGANIZATION_UPDATE),
              request,
            ),
          ),
        ),
      );

    it('should refuse a role without the permission with 403 PERMISSION_DENIED', () => {
      const error = denial();

      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getStatus()).toBe(403);
      expect((error as ForbiddenException).errorCode).toBe(
        AuthorizationErrorCode.PERMISSION_DENIED,
      );
      expect((error as ForbiddenException).message).toBe(
        'You do not have permission to perform this action',
      );
    });

    it('should name neither the permission nor a role in the error', () => {
      const body = JSON.stringify(
        (denial() as ForbiddenException).getResponse(),
      );

      expect(body).not.toContain('organization:update');
      expect(body).not.toMatch(/OWNER|ADMIN|MEMBER/);
    });

    it('should ignore any role or organization the request itself claims', () => {
      // Every place a client could assert a better role or another tenant.
      // The decision rests on the admitted membership alone.
      const error = denial({
        params: { organizationId: ORG_A, role: 'ADMIN' },
        query: { role: 'ADMIN', organizationId: ORG_B },
        headers: { 'x-role': 'ADMIN', 'x-organization-id': ORG_B },
        body: { role: 'ADMIN', membership: { role: 'ADMIN' } },
      });

      expect(error).toBeInstanceOf(ForbiddenException);
    });
  });

  describe('failing closed on wiring mistakes', () => {
    const expectPlainError = (error: unknown, message: RegExp) => {
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toBeInstanceOf(HttpException);
      expect((error as Error).message).toMatch(message);
    };

    it('should throw a plain error when no organization was admitted', () => {
      // @RequirePermission() on a controller that is not organization-scoped.
      const error = inRequest(null, () =>
        thrownBy(() =>
          guard.canActivate(
            contextWith(handlerRequiring(Permission.ORGANIZATION_READ)),
          ),
        ),
      );

      expectPlainError(error, /no admitted organization/);
    });

    it('should throw a plain error outside any request context', () => {
      const error = thrownBy(() =>
        guard.canActivate(
          contextWith(handlerRequiring(Permission.ORGANIZATION_READ)),
        ),
      );

      expectPlainError(error, /no admitted organization/);
    });

    it('should throw a plain error on a handler that declares no permission', () => {
      const error = inRequest(membershipAs('ADMIN'), () =>
        thrownBy(() => guard.canActivate(contextWith(handlerRequiring()))),
      );

      expectPlainError(error, /declares no permission/);
    });
  });
});
