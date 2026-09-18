/**
 * TEMPORARY — a fixed account for local development, so there is always a
 * known login. It exists only when the API runs with NODE_ENV=development;
 * DevAccountService ensures it at boot and nothing else reads these values.
 *
 * To remove it: delete this folder (src/dev/), its registration in
 * app.module.ts, apps/web/src/lib/dev/, and the panel in the web login form.
 *
 * `example.com` is reserved (RFC 2606), so the address can never belong to
 * anyone real.
 */
export const DEV_ACCOUNT = {
  email: 'admin@example.com',
  password: 'dev-password-123',
  name: 'Dev Admin',
  organizationName: 'SentinelOps Dev',
  organizationSlug: 'sentinelops-dev',
} as const;
