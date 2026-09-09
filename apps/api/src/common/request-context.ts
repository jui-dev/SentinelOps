import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The ambient context carried alongside a request.
 *
 * It holds what is known about the request rather than what a handler was
 * given: the correlation id from the moment the request arrived, and the
 * authenticated user from the moment the guard verified one.
 *
 * `userId` is optional because most of a request's life happens before
 * authentication, and because public routes never acquire one. Nothing reads
 * this store by destructuring it, so a `traceId` can join them later without
 * touching a call site.
 */
export interface RequestContext {
  requestId: string;
  userId?: string;
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
