/**
 * TEMPORARY — the development personas the API ensures when it runs with
 * NODE_ENV=development (apps/api/src/dev/). Shown on the login page in
 * development only, so switching between them is one click. Kept in step
 * with apps/api/src/dev/dev-account.ts by hand.
 *
 * To remove it: delete this folder, the panel in login-form.tsx, and
 * apps/api/src/dev/ with its registration in the API's app.module.ts.
 */
export const DEV_PASSWORD = "dev-password-123";

export const DEV_PERSONAS = [
  { email: "admin@example.com", name: "Morgan Reyes", label: "Admin" },
  { email: "ava@example.com", name: "Ava Kim", label: "Incident Manager" },
  { email: "alex@example.com", name: "Alex Rivera", label: "Reporter" },
  { email: "priya@example.com", name: "Priya Shah", label: "Payments" },
  { email: "sam@example.com", name: "Sam Okafor", label: "Payments · Risk" },
  { email: "lee@example.com", name: "Lee Chen", label: "Platform" },
  { email: "jordan@example.com", name: "Jordan Diaz", label: "Risk" },
] as const;

/**
 * Whether to show them. Next inlines NODE_ENV at build time, so in a
 * production build this is constant false and the panel is compiled away.
 */
export const showDevAccount = (): boolean =>
  process.env.NODE_ENV === "development";
