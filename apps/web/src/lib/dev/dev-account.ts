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

/**
 * Each persona, their role, and what to say beside them on the login page:
 * where they land and what to try, or a Responder's teams.
 */
export const DEV_PERSONAS = [
  {
    email: "alex@example.com",
    name: "Alex Rivera",
    role: "REPORTER",
    detail: "Lands on My reports · try declaring an incident",
  },
  {
    email: "ava@example.com",
    name: "Ava Kim",
    role: "INCIDENT_MANAGER",
    detail: "Lands on Overview · decides who responds",
  },
  {
    email: "priya@example.com",
    name: "Priya Shah",
    role: "RESPONDER",
    detail: "Payments",
  },
  {
    email: "sam@example.com",
    name: "Sam Okafor",
    role: "RESPONDER",
    detail: "Payments · Risk",
  },
  {
    email: "lee@example.com",
    name: "Lee Chen",
    role: "RESPONDER",
    detail: "Platform",
  },
  {
    email: "jordan@example.com",
    name: "Jordan Diaz",
    role: "RESPONDER",
    detail: "Risk",
  },
  {
    email: "admin@example.com",
    name: "Dev Admin",
    role: "ADMIN",
    detail: "Lands on Overview · sees and sets up everything",
  },
] as const;

/**
 * Whether to show them. Next inlines NODE_ENV at build time, so in a
 * production build this is constant false and the panel is compiled away.
 */
export const showDevAccount = (): boolean =>
  process.env.NODE_ENV === "development";
