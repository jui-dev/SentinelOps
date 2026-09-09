import { createParamDecorator } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';

import { getRequestUser } from '../common/request-context.js';

/**
 * The authenticated caller's id.
 *
 * Named for exactly what it returns. The access token carries identity and
 * nothing else, and the guard performs no database lookup, so there is no
 * organization, role, or email to hand over — a `@CurrentUser()` returning a
 * one-field object would promise more than it holds.
 *
 * When the request context later gains organization and role, a `@CurrentUser()`
 * reading the same store joins this one rather than replacing it, and handlers
 * that only need an id keep using this.
 *
 * Reads the AsyncLocalStorage context rather than a property hung on the Express
 * request, so no module augmentation of `Request` is needed under NodeNext ESM —
 * the same reasoning that led RequestIdMiddleware to write its id back onto the
 * headers.
 */
export const CurrentUserId = createParamDecorator(
  (_data: unknown, _context: ExecutionContext): string => {
    const userId = getRequestUser();

    if (!userId) {
      // Only reachable by using this decorator on a route the guard does not
      // protect. That is a wiring mistake, not a client error: it surfaces as a
      // masked 500 with the real cause in the log, which is what an unhandled
      // programming error should do.
      throw new Error(
        'CurrentUserId was read on a route with no authenticated user. ' +
          'Remove @Public() from the handler, or stop reading the current user on it.',
      );
    }

    return userId;
  },
);
