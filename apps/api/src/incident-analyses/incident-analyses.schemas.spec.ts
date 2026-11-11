import {
  editIncidentAnalysisSchema,
  publishIncidentAnalysisSchema,
  reassignIncidentAnalysisOwnerSchema,
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

  it('should take sections to mark done or reopen, alone or with text', () => {
    expect(parse({ version: 1, markDone: ['summary'] }).success).toBe(true);
    expect(parse({ version: 1, reopen: ['cause'] }).success).toBe(true);
    expect(
      parse({ version: 1, impact: 'Everyone.', markDone: ['impact'] }).success,
    ).toBe(true);
  });

  it('should refuse marks that say nothing, or contradict themselves', () => {
    expect(parse({ version: 1, markDone: [] }).success).toBe(false);
    expect(parse({ version: 1, markDone: ['title'] }).success).toBe(false);
    expect(parse({ version: 1, markDone: ['cause', 'cause'] }).success).toBe(
      false,
    );
    expect(
      parse({ version: 1, markDone: ['cause'], reopen: ['cause'] }).success,
    ).toBe(false);
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

describe('reassignIncidentAnalysisOwnerSchema', () => {
  const parse = (body: unknown) =>
    reassignIncidentAnalysisOwnerSchema.safeParse(body);

  it('should take the new owner and the version', () => {
    expect(
      reassignIncidentAnalysisOwnerSchema.parse({
        ownerMembershipId: MEMBERSHIP_ID,
        version: 4,
      }),
    ).toEqual({ ownerMembershipId: MEMBERSHIP_ID, version: 4 });
  });

  it('should require both', () => {
    expect(parse({ ownerMembershipId: MEMBERSHIP_ID }).success).toBe(false);
    expect(parse({ version: 1 }).success).toBe(false);
  });

  it('should refuse an owner that is not a resource id, or null', () => {
    for (const ownerMembershipId of ['dave', null, '']) {
      expect(parse({ ownerMembershipId, version: 1 }).success).toBe(false);
    }
  });

  it('should require a positive integer version within the column', () => {
    for (const version of [0, -1, 1.5, '2', 2_147_483_648]) {
      expect(parse({ ownerMembershipId: MEMBERSHIP_ID, version }).success).toBe(
        false,
      );
    }
  });

  it('should refuse anything else, sections included', () => {
    for (const key of ['summary', 'status', 'createdById', 'organizationId']) {
      expect(
        parse({ ownerMembershipId: MEMBERSHIP_ID, version: 1, [key]: 'x' })
          .success,
      ).toBe(false);
    }
  });
});

describe('publishIncidentAnalysisSchema', () => {
  const parse = (body: unknown) =>
    publishIncidentAnalysisSchema.safeParse(body);

  it('should take the version, and nothing else', () => {
    expect(publishIncidentAnalysisSchema.parse({ version: 3 })).toEqual({
      version: 3,
    });
  });

  it('should require a positive integer version within the column', () => {
    for (const version of [undefined, 0, -1, 1.5, '2', 2_147_483_648]) {
      expect(parse({ version }).success).toBe(false);
    }
  });

  it('should refuse a section, a status, or attribution alongside it', () => {
    for (const key of [
      'summary',
      'status',
      'publishedAt',
      'publishedById',
      'ownerMembershipId',
    ]) {
      expect(parse({ version: 1, [key]: 'x' }).success).toBe(false);
    }
  });
});
