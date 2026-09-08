import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The ambient context carried alongside a request.
 *
 * Deliberately minimal: it holds what is known before any application code
 * runs. Authentication does not exist yet, so there is no `userId` here — the
 * shape is designed to gain one (and a `traceId`) without touching a single
 * call site, because nothing reads this store by destructuring it.
 */
export interface RequestContext {
  requestId: string;
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
