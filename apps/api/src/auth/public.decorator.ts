import { SetMetadata } from '@nestjs/common';

/**
 * Namespaced so it cannot collide with metadata set by Nest or by a library.
 */
export const IS_PUBLIC_KEY = 'auth:isPublic';

/**
 * Marks a route reachable without authentication.
 *
 * The opt-out half of a secure default: JwtAuthGuard is registered globally, so
 * every route is protected unless it carries this. A new endpoint someone
 * forgets to think about is closed rather than open, and opening one is a
 * visible line in a diff.
 *
 * Applied to a controller class it covers every route in it. On a handler it
 * covers that route only, and wins over the class.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
