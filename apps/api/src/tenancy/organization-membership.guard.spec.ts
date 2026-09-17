import { NotFoundException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';

import {
  getRequestOrganization,
  runWithRequestContext,
  setRequestUser,
} from '../common/request-context.js';
import type { OrganizationContext } from '../common/request-context.js';
import type { MembershipResolver } from './membership-resolver.service.js';
import { OrganizationMembershipGuard } from './organization-membership.guard.js';
import { TenancyErrorCode } from './tenancy.errors.js';

const USER_ID = '0199a1b2-c3d4-7000-8000-000000000001';
const ORG_A = '0199a1b2-c3d4-7000-8000-00000000000a';
const ORG_B = '0199a1b2-c3d4-7000-8000-00000000000b';

const ADMITTED: OrganizationContext = {
  organizationId: ORG_A,
  membershipId: '0199a1b2-c3d4-7000-8000-0000000000aa',
  role: 'ADMIN',
};

interface RequestShape {
  params?: Record<string, string>;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: unknown;
}

const contextWith = (request: RequestShape): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  }) as unknown as ExecutionContext;

const guardWith = (result: OrganizationContext | null = ADMITTED) => {
  const resolve = vi.fn().mockResolvedValue(result);
  const guard = new OrganizationMembershipGuard({
    resolve,
  } as unknown as MembershipResolver);

  return { guard, resolve };
};

/**
 * Runs `callback` inside a request context, authenticated as USER_ID unless
 * `userId` is null.
 */
const inRequest = <T>(
  callback: () => Promise<T>,
  userId: string | null = USER_ID,
): Promise<T> =>
  runWithRequestContext({ requestId: 'req-1' }, () => {
    if (userId) {
      setRequestUser(userId);
    }

    return callback();
  });

describe('OrganizationMembershipGuard', () => {
  describe('admitting a member', () => {
    it('should admit a caller the resolver finds a membership for', async () => {
      const { guard, resolve } = guardWith();

      await inRequest(async () => {
        await expect(
          guard.canActivate(contextWith({ params: { organizationId: ORG_A } })),
        ).resolves.toBe(true);
      });

      expect(resolve).toHaveBeenCalledExactlyOnceWith(USER_ID, ORG_A);
    });

    it('should record the admitted organization on the request context', async () => {
      const { guard } = guardWith();

      await inRequest(async () => {
        await guard.canActivate(
          contextWith({ params: { organizationId: ORG_A } }),
        );

        expect(getRequestOrganization()).toEqual(ADMITTED);
      });
    });

    it('should take the organization only from the route parameter', async () => {
      // Every other place a client could put an organization id names a
      // different one. None of them may influence admission.
      const { guard, resolve } = guardWith();

      await inRequest(async () => {
        await guard.canActivate(
          contextWith({
            params: { organizationId: ORG_A },
            query: { organizationId: ORG_B },
            headers: { 'x-organization-id': ORG_B },
            body: { organizationId: ORG_B },
          }),
        );
      });

      expect(resolve).toHaveBeenCalledExactlyOnceWith(USER_ID, ORG_A);
    });
  });

  describe('refusing admission', () => {
    const expectNotFound = async (promise: Promise<unknown>) => {
      const error = await promise.then(
        () => undefined,
        (caught: unknown) => caught,
      );

      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).errorCode).toBe(
        TenancyErrorCode.ORGANIZATION_NOT_FOUND,
      );
      expect((error as NotFoundException).message).toBe(
        'Organization not found',
      );
    };

    it('should answer 404 when the caller has no membership', async () => {
      const { guard } = guardWith(null);

      await inRequest(async () => {
        await expectNotFound(
          guard.canActivate(contextWith({ params: { organizationId: ORG_A } })),
        );

        expect(getRequestOrganization()).toBeUndefined();
      });
    });

    it.each([
      ['not a uuid', 'acme-operations'],
      ['an empty string', ''],
      ['a uuid with trailing junk', `${ORG_A}x`],
      ['a SQL fragment', "' OR 1=1 --"],
    ])(
      'should answer 404 without querying when the id is %s',
      async (_label, organizationId) => {
        const { guard, resolve } = guardWith();

        await inRequest(async () => {
          await expectNotFound(
            guard.canActivate(contextWith({ params: { organizationId } })),
          );
        });

        expect(resolve).not.toHaveBeenCalled();
      },
    );

    it('should not echo the requested id in the error', async () => {
      const { guard } = guardWith(null);

      await inRequest(async () => {
        const error = await guard
          .canActivate(contextWith({ params: { organizationId: ORG_A } }))
          .catch((caught: NotFoundException) => caught);

        expect(
          JSON.stringify((error as NotFoundException).getResponse()),
        ).not.toContain(ORG_A);
      });
    });
  });

  describe('wiring mistakes', () => {
    it('should throw a plain error when no user was authenticated', async () => {
      // A @Public() organization route. A plain Error surfaces as a masked 500
      // rather than a client-facing status, and never as an admission.
      const { guard, resolve } = guardWith();

      await inRequest(async () => {
        const error = await guard
          .canActivate(contextWith({ params: { organizationId: ORG_A } }))
          .catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(NotFoundException);
      }, null);

      expect(resolve).not.toHaveBeenCalled();
    });

    it('should throw a plain error outside any request context', async () => {
      const { guard } = guardWith();

      await expect(
        guard.canActivate(contextWith({ params: { organizationId: ORG_A } })),
      ).rejects.toThrow(/no authenticated user/);
    });

    it('should throw a plain error on a route without the parameter', async () => {
      const { guard, resolve } = guardWith();

      await inRequest(async () => {
        const error = await guard
          .canActivate(
            contextWith({ params: {}, query: { organizationId: ORG_A } }),
          )
          .catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(NotFoundException);
      });

      expect(resolve).not.toHaveBeenCalled();
    });
  });
});
