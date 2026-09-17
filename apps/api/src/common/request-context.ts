import { AsyncLocalStorage } from 'node:async_hooks';

import type { Role } from '../generated/prisma/enums.js';

/**
 * The organization a request was admitted to, and the membership that admitted
 * it.
 *
 * Admission only. Holding one of these means the caller is a current member of
 * `organizationId`; it says nothing about whether any particular row belongs to
 * that organization. Every tenant-owned query still scopes by organizationId
 * itself.
 *
 * `role` is what OrganizationPermissionGuard authorizes against, so no second
 * membership lookup is needed. Services do not read it from here: one that
 * needs the caller's role takes it as an explicit parameter.
 */
export interface OrganizationContext {
  organizationId: string;
  membershipId: string;
  role: Role;
}

/**
 * The ambient context carried alongside a request.
 *
 * It holds what is known about the request rather than what a handler was
 * given: the correlation id from the moment the request arrived, the
 * authenticated user from the moment the guard verified one, and the
 * organization from the moment membership admitted the request to it.
 *
 * `userId` and `organization` are optional because most of a request's life
 * happens before authentication, and because most routes never acquire them.
 * Nothing reads this store by destructuring it, so a `traceId` can join them
 * later without touching a call site.
 */
export interface RequestContext {
  requestId: string;
  userId?: string;
  organization?: OrganizationContext;
}

/**
 * Ambient request state, so a logger can correlate a line without being handed
 * the Express `Request`.
 *
 * AsyncLocalStorage rather than a request-scoped provider: `Scope.REQUEST`
 * bubbles up the entire injection chain of anything that consumes it, forcing
 * per-request instantiation of transitively dependent providers, and it does
 * not reach middleware or the exception filter at all. This costs one `run()`
 * per request and reaches every one of them.
 */
const storage = new AsyncLocalStorage<RequestContext>();

/**
 * Runs `callback` with `context` visible to everything downstream — including
 * across `await`, promise rejections, and event handlers registered inside the
 * callback.
 *
 * Invoked synchronously, so a middleware wrapping `next()` in this behaves
 * exactly as it did when it called `next()` directly.
 */
export const runWithRequestContext = <T>(
  context: RequestContext,
  callback: () => T,
): T => storage.run(context, callback);

/**
 * The current request's correlation id, or `undefined` outside a request.
 *
 * The undefined case is normal, not exceptional: application bootstrap,
 * shutdown hooks, and any future background work all log from outside a
 * request. Callers omit the field rather than inventing an id that would
 * correlate with nothing.
 */
export const getRequestId = (): string | undefined =>
  storage.getStore()?.requestId;

/**
 * Records the authenticated user on the current request's context.
 *
 * Mutates the existing store rather than opening a new scope: `storage.run()`
 * here would establish a context that ends when this function returns, which is
 * the opposite of what a guard needs. The object handed to `run()` by the
 * middleware is shared by everything downstream, so writing to it is visible to
 * the handler, the exception filter, and every log line that follows.
 *
 * Silently does nothing outside a request. That is not a failure worth throwing
 * over: it means the guard ran somewhere no middleware established a context,
 * which a unit test does all the time.
 */
export const setRequestUser = (userId: string): void => {
  const store = storage.getStore();

  if (store) {
    store.userId = userId;
  }
};

/**
 * The authenticated user's id, or undefined when the request is unauthenticated
 * or has not reached the guard yet.
 */
export const getRequestUser = (): string | undefined =>
  storage.getStore()?.userId;

/**
 * Records the organization the current request was admitted to.
 *
 * Mutates the store for the same reason setRequestUser does, and likewise does
 * nothing outside a request — `@CurrentMembership()` still fails closed there.
 *
 * Refuses to replace one organization with another. A request acts within
 * exactly one tenant; a second admission naming a different one is a wiring
 * mistake that would otherwise leave log lines and handlers disagreeing about
 * which tenant they are in.
 */
export const setRequestOrganization = (
  organization: OrganizationContext,
): void => {
  const store = storage.getStore();

  if (!store) {
    return;
  }

  if (
    store.organization &&
    store.organization.organizationId !== organization.organizationId
  ) {
    throw new Error(
      'This request has already been admitted to a different organization.',
    );
  }

  store.organization = organization;
};

/**
 * The organization the request was admitted to, or undefined when the route is
 * not organization-scoped or admission has not happened yet.
 *
 * For cross-cutting concerns such as logging. A service that needs the
 * organization takes it as an explicit parameter instead.
 */
export const getRequestOrganization = (): OrganizationContext | undefined =>
  storage.getStore()?.organization;
