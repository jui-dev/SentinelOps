import { toServiceResponse } from './services.responses.js';

const CREATED = new Date('2026-09-18T12:00:00.000Z');
const UPDATED = new Date('2026-09-18T13:00:00.000Z');
const ARCHIVED = new Date('2026-09-18T14:00:00.000Z');

describe('service responses', () => {
  const row = {
    id: 'service-1',
    organizationId: 'org-1',
    ownerTeamId: 'team-1',
    name: 'Payment API',
    slug: 'payment-api',
    description: null,
    criticality: 'CRITICAL' as const,
    archivedAt: null,
    createdAt: CREATED,
    updatedAt: UPDATED,
    ownerTeam: {
      id: 'team-1',
      name: 'Payments',
      slug: 'payments',
      organizationId: 'org-1',
      description: 'Owns payments.',
    },
  };

  it('should emit exactly the declared fields, including on the nested owner', () => {
    expect(toServiceResponse(row)).toStrictEqual({
      id: 'service-1',
      name: 'Payment API',
      slug: 'payment-api',
      description: null,
      criticality: 'CRITICAL',
      ownerTeam: { id: 'team-1', name: 'Payments', slug: 'payments' },
      archivedAt: null,
      createdAt: '2026-09-18T12:00:00.000Z',
      updatedAt: '2026-09-18T13:00:00.000Z',
    });
  });

  it('should emit when an archived service was archived', () => {
    expect(toServiceResponse({ ...row, archivedAt: ARCHIVED }).archivedAt).toBe(
      '2026-09-18T14:00:00.000Z',
    );
  });
});
