import { ACTION_AREA, referenceOf } from './activity.actions.js';
import type { ActivityRow } from './activity.responses.js';
import { changesOf, toActivityEntryResponse } from './activity.responses.js';

const ID = '01934f2a-7b1c-7d3e-9f40-a1b2c3d4e5f6';

const row = (overrides: Partial<ActivityRow> = {}): ActivityRow => ({
  id: ID,
  action: 'ROLE_CHANGED',
  area: 'PEOPLE',
  actorId: 'actor-1',
  actorName: 'Dev Admin',
  subjectType: 'MEMBERSHIP',
  subjectId: 'membership-1',
  subjectName: 'Sam Okafor',
  changes: [{ field: 'role', before: 'RESPONDER', after: 'INCIDENT_MANAGER' }],
  ipAddress: '10.0.4.2',
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  createdAt: new Date('2026-11-12T14:32:14.000Z'),
  ...overrides,
});

describe('toActivityEntryResponse', () => {
  it('should say who did what, to what, and from where', () => {
    expect(toActivityEntryResponse(row())).toEqual({
      id: ID,
      reference: 'ACT-C3D4-E5F6',
      action: 'ROLE_CHANGED',
      area: 'PEOPLE',
      occurredAt: '2026-11-12T14:32:14.000Z',
      actor: { id: 'actor-1', name: 'Dev Admin' },
      subject: { type: 'MEMBERSHIP', id: 'membership-1', name: 'Sam Okafor' },
      changes: [
        { field: 'role', before: 'RESPONDER', after: 'INCIDENT_MANAGER' },
      ],
      client: { ipAddress: '10.0.4.2', browser: 'Chrome on Windows' },
    });
  });

  it('should leave out a subject and a client it does not have', () => {
    const response = toActivityEntryResponse(
      row({
        subjectType: null,
        subjectId: null,
        subjectName: null,
        ipAddress: null,
        userAgent: null,
      }),
    );

    expect(response.subject).toBeNull();
    expect(response.client).toBeNull();
  });

  it('should keep an address whose browser is not one anyone would name', () => {
    expect(
      toActivityEntryResponse(row({ userAgent: 'curl/8.4.0' })).client,
    ).toEqual({ ipAddress: '10.0.4.2', browser: null });
  });
});

describe('changesOf', () => {
  it('should keep only well-formed changes, and only their three fields', () => {
    expect(
      changesOf([
        { field: 'name', before: 'Acme', after: 'Acme Payments', extra: 1 },
        { field: 'description', before: null, after: 'Card payments' },
        { field: 'broken', before: 3, after: 'x' },
        'not a change',
        null,
      ]),
    ).toEqual([
      { field: 'name', before: 'Acme', after: 'Acme Payments' },
      { field: 'description', before: null, after: 'Card payments' },
    ]);
  });

  it('should treat anything but a list as no changes', () => {
    expect(changesOf({ field: 'name' })).toEqual([]);
    expect(changesOf(null)).toEqual([]);
  });
});

describe('referenceOf', () => {
  it('should use the last eight hex digits, in two groups', () => {
    expect(referenceOf(ID)).toBe('ACT-C3D4-E5F6');
  });
});

describe('ACTION_AREA', () => {
  it('should keep sign-ins and passwords on the security tab, and nothing else', () => {
    expect(
      Object.entries(ACTION_AREA)
        .filter(([, area]) => area === 'SECURITY')
        .map(([action]) => action),
    ).toEqual([
      'SIGNED_IN',
      'SIGN_IN_FAILED',
      'SIGN_IN_BLOCKED',
      'PASSWORD_CHANGED',
    ]);
  });
});
