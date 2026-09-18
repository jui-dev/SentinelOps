/**
 * TEMPORARY — the development account the API ensures when it runs with
 * NODE_ENV=development (apps/api/src/dev/). Shown on the login page in
 * development only, so there is always a known way in.
 *
 * To remove it: delete this folder, the panel in login-form.tsx, and
 * apps/api/src/dev/ with its registration in the API's app.module.ts.
 */
export const DEV_ACCOUNT = {
  email: "admin@example.com",
  password: "dev-password-123",
} as const;

/**
 * Whether to show it. Next inlines NODE_ENV at build time, so in a production
 * build this is constant false and the panel is compiled away.
 */
export const showDevAccount = (): boolean =>
  process.env.NODE_ENV === "development";
