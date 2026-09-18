import {
  createIncidentSchema,
  listIncidentsQuerySchema,
  parseIncidentNumber,
  postIncidentUpdateSchema,
  updateIncidentSchema,
} from './incidents.schemas.js';

const SERVICE = '0199a1b2-c3d4-7000-8000-0000000000d1';
const TEAM = '0199a1b2-c3d4-7000-8000-0000000000c1';

const valid = {
  title: 'Card payments failing',
  serviceId: SERVICE,
  severity: 'SEV1',
};

describe('incident schemas', () => {
  describe('createIncidentSchema', () => {
    it('should accept a declaration and trim its prose', () => {
      expect(
        createIncidentSchema.parse({
          ...valid,
          title: '  Card payments failing  ',
          summary: '  Card declines since 14:02  ',
        }),
      ).toEqual({
        ...valid,
        summary: 'Card declines since 14:02',
      });
    });

    it.each(['', '   '])(
      'should normalise the blank summary %j to null',
      (summary) => {
        expect(
          createIncidentSchema.parse({ ...valid, summary }).summary,
        ).toBeNull();
      },
    );

    it('should require a severity: there is no default', () => {
      const { severity: _omitted, ...body } = valid;

      expect(createIncidentSchema.safeParse(body).success).toBe(false);
    });

    it.each([
      ['a blank title', { title: '  ' }],
      ['a title over 200 characters', { title: 'x'.repeat(201) }],
      ['a summary over 2000 characters', { summary: 'x'.repeat(2001) }],
      ['a malformed service id', { serviceId: 'payment-api' }],
      ['a severity outside the four levels', { severity: 'SEV0' }],
      ['a criticality word as severity', { severity: 'CRITICAL' }],
    ])('should refuse %s', (_case, change) => {
      expect(
        createIncidentSchema.safeParse({ ...valid, ...change }).success,
      ).toBe(false);
    });

    it.each([
      { status: 'IDENTIFIED' },
      { teamId: TEAM },
      { organizationId: SERVICE },
      { number: 7 },
      { createdById: SERVICE },
      { resolvedAt: '2026-09-18T00:00:00.000Z' },
      { id: SERVICE },
    ])('should refuse the key in %o: the server decides it', (extra) => {
      expect(
        createIncidentSchema.safeParse({ ...valid, ...extra }).success,
      ).toBe(false);
    });
  });

  describe('updateIncidentSchema', () => {
    it.each([
      { title: 'Card payments degraded' },
      { summary: null },
      { severity: 'SEV2' },
      { status: 'MONITORING' },
      { status: 'INVESTIGATING' },
      { status: 'RESOLVED' },
      { teamId: TEAM },
      { leadMembershipId: TEAM },
      { leadMembershipId: null },
    ])('should accept %o alone', (body) => {
      expect(updateIncidentSchema.safeParse(body).success).toBe(true);
    });

    it('should refuse an empty change', () => {
      expect(updateIncidentSchema.safeParse({}).success).toBe(false);
    });

    it('should refuse clearing the responsible team', () => {
      expect(updateIncidentSchema.safeParse({ teamId: null }).success).toBe(
        false,
      );
    });

    it.each([
      { serviceId: SERVICE },
      { resolvedAt: '2026-09-18T00:00:00.000Z' },
      { number: 2 },
      { organizationId: SERVICE },
      { status: 'OPEN' },
      { leadMembershipId: 'not-a-uuid' },
      { responders: [TEAM] },
    ])('should refuse %o', (body) => {
      expect(
        updateIncidentSchema.safeParse({ title: 'x', ...body }).success,
      ).toBe(false);
    });
  });

  describe('listIncidentsQuerySchema', () => {
    it('should require a state', () => {
      expect(listIncidentsQuerySchema.safeParse({}).success).toBe(false);
      expect(
        listIncidentsQuerySchema.safeParse({ state: 'open' }).success,
      ).toBe(false);
    });

    it('should accept either state, with or without a cursor', () => {
      expect(listIncidentsQuerySchema.parse({ state: 'active' })).toEqual({
        state: 'active',
      });
      expect(
        listIncidentsQuerySchema.parse({ state: 'resolved', cursor: '41' }),
      ).toEqual({ state: 'resolved', cursor: '41' });
    });
  });

  describe('postIncidentUpdateSchema', () => {
    it('should accept a message and trim it', () => {
      expect(
        postIncidentUpdateSchema.parse({
          message: '  Rolled back the latest deployment.  ',
        }),
      ).toEqual({ message: 'Rolled back the latest deployment.' });
    });

    it.each([
      ['a blank message', { message: '   ' }],
      ['an overlong message', { message: 'x'.repeat(2001) }],
      ['no message', {}],
      ['an actor', { message: 'x', actorId: TEAM }],
      ['a type', { message: 'x', type: 'STATUS_CHANGED' }],
    ])('should refuse %s', (_, body) => {
      expect(postIncidentUpdateSchema.safeParse(body).success).toBe(false);
    });
  });

  describe('parseIncidentNumber', () => {
    it.each([
      ['1', 1],
      ['42', 42],
      ['2147483647', 2_147_483_647],
    ])('should read %j as %d', (value, expected) => {
      expect(parseIncidentNumber(value)).toBe(expected);
    });

    it.each([
      '0',
      '-1',
      '01',
      '1.5',
      '1e3',
      ' 1',
      'abc',
      '',
      '2147483648',
      '99999999999',
    ])('should refuse %j', (value) => {
      expect(parseIncidentNumber(value)).toBeUndefined();
    });
  });
});
