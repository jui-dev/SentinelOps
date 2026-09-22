import { toIncidentAnalysisResponse } from './incident-analyses.responses.js';
import type { IncidentAnalysisRow } from './incident-analyses.responses.js';

const AT = new Date('2026-09-10T09:00:00.000Z');
const LATER = new Date('2026-09-10T11:00:00.000Z');

/** A row carrying keys the response must never emit, as a Prisma row might. */
const row = {
  id: 'analysis-1',
  organizationId: 'org-1',
  incidentId: 'incident-1',
  ownerMembershipId: 'membership-1',
  createdById: 'user-1',
  publishedById: null,
  status: 'DRAFT',
  version: 3,
  summary: 'Card payments failed for 2 hours.',
  impact: null,
  cause: null,
  lessons: null,
  createdAt: AT,
  updatedAt: LATER,
  publishedAt: null,
  owner: { id: 'membership-1', user: { name: 'Dave Duarte' } },
  createdBy: { id: 'user-1', name: 'Alice Anders' },
  publishedBy: null,
} satisfies IncidentAnalysisRow & Record<string, unknown>;

const derived = {
  facts: {
    declaredAt: AT,
    resolvedAt: LATER,
    firstResponseAt: null,
    responderCount: 0,
    updateCount: 1,
    severity: { declared: 'SEV3', highest: 'SEV1', final: 'SEV2' },
    reassignmentCount: 0,
  },
  keyMoments: [
    {
      kind: 'DECLARED',
      activityId: 'activity-1',
      at: AT,
      actor: { id: 'user-1', name: 'Alice Anders' },
      fromValue: null,
      toValue: 'SEV3',
    },
  ],
} as const;

describe('toIncidentAnalysisResponse', () => {
  it('should emit exactly the contract, in ISO time, and none of the row’s own keys', () => {
    expect(
      toIncidentAnalysisResponse(row, {
        facts: { ...derived.facts, severity: { ...derived.facts.severity } },
        keyMoments: derived.keyMoments.map((moment) => ({ ...moment })),
      }),
    ).toStrictEqual({
      status: 'DRAFT',
      version: 3,
      owner: { membershipId: 'membership-1', name: 'Dave Duarte' },
      summary: 'Card payments failed for 2 hours.',
      impact: null,
      cause: null,
      lessons: null,
      createdBy: { id: 'user-1', name: 'Alice Anders' },
      createdAt: '2026-09-10T09:00:00.000Z',
      publishedBy: null,
      publishedAt: null,
      updatedAt: '2026-09-10T11:00:00.000Z',
      facts: {
        declaredAt: '2026-09-10T09:00:00.000Z',
        resolvedAt: '2026-09-10T11:00:00.000Z',
        firstResponseAt: null,
        responderCount: 0,
        updateCount: 1,
        severity: { declared: 'SEV3', highest: 'SEV1', final: 'SEV2' },
        reassignmentCount: 0,
      },
      keyMoments: [
        {
          kind: 'DECLARED',
          activityId: 'activity-1',
          at: '2026-09-10T09:00:00.000Z',
          actor: { id: 'user-1', name: 'Alice Anders' },
          fromValue: null,
          toValue: 'SEV3',
        },
      ],
    });
  });

  it('should name who published it, and when, once published', () => {
    const response = toIncidentAnalysisResponse(
      {
        ...row,
        status: 'PUBLISHED',
        publishedAt: LATER,
        publishedBy: { id: 'user-2', name: 'Carol Chen' },
      },
      {
        facts: { ...derived.facts, severity: { ...derived.facts.severity } },
        keyMoments: [],
      },
    );

    expect(response.publishedBy).toEqual({ id: 'user-2', name: 'Carol Chen' });
    expect(response.publishedAt).toBe('2026-09-10T11:00:00.000Z');
  });
});
