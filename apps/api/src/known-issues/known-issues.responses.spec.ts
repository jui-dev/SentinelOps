import type { KnownIssueResponse } from './known-issues.contract.js';
import {
  byFrequency,
  NO_OCCURRENCES,
  toKnownIssueResponse,
} from './known-issues.responses.js';
import {
  createKnownIssueSchema,
  updateKnownIssueSchema,
} from './known-issues.schemas.js';
import { createIncidentSchema } from '../incidents/incidents.schemas.js';

const SERVICE = '0199a1b2-c3d4-7000-8000-0000000000d1';
const KNOWN = '0199a1b2-c3d4-7000-8000-0000000000e1';

const row = {
  id: KNOWN,
  name: 'Card payments failing at checkout',
  description: null,
  usualSeverity: 'SEV1' as const,
  pendingReview: true,
  archivedAt: null,
  createdAt: new Date('2026-09-18T12:00:00.000Z'),
  organizationId: 'never sent',
  service: {
    id: SERVICE,
    name: 'Payment API',
    slug: 'payment-api',
    criticality: 'CRITICAL',
    ownerTeam: {
      id: 'team-1',
      name: 'Payments',
      slug: 'payments',
      organizationId: 'x',
    },
  },
};

const issue = (
  name: string,
  total: number,
  lastAt: string | null,
): KnownIssueResponse => ({
  ...toKnownIssueResponse({ ...row, id: name, name }, NO_OCCURRENCES),
  occurrences: { total, lastAt, active: null },
});

describe('known issue responses', () => {
  it('should emit exactly the declared fields, with its occurrences', () => {
    expect(
      toKnownIssueResponse(row, {
        total: 4,
        lastAt: new Date('2026-10-30T09:00:00.000Z'),
        active: 82,
      }),
    ).toStrictEqual({
      id: KNOWN,
      name: 'Card payments failing at checkout',
      description: null,
      usualSeverity: 'SEV1',
      service: {
        id: SERVICE,
        name: 'Payment API',
        slug: 'payment-api',
        team: { id: 'team-1', name: 'Payments', slug: 'payments' },
      },
      pendingReview: true,
      archivedAt: null,
      occurrences: { total: 4, lastAt: '2026-10-30T09:00:00.000Z', active: 82 },
      createdAt: '2026-09-18T12:00:00.000Z',
    });
  });

  it('should offer the most frequent first, then the most recent, then by name', () => {
    const list = [
      issue('Never yet', 0, null),
      issue('Twice, long ago', 2, '2026-01-01T00:00:00.000Z'),
      issue('Twice, lately', 2, '2026-10-01T00:00:00.000Z'),
      issue('Four times', 4, '2026-03-01T00:00:00.000Z'),
      issue('Also never', 0, null),
    ].sort(byFrequency);

    expect(list.map(({ name }) => name)).toEqual([
      'Four times',
      'Twice, lately',
      'Twice, long ago',
      'Also never',
      'Never yet',
    ]);
  });
});

describe('known issue requests', () => {
  it('should store a blank description as none', () => {
    expect(
      createKnownIssueSchema.parse({
        serviceId: SERVICE,
        name: '  Webhooks delayed ',
        description: '   ',
        usualSeverity: 'SEV3',
      }),
    ).toEqual({
      serviceId: SERVICE,
      name: 'Webhooks delayed',
      description: null,
      usualSeverity: 'SEV3',
    });
  });

  it('should refuse an empty change, and accept keeping one as it is', () => {
    expect(updateKnownIssueSchema.safeParse({}).success).toBe(false);
    expect(updateKnownIssueSchema.safeParse({ reviewed: true }).success).toBe(
      true,
    );
    expect(updateKnownIssueSchema.safeParse({ reviewed: false }).success).toBe(
      false,
    );
  });

  it('should let a declaration choose a known issue or save a new one, never both', () => {
    const base = {
      title: 'Payments failing',
      serviceId: SERVICE,
      severity: 'SEV1',
    };

    expect(
      createIncidentSchema.safeParse({ ...base, knownIssueId: KNOWN }).success,
    ).toBe(true);
    expect(
      createIncidentSchema.safeParse({ ...base, saveAsKnownIssue: true })
        .success,
    ).toBe(true);
    expect(
      createIncidentSchema.safeParse({
        ...base,
        knownIssueId: KNOWN,
        saveAsKnownIssue: true,
      }).success,
    ).toBe(false);
  });
});
