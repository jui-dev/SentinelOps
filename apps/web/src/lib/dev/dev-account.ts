import { useQuery } from "@tanstack/react-query";

import { getDemoAvailability } from "@/lib/api/endpoints";

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
 * Each persona and their role, in the order an incident needs them; a
 * Responder also with the teams they respond for.
 */
export const DEV_PERSONAS = [
  {
    email: "alex@example.com",
    name: "Alex Rivera",
    role: "REPORTER",
  },
  {
    email: "ava@example.com",
    name: "Ava Kim",
    role: "INCIDENT_MANAGER",
  },
  {
    email: "priya@example.com",
    name: "Priya Shah",
    role: "RESPONDER",
    teams: ["Payments"],
  },
  {
    email: "sam@example.com",
    name: "Sam Okafor",
    role: "RESPONDER",
    teams: ["Payments", "Risk"],
  },
  {
    email: "lee@example.com",
    name: "Lee Chen",
    role: "RESPONDER",
    teams: ["Platform"],
  },
  {
    email: "jordan@example.com",
    name: "Jordan Diaz",
    role: "RESPONDER",
    teams: ["Risk"],
  },
  {
    email: "admin@example.com",
    name: "Dev Admin",
    role: "ADMIN",
  },
] as const;

/**
 * Whether to show them. Next inlines NODE_ENV at build time, so in a
 * production build this is constant false and the panel is compiled away.
 */
/**
 * Whether the login page offers the demo accounts: in development, and only
 * while the API says this machine has a demo organization — so a database
 * without one, or a removed one, offers no accounts that lead nowhere.
 */
export const useDemoAvailable = (): boolean => {
  const offered = showDevAccount();
  const availability = useQuery({
    queryKey: ["demo-availability"],
    queryFn: getDemoAvailability,
    enabled: offered,
    retry: false,
  });

  return offered && availability.data?.available === true;
};

export const showDevAccount = (): boolean =>
  process.env.NODE_ENV === "development";
