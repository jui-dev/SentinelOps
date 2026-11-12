import { ACTION_AREA } from '../../activity/activity.actions.js';
import { DEV_PERSONAS } from '../dev-account.js';
import { buildDemoActivity } from './demo-activity.js';

const ANCHOR = new Date('2026-11-12T14:00:00.000Z');

describe('buildDemoActivity', () => {
  const entries = buildDemoActivity(ANCHOR);

  it('should cover the last week, oldest first, all before the anchor', () => {
    const times = entries.map((entry) => entry.at.getTime());

    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(Math.max(...times)).toBeLessThan(ANCHOR.getTime());
    expect(Math.min(...times)).toBeGreaterThan(
      ANCHOR.getTime() - 7 * 24 * 60 * 60 * 1000,
    );
  });

  it('should be by and about the demo personas only', () => {
    const emails = new Set(DEV_PERSONAS.map((persona) => persona.email));

    for (const entry of entries) {
      expect(emails.has(entry.actor)).toBe(true);
      if (entry.subject?.kind === 'member') {
        expect(emails.has(entry.subject.email)).toBe(true);
      }
    }
  });

  it('should hold changes in every area it tells of, and sign-ins', () => {
    const areas = new Set(entries.map((entry) => ACTION_AREA[entry.action]));

    expect([...areas].sort()).toEqual([
      'ORGANIZATION',
      'PEOPLE',
      'SECURITY',
      'SERVICES',
      'TEAMS',
    ]);
  });

  it('should end with Sam back to responding, as the organization has them', () => {
    const roles = entries.filter(
      (entry) =>
        entry.action === 'ROLE_CHANGED' &&
        entry.subject?.kind === 'member' &&
        entry.subject.email === 'sam@example.com',
    );

    expect(roles.at(-1)?.changes).toEqual([
      { field: 'role', before: 'INCIDENT_MANAGER', after: 'RESPONDER' },
    ]);
  });

  it('should block Priya after five wrong passwords from a new address, then let Priya in', () => {
    const priya = entries
      .filter((entry) => entry.actor === 'priya@example.com')
      .filter((entry) => entry.at.getTime() > ANCHOR.getTime() - 6 * 3_600_000);

    expect(priya.map((entry) => entry.action)).toEqual([
      'SIGN_IN_FAILED',
      'SIGN_IN_FAILED',
      'SIGN_IN_FAILED',
      'SIGN_IN_FAILED',
      'SIGN_IN_FAILED',
      'SIGN_IN_BLOCKED',
      'SIGNED_IN',
    ]);
    expect(new Set(priya.slice(0, 6).map((entry) => entry.ipAddress))).toEqual(
      new Set(['203.0.113.7']),
    );
    expect(priya.at(-1)?.ipAddress).not.toBe('203.0.113.7');
  });
});
