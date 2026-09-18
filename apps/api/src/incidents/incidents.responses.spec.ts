import { toIncidentResponse } from './incidents.responses.js';

const CREATED = new Date('2026-09-18T12:00:00.000Z');
const UPDATED = new Date('2026-09-18T12:30:00.000Z');
const RESOLVED = new Date('2026-09-18T13:00:00.000Z');

describe('incident responses', () => {
  // Carries columns a careless mapper might spread: the organization, the
  // raw foreign keys, the declarer's email and soft-deletion mark.
  const row = {
    id: 'incident-1',
    organizationId: 'org-1',
    number: 42,
    title: 'Card payments failing',
    summary: null,
    serviceId: 'service-1',
    teamId: 'team-1',
    createdById: 'user-1',
    severity: 'SEV1' as const,
    status: 'RESOLVED' as const,
    createdAt: CREATED,
    updatedAt: UPDATED,
    resolvedAt: RESOLVED,
    service: {
      id: 'service-1',
      name: 'Payment API',
      slug: 'payment-api',
      criticality: 'CRITICAL' as const,
      archivedAt: null,
      ownerTeamId: 'team-2',
    },
    team: {
      id: 'team-1',
      name: 'Payments',
      slug: 'payments',
      organizationId: 'org-1',
    },
    createdBy: {
      id: 'user-1',
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      deletedAt: new Date(),
    },
  };

  it('should emit exactly the declared fields, identity only on embedded records', () => {
    expect(toIncidentResponse(row)).toStrictEqual({
      id: 'incident-1',
      number: 42,
      title: 'Card payments failing',
      summary: null,
      severity: 'SEV1',
      status: 'RESOLVED',
      service: {
        id: 'service-1',
        name: 'Payment API',
        slug: 'payment-api',
        criticality: 'CRITICAL',
        archivedAt: null,
      },
      team: { id: 'team-1', name: 'Payments', slug: 'payments' },
      createdBy: { id: 'user-1', name: 'Ada Lovelace' },
      createdAt: '2026-09-18T12:00:00.000Z',
      updatedAt: '2026-09-18T12:30:00.000Z',
      resolvedAt: '2026-09-18T13:00:00.000Z',
    });
  });

  it('should emit null for an unresolved incident', () => {
    expect(
      toIncidentResponse({ ...row, status: 'MONITORING', resolvedAt: null })
        .resolvedAt,
    ).toBeNull();
  });
});
