/**
 * TEMPORARY — the demo's activity log: a week of setup changes and sign-ins
 * for the development organization, written by DemoHistoryService beside the
 * incidents. Pure, so the story is tested without a database.
 *
 * Told about the people, teams and services dev-account.ts sets up, and
 * ending where they are now: Jordan joined Risk this week, Sam covered as an
 * Incident Manager for a few days and went back to responding, Lee forgot a
 * password and was given a new one, and this morning someone tried Priya's
 * password from an address never used before, until sign-ins were blocked.
 */
import type {
  ActivityAction,
  ActivityChange,
} from '../../activity/activity.contract.js';
import { DEV_ORGANIZATION } from '../dev-account.js';

export type DemoSubject =
  | { kind: 'member'; email: string }
  | { kind: 'team'; name: string }
  | { kind: 'service'; name: string }
  | { kind: 'organization' };

export interface DemoActivityEntry {
  at: Date;
  action: ActivityAction;
  /** Who did it, by persona email; for a sign-in, whose account. */
  actor: string;
  subject: DemoSubject | null;
  changes: ActivityChange[];
  ipAddress: string;
  userAgent: string;
}

const CHROME_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const SAFARI_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
const EDGE_WINDOWS = `${CHROME_WINDOWS} Edg/130.0.0.0`;
const FIREFOX_LINUX =
  'Mozilla/5.0 (X11; Linux x86_64; rv:132.0) Gecko/20100101 Firefox/132.0';

/** Where each persona usually signs in from. */
const USUAL: Record<string, { ipAddress: string; userAgent: string }> = {
  'admin@example.com': { ipAddress: '10.0.4.2', userAgent: CHROME_WINDOWS },
  'ava@example.com': { ipAddress: '10.0.4.9', userAgent: SAFARI_MAC },
  'alex@example.com': { ipAddress: '10.0.4.11', userAgent: CHROME_WINDOWS },
  'priya@example.com': { ipAddress: '10.0.4.15', userAgent: CHROME_WINDOWS },
  'sam@example.com': { ipAddress: '10.0.4.12', userAgent: CHROME_WINDOWS },
  'lee@example.com': { ipAddress: '10.0.4.20', userAgent: SAFARI_MAC },
  'jordan@example.com': { ipAddress: '10.0.4.31', userAgent: EDGE_WINDOWS },
};

/** Someone who is not Priya, trying Priya's password. */
const STRANGER = { ipAddress: '203.0.113.7', userAgent: FIREFOX_LINUX };

const ADMIN = 'admin@example.com';
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/**
 * The demo's activity log, oldest first, every entry before `anchor`.
 * Times are counted back from the anchor, so the week always ends now.
 */
