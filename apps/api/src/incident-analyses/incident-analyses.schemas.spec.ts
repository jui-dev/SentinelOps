import {
  editIncidentAnalysisSchema,
  startIncidentAnalysisSchema,
} from './incident-analyses.schemas.js';

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

describe('editIncidentAnalysisSchema', () => {
  const parse = (body: unknown) => editIncidentAnalysisSchema.safeParse(body);

  it('should take the version and the named sections, leaving the rest out', () => {
    expect(
      editIncidentAnalysisSchema.parse({ version: 3, cause: 'Expired cert.' }),
    ).toEqual({ version: 3, cause: 'Expired cert.' });
  });

  it('should require a positive integer version within the column', () => {
    for (const version of [undefined, 0, -1, 1.5, '2', 2_147_483_648]) {
      expect(parse({ version, summary: 'Summary' }).success).toBe(false);
    }

    expect(parse({ version: 2_147_483_647, summary: 'Summary' }).success).toBe(
      true,
    );
  });

  it('should require at least one section', () => {
    expect(parse({ version: 1 }).success).toBe(false);
  });

  it('should trim a section, store blank as null, and take null as clearing it', () => {
    expect(
      editIncidentAnalysisSchema.parse({
        version: 1,
        summary: '  Card payments failed.  ',
        impact: '   ',
        cause: '',
        lessons: null,
      }),
    ).toEqual({
      version: 1,
      summary: 'Card payments failed.',
      impact: null,
      cause: null,
      lessons: null,
    });
  });

  it('should hold a section to 4000 characters after trimming', () => {
    expect(parse({ version: 1, lessons: 'x'.repeat(4000) }).success).toBe(true);
    expect(
      parse({ version: 1, lessons: ` ${'x'.repeat(4000)} ` }).success,
    ).toBe(true);
    expect(parse({ version: 1, lessons: 'x'.repeat(4001) }).success).toBe(
      false,
    );
  });

  it('should refuse anything but a section and the version', () => {
    for (const key of [
      'status',
      'ownerMembershipId',
      'publishedAt',
      'publishedById',
      'organizationId',
      'incidentId',
      'createdById',
    ]) {
      expect(
        parse({ version: 1, summary: 'Summary', [key]: 'x' }).success,
      ).toBe(false);
    }
  });

  it('should refuse a section that is not text', () => {
    expect(parse({ version: 1, summary: 42 }).success).toBe(false);
  });
});
