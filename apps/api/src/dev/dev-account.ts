/**
 * TEMPORARY — a small, fixed organization for local development: known
 * logins for an Admin, an Incident Manager, a Reporter and four Responders, and the teams and services they work
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

/** One of each role that decides or raises, and four Responders. */
export const DEV_PERSONAS: readonly {
  email: string;
  name: string;
  role: 'ADMIN' | 'INCIDENT_MANAGER' | 'REPORTER' | 'RESPONDER';
  teams: readonly DevTeam[];
}[] = [
  {
    email: 'admin@example.com',
    name: 'Dev Admin',
    role: 'ADMIN',
    teams: [],
  },
  {
    email: 'ava@example.com',
    name: 'Ava Kim',
    role: 'INCIDENT_MANAGER',
    teams: [],
  },
  {
    email: 'alex@example.com',
    name: 'Alex Rivera',
    role: 'REPORTER',
    teams: [],
  },
  {
    email: 'priya@example.com',
    name: 'Priya Shah',
    role: 'RESPONDER',
    teams: ['Payments'],
  },
  {
    email: 'sam@example.com',
    name: 'Sam Okafor',
    role: 'RESPONDER',
    teams: ['Payments', 'Risk'],
  },
  {
    email: 'lee@example.com',
    name: 'Lee Chen',
    role: 'RESPONDER',
    teams: ['Platform'],
  },
  {
    email: 'jordan@example.com',
    name: 'Jordan Diaz',
    role: 'RESPONDER',
    teams: ['Risk'],
  },
];
