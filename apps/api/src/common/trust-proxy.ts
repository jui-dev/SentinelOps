import type { NestExpressApplication } from '@nestjs/platform-express';

/**
 * Tells Express how many reverse proxies to look through for the client's
 * address, which is what `@Ip()` — and so every per-address sign-in limit —
 * reads.
 *
 * 0 trusts no proxy: the address is the connection's own, and any
 * X-Forwarded-For header is ignored, so a client cannot claim another
 * address. N trusts exactly N hops: the address is taken N entries from the
 * right of X-Forwarded-For, which a client can only prepend to, never replace.
 */
export const applyTrustProxy = (
  app: NestExpressApplication,
  hops: number,
): void => {
  app.set('trust proxy', hops > 0 ? hops : false);
};