export const buildDemoActivity = (anchor: Date): DemoActivityEntry[] => {
  const entries: DemoActivityEntry[] = [];
  const at = (daysAgo: number, minutesAgo = 0) =>
    new Date(anchor.getTime() - daysAgo * DAY - minutesAgo * MINUTE);

  const change = (
    when: Date,
    action: ActivityAction,
    subject: DemoSubject | null,
    changes: ActivityChange[] = [],
    actor = ADMIN,
  ) =>
    entries.push({
      at: when,
      action,
      actor,
      subject,
      changes,
      ...USUAL[actor]!,
    });

  const signIn = (
    when: Date,
    email: string,
    action: ActivityAction = 'SIGNED_IN',
    changes: ActivityChange[] = [],
    from = USUAL[email]!,
  ) =>
    entries.push({
      at: when,
      action,
      actor: email,
      subject: { kind: 'member', email },
      changes,
      ...from,
    });

  // Everyone signs in on working days; the Admin first.
  for (const daysAgo of [6, 5, 4, 3, 2, 1, 0]) {
    const start = daysAgo === 0 ? 300 : 9 * 60;

    Object.keys(USUAL).forEach((email, index) => {
      // Jordan joins on day 5; Lee is locked out until the reset on day 2.
      if (email === 'jordan@example.com' && daysAgo > 5) return;
      if (email === 'jordan@example.com' && daysAgo === 5) return;
      if (email === 'lee@example.com' && (daysAgo === 3 || daysAgo === 2))
        return;
      if (email === 'priya@example.com' && daysAgo === 0) return;

      signIn(at(daysAgo, start - index * 7), email);
    });
  }

  // Day 6: the organization takes its name, and payments become critical.
  change(at(6, 30), 'ORGANIZATION_UPDATED', { kind: 'organization' }, [
    { field: 'name', before: 'Acme Payments', after: DEV_ORGANIZATION.name },
  ]);
  change(
    at(6, 20),
    'SERVICE_UPDATED',
    { kind: 'service', name: 'Payment API' },
    [{ field: 'criticality', before: 'HIGH', after: 'CRITICAL' }],
  );

  // Day 5: Jordan joins, on Risk, and signs in for the first time.
  change(
    at(5, 240),
    'MEMBER_ADDED',
    { kind: 'member', email: 'jordan@example.com' },
    [
      { field: 'email', before: null, after: 'jordan@example.com' },
      { field: 'role', before: null, after: 'RESPONDER' },
      { field: 'teams', before: null, after: 'Risk' },
    ],
  );
  change(at(5, 238), 'TEAM_MEMBER_ADDED', { kind: 'team', name: 'Risk' }, [
    { field: 'member', before: null, after: 'Jordan Diaz' },
  ]);
  signIn(at(5, 200), 'jordan@example.com', 'SIGNED_IN', [
    { field: 'with', before: null, after: 'ONE_TIME_PASSWORD' },
  ]);
  signIn(at(5, 198), 'jordan@example.com', 'PASSWORD_CHANGED', [
    { field: 'replaced', before: null, after: 'ONE_TIME_PASSWORD' },
  ]);

  // Day 4: fraud scoring is raised to high.
  change(
    at(4, 100),
    'SERVICE_UPDATED',
    { kind: 'service', name: 'Fraud Detection' },
    [{ field: 'criticality', before: 'NORMAL', after: 'HIGH' }],
  );

  // Day 3: Sam covers as an Incident Manager, and joins Risk.
  change(
    at(3, 300),
    'ROLE_CHANGED',
    { kind: 'member', email: 'sam@example.com' },
    [{ field: 'role', before: 'RESPONDER', after: 'INCIDENT_MANAGER' }],
  );
  change(at(3, 290), 'TEAM_MEMBER_ADDED', { kind: 'team', name: 'Risk' }, [
    { field: 'member', before: null, after: 'Sam Okafor' },
  ]);

  // Day 2: Lee has forgotten their password and is given a new one.
  change(at(2, 200), 'PASSWORD_RESET', {
    kind: 'member',
    email: 'lee@example.com',
  });
  signIn(at(2, 150), 'lee@example.com', 'SIGNED_IN', [
    { field: 'with', before: null, after: 'ONE_TIME_PASSWORD' },
  ]);
  signIn(at(2, 148), 'lee@example.com', 'PASSWORD_CHANGED', [
    { field: 'replaced', before: null, after: 'ONE_TIME_PASSWORD' },
  ]);

  // Day 1: Sam's cover ends.
  change(
    at(1, 60),
    'ROLE_CHANGED',
    { kind: 'member', email: 'sam@example.com' },
    [{ field: 'role', before: 'INCIDENT_MANAGER', after: 'RESPONDER' }],
  );

  // This morning: five wrong passwords for Priya from somewhere new, the
  // block, and Priya signing in as usual once it lifted.
  for (const minutesAgo of [250, 249, 248, 247, 246]) {
    signIn(
      at(0, minutesAgo),
      'priya@example.com',
      'SIGN_IN_FAILED',
      [],
      STRANGER,
    );
  }
  signIn(
    at(0, 245.9),
    'priya@example.com',
    'SIGN_IN_BLOCKED',
    [
      {
        field: 'blockedUntil',
        before: null,
        after: at(0, 230.9).toISOString(),
      },
    ],
    STRANGER,
  );
  signIn(at(0, 200), 'priya@example.com');

  return entries.sort((a, b) => a.at.getTime() - b.at.getTime());
};
