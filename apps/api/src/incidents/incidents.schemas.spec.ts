import {
  createIncidentSchema,
  incidentActivityQuerySchema,
  incidentSummaryQuerySchema,
  listIncidentsQuerySchema,
  parseIncidentNumber,
  postIncidentUpdateSchema,
  searchedIncidentNumber,
  summaryBounds,
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
      { status: 'DECLARED' },
      { status: 'INVESTIGATING' },
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
      { teamId: TEAM },
    ])('should accept %o alone', (body) => {
      expect(updateIncidentSchema.safeParse(body).success).toBe(true);
    });

    it('should accept a resolution with its note, trimmed', () => {
      expect(
        updateIncidentSchema.parse({
          status: 'RESOLVED',
          resolution: '  Rolled back the 14:00 deploy.  ',
        }),
      ).toEqual({
        status: 'RESOLVED',
        resolution: 'Rolled back the 14:00 deploy.',
      });
    });

    it.each([
      ['no note', {}],
      ['a blank note', { resolution: '   ' }],
      ['a note over 2000 characters', { resolution: 'x'.repeat(2001) }],
      ['a null note', { resolution: null }],
    ])('should refuse resolving with %s', (_case, note) => {
      const result = updateIncidentSchema.safeParse({
        status: 'RESOLVED',
        ...note,
      });

      expect(result.success).toBe(false);
      expect(result.error?.issues.map((issue) => issue.path)).toContainEqual([
        'resolution',
      ]);
    });

    it.each([
      { resolution: 'Rolled back.' },
      { title: 'Card payments degraded', resolution: 'Rolled back.' },
    ])('should refuse a note without resolving: %o', (body) => {
      const result = updateIncidentSchema.safeParse(body);

      expect(result.success).toBe(false);
      expect(result.error?.issues.map((issue) => issue.path)).toContainEqual([
        'resolution',
      ]);
    });

    it('should refuse an empty change', () => {
      expect(updateIncidentSchema.safeParse({}).success).toBe(false);
    });

    // INVESTIGATING included: an incident becomes INVESTIGATING only when a
    // responder starts investigating it, never by a change.
    it.each(['DECLARED', 'INVESTIGATING', 'IDENTIFIED', 'MONITORING', 'OPEN'])(
      'should refuse moving to %j: only RESOLVED is a move',
      (status) => {
        expect(updateIncidentSchema.safeParse({ status }).success).toBe(false);
      },
    );

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
      // Lead and responders were removed: unknown keys, refused like any.
      { leadMembershipId: TEAM },
      { leadMembershipId: null },
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

    it('should accept a period of whole UTC days', () => {
      expect(
        listIncidentsQuerySchema.parse({
          state: 'active',
          from: '2026-09-13',
          to: '2026-09-19',
        }),
      ).toEqual({ state: 'active', from: '2026-09-13', to: '2026-09-19' });
    });

    it.each([
      ['one end alone', { from: '2026-09-13' }],
      ['the other end alone', { to: '2026-09-19' }],
      ['an end before the start', { from: '2026-09-19', to: '2026-09-18' }],
      ['a date that does not exist', { from: '2026-02-30', to: '2026-03-01' }],
      ['367 days', { from: '2025-09-18', to: '2026-09-19' }],
    ])('should refuse %s', (_, period) => {
      expect(
        listIncidentsQuerySchema.safeParse({ state: 'active', ...period })
          .success,
      ).toBe(false);
    });

    it('should accept every filter together, trimming the search', () => {
      expect(
        listIncidentsQuerySchema.parse({
          state: 'resolved',
          severity: 'SEV2',
          serviceId: SERVICE,
          teamId: TEAM,
          q: '  checkout  ',
        }),
      ).toEqual({
        state: 'resolved',
        severity: 'SEV2',
        serviceId: SERVICE,
        teamId: TEAM,
        q: 'checkout',
      });
    });

    it.each(['', '   '])('should take the blank search %j as none', (q) => {
      expect(
        listIncidentsQuerySchema.parse({ state: 'active', q }).q,
      ).toBeUndefined();
    });

    it.each([
      ['a severity outside the four levels', { severity: 'SEV0' }],
      ['a malformed service id', { serviceId: 'payment-api' }],
      ['a malformed team id', { teamId: 'payments' }],
      ['a search over 200 characters', { q: 'x'.repeat(201) }],
    ])('should refuse %s', (_, filter) => {
      expect(
        listIncidentsQuerySchema.safeParse({ state: 'active', ...filter })
          .success,
      ).toBe(false);
    });
  });

  describe('searchedIncidentNumber', () => {
    it.each([
      ['42', 42],
      ['INC-42', 42],
      ['inc-7', 7],
    ])('should read %j as incident %i', (q, number) => {
      expect(searchedIncidentNumber(q)).toBe(number);
    });

    it.each(['checkout', 'INC-', 'INC 42', 'INC-042', '42 errors', '99999999999'])(
      'should read %j as words, not a number',
      (q) => {
        expect(searchedIncidentNumber(q)).toBeUndefined();
      },
    );
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
  describe('incidentSummaryQuerySchema', () => {
    it.each([
      ['one day', { from: '2026-09-19', to: '2026-09-19' }],
      ['a leap day', { from: '2024-02-29', to: '2024-03-01' }],
      ['366 days', { from: '2025-09-19', to: '2026-09-19' }],
    ])('should accept %s', (_, query) => {
      expect(incidentSummaryQuerySchema.parse(query)).toEqual(query);
    });

    it.each([
      ['a missing end', { from: '2026-09-19' }],
      ['a date that does not exist', { from: '2026-02-29', to: '2026-03-01' }],
      ['a time', { from: '2026-09-19T00:00:00Z', to: '2026-09-19' }],
      ['an unpadded date', { from: '2026-9-1', to: '2026-09-19' }],
      ['an end before the start', { from: '2026-09-19', to: '2026-09-18' }],
      ['367 days', { from: '2025-09-18', to: '2026-09-19' }],
    ])('should refuse %s', (_, query) => {
      expect(incidentSummaryQuerySchema.safeParse(query).success).toBe(false);
    });

    it('should bound a period by whole UTC days, the end day included', () => {
      expect(summaryBounds({ from: '2026-09-13', to: '2026-09-19' })).toEqual({
        gte: new Date('2026-09-13T00:00:00.000Z'),
        lt: new Date('2026-09-20T00:00:00.000Z'),
      });
    });
  });

  describe('incidentActivityQuerySchema', () => {
    /**
     * An activity calendar covers the same whole UTC days a summary does,
     * under the same limits: a client asking for 26 weeks asks for its days,
     * and which day its weeks start on is its own presentation choice.
     */
    it.each([
      ['one day', { from: '2026-09-19', to: '2026-09-19' }],
      ['26 weeks', { from: '2026-03-22', to: '2026-09-19' }],
      ['366 days', { from: '2025-09-19', to: '2026-09-19' }],
    ])('should accept %s', (_, query) => {
      expect(incidentActivityQuerySchema.parse(query)).toEqual(query);
    });

    it.each([
      ['a missing end', { from: '2026-09-19' }],
      ['a missing start', { to: '2026-09-19' }],
      ['an end before the start', { from: '2026-09-19', to: '2026-09-18' }],
      ['367 days', { from: '2025-09-18', to: '2026-09-19' }],
    ])('should refuse %s', (_, query) => {
      expect(incidentActivityQuerySchema.safeParse(query).success).toBe(false);
    });
  });
});
