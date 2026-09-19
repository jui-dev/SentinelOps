/**
 * TEMPORARY — a small, fixed organization for local development: known
 * logins for one Admin and four Members, and the teams and services they work
 * in. It exists only when the API runs with NODE_ENV=development;
 * DevAccountService ensures it at boot and nothing else reads these values.
 *
 * To remove it: delete this folder (src/dev/), its registration in
 * app.module.ts, apps/web/src/lib/dev/, and the panel in the web login form.
 *
 * `example.com` is reserved (RFC 2606), so no address can belong to anyone
 * real. Every persona shares one password: this is a convenience for
 * switching between them, not an account anyone owns.
 */
export const DEV_PASSWORD = 'dev-password-123';

export const DEV_ORGANIZATION = {
  name: 'AcmePay',
  slug: 'sentinelops-dev',
} as const;

export const DEV_TEAMS = ['Payments', 'Platform', 'Risk'] as const;

export type DevTeam = (typeof DEV_TEAMS)[number];

export const DEV_SERVICES: readonly {
  name: string;
  ownerTeam: DevTeam;
  criticality: 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';
}[] = [
  { name: 'Payment API', ownerTeam: 'Payments', criticality: 'CRITICAL' },
  { name: 'Authentication', ownerTeam: 'Platform', criticality: 'HIGH' },
  { name: 'Fraud Detection', ownerTeam: 'Risk', criticality: 'HIGH' },
];

/** Exactly one ADMIN, as in any organization; everyone else is a MEMBER. */
export const DEV_PERSONAS: readonly {
  email: string;
  name: string;
  role: 'ADMIN' | 'MEMBER';
  teams: readonly DevTeam[];
}[] = [
  { email: 'admin@example.com', name: 'Dev Admin', role: 'ADMIN', teams: [] },
  {
    email: 'priya@example.com',
    name: 'Priya Shah',
    role: 'MEMBER',
    teams: ['Payments'],
  },
  {
    email: 'sam@example.com',
    name: 'Sam Okafor',
    role: 'MEMBER',
    teams: ['Payments', 'Risk'],
  },
  {
    email: 'lee@example.com',
    name: 'Lee Chen',
    role: 'MEMBER',
    teams: ['Platform'],
  },
  {
    email: 'jordan@example.com',
    name: 'Jordan Diaz',
    role: 'MEMBER',
    teams: ['Risk'],
  },
];
