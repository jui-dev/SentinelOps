import { startIncidentAnalysisSchema } from './incident-analyses.schemas.js';

const MEMBERSHIP_ID = '0199a1b2-c3d4-7000-8000-0000000000aa';

describe('startIncidentAnalysisSchema', () => {
  it('should accept no body, and an empty one', () => {
    expect(startIncidentAnalysisSchema.safeParse(undefined).success).toBe(true);
    expect(startIncidentAnalysisSchema.safeParse({}).success).toBe(true);
  });

  it('should accept an owner named by membership id', () => {
    expect(
      startIncidentAnalysisSchema.parse({ ownerMembershipId: MEMBERSHIP_ID }),
    ).toEqual({ ownerMembershipId: MEMBERSHIP_ID });
  });

  it('should refuse an owner that is not a resource id', () => {
    expect(
      startIncidentAnalysisSchema.safeParse({ ownerMembershipId: 'dave' })
        .success,
    ).toBe(false);
  });

  it('should refuse anything the server decides', () => {
    for (const key of [
      'organizationId',
      'incidentId',
      'status',
      'version',
      'createdById',
      'summary',
    ]) {
      expect(
        startIncidentAnalysisSchema.safeParse({ [key]: MEMBERSHIP_ID }).success,
      ).toBe(false);
    }
  });
});
