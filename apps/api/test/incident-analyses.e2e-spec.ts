import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { TestingModule } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from './../src/app.module.js';
import { TokenService } from './../src/auth/token.service.js';
import { PrismaService } from './../src/database/prisma.service.js';
import type { Role } from './../src/generated/prisma/enums.js';

/**
 * Incident analysis routes wired through the real AppModule, with Prisma
 * mocked.
 *
 * Proves the wiring: every route is admitted and authorized; every role may
 * read an incident's analysis; only an ADMIN may start one, and a MEMBER is
 * refused with 403 before anything is read or written; an ADMIN edits any
 * draft and a MEMBER only one they own, through an UPDATE guarded by the
 * analysis, its organization, DRAFT, and the version the edit was based on;
 * only an ADMIN hands a draft to another active member, and the owner or an
 * ADMIN publishes one that has a summary, each guarded the same way; the
 * organization, the one who started it, and the one who published it come
 * from admission, never a body; bodies are validated strictly, and may be
 * absent where nothing need be said; a malformed incident number is a 404
 * before any query; and a non-member receives admission's 404. Behaviour
 * against real rows, tenant isolation, and every race are proven in
 * incident-analyses.integration-spec.ts.
 */
const USER_ID = '0199a1b2-c3d4-7000-8000-000000000001';
const ORG_ID = '0199a1b2-c3d4-7000-8000-00000000000a';
const OTHER_ORG_ID = '0199a1b2-c3d4-7000-8000-00000000000b';
const MEMBERSHIP_ID = '0199a1b2-c3d4-7000-8000-0000000000aa';
/** Another member of ORG_ID. */
const OWNER_MEMBERSHIP_ID = '0199a1b2-c3d4-7000-8000-0000000000ab';
const INCIDENT_ID = '0199a1b2-c3d4-7000-8000-0000000000e1';
const ANALYSIS_ID = '0199a1b2-c3d4-7000-8000-0000000000e2';
const DECLARED = new Date('2026-09-18T12:00:00.000Z');
const RESOLVED = new Date('2026-09-18T14:00:00.000Z');

const ACTOR = { id: USER_ID, name: 'Ada Lovelace' };

const analysisRow = {
  status: 'DRAFT',
  version: 1,
  summary: null,
  impact: null,
  cause: null,
  lessons: null,
  createdAt: RESOLVED,
  updatedAt: RESOLVED,
  publishedAt: null,
  owner: { id: MEMBERSHIP_ID, user: { name: 'Ada Lovelace' } },
  createdBy: ACTOR,
  publishedBy: null,
};

/** A resolved incident, its timeline, and — unless replaced — its analysis. */
const incidentRow = (analysis: object | null = analysisRow) => ({
  id: INCIDENT_ID,
  status: 'RESOLVED',
  severity: 'SEV2',
  createdAt: DECLARED,
  resolvedAt: RESOLVED,
  activity: [
    {
      id: '0199a1b2-c3d4-7000-8000-0000000000f1',
      type: 'DECLARED',
      fromValue: null,
      toValue: 'SEV2',
      createdAt: DECLARED,
      actor: ACTOR,
    },
    {
      id: '0199a1b2-c3d4-7000-8000-0000000000f2',
      type: 'STATUS_CHANGED',
      fromValue: 'INVESTIGATING',
      toValue: 'RESOLVED',
      createdAt: RESOLVED,
      actor: ACTOR,
    },
  ],
  analysis,
});

const base = `/api/v1/organizations/${ORG_ID}/incidents/1/analysis`;

describe('Incident analyses (e2e)', () => {
  let app: INestApplication;
  let tokens: TokenService;

  const prisma = {
    $transaction: vi.fn(),
    membership: { findFirst: vi.fn() },
    incident: { findFirst: vi.fn() },
    incidentAnalysis: {
      create: vi.fn(),
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
  };

  /**
   * Admission resolves the caller as `role` in ORG_ID, and nowhere else. The
   * same lookup by membership id resolves the caller's user, and finds
   * OWNER_MEMBERSHIP_ID as another active member.
   */
  const admitAs = (role: Role) =>
    prisma.membership.findFirst.mockImplementation(
      (args: { where: Record<string, unknown> }) => {
        if (args.where.organizationId !== ORG_ID) return null;

        if (args.where.id === OWNER_MEMBERSHIP_ID) {
          return { id: OWNER_MEMBERSHIP_ID };
        }

        // Admission looks the caller up by user; the service, by membership.
        if (args.where.id !== undefined && args.where.id !== MEMBERSHIP_ID) {
          return null;
        }

        return {
          id: MEMBERSHIP_ID,
          organizationId: ORG_ID,
          role,
          userId: USER_ID,
          user: { passwordChangeRequired: false },
        };
      },
    );

  const send = async (
    method: 'get' | 'post' | 'patch' | 'put',
    path: string,
    body?: object,
  ) => {
    const pending = request(app.getHttpServer())
      [method](path)
      .set('Authorization', `Bearer ${await tokens.signAccessToken(USER_ID)}`);

    return body === undefined ? pending : pending.send(body);
  };

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('/api/v1');
    await app.init();

    tokens = app.get(TokenService);

    // Interactive transactions run their work against the same mock.
    prisma.$transaction.mockImplementation((work: (tx: unknown) => unknown) =>
      work(prisma),
    );
    prisma.membership.findFirst.mockResolvedValue(null);
    prisma.incident.findFirst.mockResolvedValue(incidentRow());
    prisma.incidentAnalysis.create.mockResolvedValue(analysisRow);
    prisma.incidentAnalysis.updateMany.mockResolvedValue({ count: 1 });
    prisma.incidentAnalysis.findFirst.mockResolvedValue({ status: 'DRAFT' });
    prisma.incidentAnalysis.findUniqueOrThrow.mockResolvedValue({
      ...analysisRow,
      version: 2,
      cause: 'An expired certificate.',
    });
  });

  afterEach(async () => {
    vi.resetAllMocks();
    await app.close();
  });

  describe.each<Role>(['ADMIN', 'MEMBER'])('as %s', (role) => {
    beforeEach(() => admitAs(role));

    it('should read the analysis, with facts and key moments derived from the incident', async () => {
      const response = await send('get', base);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        status: 'DRAFT',
        version: 1,
        owner: { membershipId: MEMBERSHIP_ID, name: 'Ada Lovelace' },
        facts: {
          declaredAt: DECLARED.toISOString(),
          resolvedAt: RESOLVED.toISOString(),
          firstResponseAt: null,
          severity: { declared: 'SEV2', highest: 'SEV2', final: 'SEV2' },
        },
      });
      expect(
        response.body.keyMoments.map(({ kind }: { kind: string }) => kind),
      ).toEqual(['DECLARED', 'RESOLVED']);
      // The incident is found within the admitted organization, by number.
      expect(prisma.incident.findFirst.mock.calls[0][0].where).toMatchObject({
        organizationId: ORG_ID,
        number: 1,
      });
    });

    it('should answer 404 ANALYSIS_NOT_STARTED when the incident has none', async () => {
      prisma.incident.findFirst.mockResolvedValue(incidentRow(null));

      const response = await send('get', base);

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('ANALYSIS_NOT_STARTED');
    });

    it('should answer a malformed incident number with 404 INCIDENT_NOT_FOUND, reading nothing', async () => {
      const response = await send(
        'get',
        base.replace('/incidents/1/', '/incidents/INC-1/'),
      );

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('INCIDENT_NOT_FOUND');
      expect(prisma.incident.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('as ADMIN', () => {
    beforeEach(() => {
      admitAs('ADMIN');
      prisma.incident.findFirst.mockResolvedValue(incidentRow(null));
    });

    it('should start the analysis with no body, owned and started by the caller', async () => {
      const response = await send('post', base);

      expect(response.status).toBe(201);
      expect(response.body).toMatchObject({ status: 'DRAFT', version: 1 });
      expect(prisma.incidentAnalysis.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            organizationId: ORG_ID,
            incidentId: INCIDENT_ID,
            ownerMembershipId: MEMBERSHIP_ID,
            createdById: USER_ID,
          },
        }),
      );
    });

    it('should start it owned by another member of the organization', async () => {
      const response = await send('post', base, {
        ownerMembershipId: OWNER_MEMBERSHIP_ID,
      });

      expect(response.status).toBe(201);
      expect(
        prisma.incidentAnalysis.create.mock.calls[0][0].data,
      ).toMatchObject({
        ownerMembershipId: OWNER_MEMBERSHIP_ID,
        createdById: USER_ID,
      });
    });

    it('should refuse an owner who is not a member here with 404 MEMBERSHIP_NOT_FOUND, writing nothing', async () => {
      const response = await send('post', base, {
        ownerMembershipId: '0199a1b2-c3d4-7000-8000-0000000000ff',
      });

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('MEMBERSHIP_NOT_FOUND');
      expect(prisma.incidentAnalysis.create).not.toHaveBeenCalled();
    });

    it('should refuse an active incident with 409 INCIDENT_NOT_RESOLVED, writing nothing', async () => {
      prisma.incident.findFirst.mockResolvedValue({
        ...incidentRow(null),
        status: 'INVESTIGATING',
        resolvedAt: null,
      });

      const response = await send('post', base);

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('INCIDENT_NOT_RESOLVED');
      expect(prisma.incidentAnalysis.create).not.toHaveBeenCalled();
    });

    it('should refuse a second analysis with 409 ANALYSIS_ALREADY_STARTED, writing nothing', async () => {
      prisma.incident.findFirst.mockResolvedValue(
        incidentRow({ status: 'DRAFT' }),
      );

      const response = await send('post', base);

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('ANALYSIS_ALREADY_STARTED');
      expect(prisma.incidentAnalysis.create).not.toHaveBeenCalled();
    });
  });

  describe('as MEMBER', () => {
    beforeEach(() => admitAs('MEMBER'));

    it('should refuse starting an analysis with 403, before reading or writing anything', async () => {
      const response = await send('post', base, {
        ownerMembershipId: MEMBERSHIP_ID,
      });

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('PERMISSION_DENIED');
      expect(prisma.incident.findFirst).not.toHaveBeenCalled();
      expect(prisma.incidentAnalysis.create).not.toHaveBeenCalled();
    });
  });

  describe('editing', () => {
    /** The draft the edit reads first: owned by `ownerMembershipId`. */
    const draft = (
      overrides: Partial<{
        status: string;
        version: number;
        ownerMembershipId: string;
      }> = {},
    ) =>
      incidentRow({
        id: ANALYSIS_ID,
        status: 'DRAFT',
        version: 1,
        ownerMembershipId: OWNER_MEMBERSHIP_ID,
        ...overrides,
      });

    const edit = { version: 1, cause: 'An expired certificate.' };

    it('should let an ADMIN edit a draft they do not own, through the guarded update', async () => {
      admitAs('ADMIN');
      prisma.incident.findFirst.mockResolvedValue(draft());

      const response = await send('patch', base, edit);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        version: 2,
        cause: 'An expired certificate.',
      });
      expect(prisma.incidentAnalysis.updateMany).toHaveBeenCalledWith({
        where: {
          id: ANALYSIS_ID,
          organizationId: ORG_ID,
          status: 'DRAFT',
          version: 1,
        },
        data: { cause: 'An expired certificate.', version: { increment: 1 } },
      });
    });

    it('should let a MEMBER edit the draft they own', async () => {
      admitAs('MEMBER');
      prisma.incident.findFirst.mockResolvedValue(
        draft({ ownerMembershipId: MEMBERSHIP_ID }),
      );

      const response = await send('patch', base, edit);

      expect(response.status).toBe(200);
    });

    it('should write only the sections named, clearing those sent blank or null', async () => {
      admitAs('ADMIN');
      prisma.incident.findFirst.mockResolvedValue(draft());

      await send('patch', base, { version: 1, impact: '  ', lessons: null });

      expect(prisma.incidentAnalysis.updateMany.mock.calls[0][0].data).toEqual({
        impact: null,
        lessons: null,
        version: { increment: 1 },
      });
    });

    it('should refuse a MEMBER who does not own it with 403 NOT_ANALYSIS_OWNER, writing nothing', async () => {
      admitAs('MEMBER');
      prisma.incident.findFirst.mockResolvedValue(draft());

      const response = await send('patch', base, edit);

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('NOT_ANALYSIS_OWNER');
      expect(prisma.incidentAnalysis.updateMany).not.toHaveBeenCalled();
    });

    it('should refuse a published analysis with 409 ANALYSIS_PUBLISHED, writing nothing', async () => {
      admitAs('ADMIN');
      prisma.incident.findFirst.mockResolvedValue(
        draft({ status: 'PUBLISHED' }),
      );

      const response = await send('patch', base, edit);

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('ANALYSIS_PUBLISHED');
      expect(prisma.incidentAnalysis.updateMany).not.toHaveBeenCalled();
    });

    it('should refuse an edit based on an older version with 409 ANALYSIS_CHANGED, writing nothing', async () => {
      admitAs('ADMIN');
      prisma.incident.findFirst.mockResolvedValue(draft({ version: 2 }));

      const response = await send('patch', base, edit);

      expect(response.status).toBe(409);
      expect(response.body.code).toBe('ANALYSIS_CHANGED');
      expect(prisma.incidentAnalysis.updateMany).not.toHaveBeenCalled();
    });

    it.each([
      { now: 'DRAFT', code: 'ANALYSIS_CHANGED' },
      { now: 'PUBLISHED', code: 'ANALYSIS_PUBLISHED' },
    ])(
      'should answer 409 $code when the guarded update matches nothing and it is now $now',
      async ({ now, code }) => {
        admitAs('ADMIN');
        prisma.incident.findFirst.mockResolvedValue(draft());
        prisma.incidentAnalysis.updateMany.mockResolvedValue({ count: 0 });
        prisma.incidentAnalysis.findFirst.mockResolvedValue({ status: now });

        const response = await send('patch', base, edit);

        expect(response.status).toBe(409);
        expect(response.body.code).toBe(code);
        expect(
          prisma.incidentAnalysis.findUniqueOrThrow,
        ).not.toHaveBeenCalled();
      },
    );

    it('should answer 404 ANALYSIS_NOT_STARTED when the incident has none', async () => {
      admitAs('ADMIN');
      prisma.incident.findFirst.mockResolvedValue(incidentRow(null));

      const response = await send('patch', base, edit);

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('ANALYSIS_NOT_STARTED');
    });

    it('should answer a malformed incident number with 404 INCIDENT_NOT_FOUND, reading nothing', async () => {
      admitAs('ADMIN');

      const response = await send(
        'patch',
        base.replace('/incidents/1/', '/incidents/INC-1/'),
        edit,
      );

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('INCIDENT_NOT_FOUND');
      expect(prisma.incident.findFirst).not.toHaveBeenCalled();
    });

    it.each([
      {},
      { version: 1 },
      { cause: 'No version' },
      { version: 0, cause: 'Cause' },
      { version: 1, cause: 'x'.repeat(4001) },
      { version: 1, cause: 'Cause', status: 'PUBLISHED' },
      { version: 1, cause: 'Cause', ownerMembershipId: MEMBERSHIP_ID },
    ])(
      'should refuse the edit body %o with 400, reading nothing',
      async (body) => {
        admitAs('ADMIN');

        const response = await send('patch', base, body);

        expect(response.status).toBe(400);
        expect(prisma.incident.findFirst).not.toHaveBeenCalled();
        expect(prisma.incidentAnalysis.updateMany).not.toHaveBeenCalled();
      },
    );
  });

  describe('reassigning the owner', () => {
    const ownerPath = `${base}/owner`;
    const reassign = { ownerMembershipId: OWNER_MEMBERSHIP_ID, version: 1 };

    /** The draft the reassignment reads first. */
    const draft = (
      overrides: Partial<{ status: string; version: number }> = {},
    ) =>
      incidentRow({
        id: ANALYSIS_ID,
        status: 'DRAFT',
        version: 1,
        ...overrides,
      });

    it('should let an ADMIN hand a draft to another member, through the guarded update', async () => {
      admitAs('ADMIN');
      prisma.incident.findFirst.mockResolvedValue(draft());

      const response = await send('put', ownerPath, reassign);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ version: 2 });
      expect(prisma.incidentAnalysis.updateMany).toHaveBeenCalledWith({
        where: {
          id: ANALYSIS_ID,
          organizationId: ORG_ID,
          status: 'DRAFT',
          version: 1,
        },
        data: {
          ownerMembershipId: OWNER_MEMBERSHIP_ID,
          version: { increment: 1 },
        },
      });
    });

    it('should refuse a MEMBER — even the current owner — with 403, before reading anything', async () => {
      admitAs('MEMBER');

      const response = await send('put', ownerPath, {
        ownerMembershipId: MEMBERSHIP_ID,
        version: 1,
      });

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('PERMISSION_DENIED');
      expect(prisma.incident.findFirst).not.toHaveBeenCalled();
      expect(prisma.incidentAnalysis.updateMany).not.toHaveBeenCalled();
    });

    it('should refuse an owner who is not an active member here with 404 MEMBERSHIP_NOT_FOUND, writing nothing', async () => {
      admitAs('ADMIN');
      prisma.incident.findFirst.mockResolvedValue(draft());

      const response = await send('put', ownerPath, {
        ownerMembershipId: '0199a1b2-c3d4-7000-8000-0000000000ff',
        version: 1,
      });

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('MEMBERSHIP_NOT_FOUND');
      expect(prisma.incidentAnalysis.updateMany).not.toHaveBeenCalled();
    });

    it.each([
      { state: { status: 'PUBLISHED' }, code: 'ANALYSIS_PUBLISHED' },
      { state: { version: 2 }, code: 'ANALYSIS_CHANGED' },
    ])(
      'should refuse with 409 $code, writing nothing',
      async ({ state, code }) => {
        admitAs('ADMIN');
        prisma.incident.findFirst.mockResolvedValue(draft(state));

        const response = await send('put', ownerPath, reassign);

        expect(response.status).toBe(409);
        expect(response.body.code).toBe(code);
        expect(prisma.incidentAnalysis.updateMany).not.toHaveBeenCalled();
      },
    );

    it('should judge the analysis before the owner it names', async () => {
      admitAs('ADMIN');
      prisma.incident.findFirst.mockResolvedValue(draft({ version: 2 }));

      const response = await send('put', ownerPath, {
        ownerMembershipId: '0199a1b2-c3d4-7000-8000-0000000000ff',
        version: 1,
      });

      expect(response.body.code).toBe('ANALYSIS_CHANGED');
    });

    it.each([
      { now: 'DRAFT', code: 'ANALYSIS_CHANGED' },
      { now: 'PUBLISHED', code: 'ANALYSIS_PUBLISHED' },
    ])(
      'should answer 409 $code when the guarded update matches nothing and it is now $now',
      async ({ now, code }) => {
        admitAs('ADMIN');
        prisma.incident.findFirst.mockResolvedValue(draft());
        prisma.incidentAnalysis.updateMany.mockResolvedValue({ count: 0 });
        prisma.incidentAnalysis.findFirst.mockResolvedValue({ status: now });

        const response = await send('put', ownerPath, reassign);

        expect(response.status).toBe(409);
        expect(response.body.code).toBe(code);
        expect(
          prisma.incidentAnalysis.findUniqueOrThrow,
        ).not.toHaveBeenCalled();
      },
    );

    it('should answer 404 ANALYSIS_NOT_STARTED when the incident has none', async () => {
      admitAs('ADMIN');
      prisma.incident.findFirst.mockResolvedValue(incidentRow(null));

      const response = await send('put', ownerPath, reassign);

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('ANALYSIS_NOT_STARTED');
    });

    it('should answer a malformed incident number with 404 INCIDENT_NOT_FOUND, reading nothing', async () => {
      admitAs('ADMIN');

      const response = await send(
        'put',
        ownerPath.replace('/incidents/1/', '/incidents/INC-1/'),
        reassign,
      );

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('INCIDENT_NOT_FOUND');
      expect(prisma.incident.findFirst).not.toHaveBeenCalled();
    });

    it.each([
      {},
      { version: 1 },
      { ownerMembershipId: OWNER_MEMBERSHIP_ID },
      { ownerMembershipId: 'dave', version: 1 },
      { ownerMembershipId: OWNER_MEMBERSHIP_ID, version: 0 },
      { ownerMembershipId: OWNER_MEMBERSHIP_ID, version: 1, summary: 'x' },
    ])('should refuse the body %o with 400, reading nothing', async (body) => {
      admitAs('ADMIN');

      const response = await send('put', ownerPath, body);

      expect(response.status).toBe(400);
      expect(prisma.incident.findFirst).not.toHaveBeenCalled();
      expect(prisma.incidentAnalysis.updateMany).not.toHaveBeenCalled();
    });

    it('should receive admission 404 as a non-member', async () => {
      admitAs('ADMIN');

      const response = await send(
        'put',
        ownerPath.replace(ORG_ID, OTHER_ORG_ID),
        reassign,
      );

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('ORGANIZATION_NOT_FOUND');
      expect(prisma.incidentAnalysis.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('publishing', () => {
    const publishPath = `${base}/publish`;
    const publish = { version: 1 };

    /** The draft the publication reads first. */
    const draft = (
      overrides: Partial<{
        status: string;
        version: number;
        ownerMembershipId: string;
        summary: string | null;
      }> = {},
    ) =>
      incidentRow({
        id: ANALYSIS_ID,
        status: 'DRAFT',
        version: 1,
        ownerMembershipId: OWNER_MEMBERSHIP_ID,
        summary: 'Card payments failed for two hours.',
        ...overrides,
      });

    it('should let an ADMIN publish a draft they do not own, through the guarded update, answering 200', async () => {
      admitAs('ADMIN');
      prisma.incident.findFirst.mockResolvedValue(draft());

      const response = await send('post', publishPath, publish);

      expect(response.status).toBe(200);
      expect(prisma.incidentAnalysis.updateMany).toHaveBeenCalledWith({
        where: {
          id: ANALYSIS_ID,
          organizationId: ORG_ID,
          status: 'DRAFT',
          version: 1,
        },
        data: {
          status: 'PUBLISHED',
          publishedAt: expect.any(Date),
          // The admitted caller's user, never anything a body names.
          publishedById: USER_ID,
          version: { increment: 1 },
        },
      });
    });

    it('should let a MEMBER publish the draft they own', async () => {
      admitAs('MEMBER');
      prisma.incident.findFirst.mockResolvedValue(
        draft({ ownerMembershipId: MEMBERSHIP_ID }),
      );

      const response = await send('post', publishPath, publish);

      expect(response.status).toBe(200);
    });

    it('should refuse a MEMBER who does not own it with 403 NOT_ANALYSIS_OWNER, writing nothing', async () => {
      admitAs('MEMBER');
      prisma.incident.findFirst.mockResolvedValue(draft());

      const response = await send('post', publishPath, publish);

      expect(response.status).toBe(403);
      expect(response.body.code).toBe('NOT_ANALYSIS_OWNER');
      expect(prisma.incidentAnalysis.updateMany).not.toHaveBeenCalled();
    });

    it.each([
      { state: { status: 'PUBLISHED' }, code: 'ANALYSIS_PUBLISHED' },
      { state: { version: 2 }, code: 'ANALYSIS_CHANGED' },
      { state: { summary: null }, code: 'ANALYSIS_SUMMARY_REQUIRED' },
      // The version is judged before the content.
      { state: { version: 2, summary: null }, code: 'ANALYSIS_CHANGED' },
    ])(
      'should refuse with 409 $code, writing nothing',
      async ({ state, code }) => {
        admitAs('ADMIN');
        prisma.incident.findFirst.mockResolvedValue(draft(state));

        const response = await send('post', publishPath, publish);

        expect(response.status).toBe(409);
        expect(response.body.code).toBe(code);
        expect(prisma.incidentAnalysis.updateMany).not.toHaveBeenCalled();
      },
    );

    it.each([
      { now: 'DRAFT', code: 'ANALYSIS_CHANGED' },
      { now: 'PUBLISHED', code: 'ANALYSIS_PUBLISHED' },
    ])(
      'should answer 409 $code when the guarded update matches nothing and it is now $now',
      async ({ now, code }) => {
        admitAs('ADMIN');
        prisma.incident.findFirst.mockResolvedValue(draft());
        prisma.incidentAnalysis.updateMany.mockResolvedValue({ count: 0 });
        prisma.incidentAnalysis.findFirst.mockResolvedValue({ status: now });

        const response = await send('post', publishPath, publish);

        expect(response.status).toBe(409);
        expect(response.body.code).toBe(code);
        expect(
          prisma.incidentAnalysis.findUniqueOrThrow,
        ).not.toHaveBeenCalled();
      },
    );

    it('should answer 404 ANALYSIS_NOT_STARTED when the incident has none', async () => {
      admitAs('ADMIN');
      prisma.incident.findFirst.mockResolvedValue(incidentRow(null));

      const response = await send('post', publishPath, publish);

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('ANALYSIS_NOT_STARTED');
    });

    it('should answer a malformed incident number with 404 INCIDENT_NOT_FOUND, reading nothing', async () => {
      admitAs('ADMIN');

      const response = await send(
        'post',
        publishPath.replace('/incidents/1/', '/incidents/INC-1/'),
        publish,
      );

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('INCIDENT_NOT_FOUND');
      expect(prisma.incident.findFirst).not.toHaveBeenCalled();
    });

    it.each([
      undefined,
      {},
      { version: 0 },
      { version: '1' },
      { version: 1, summary: 'Written while publishing' },
      { version: 1, publishedById: USER_ID },
    ])('should refuse the body %o with 400, reading nothing', async (body) => {
      admitAs('ADMIN');

      const response = await send('post', publishPath, body);

      expect(response.status).toBe(400);
      expect(prisma.incident.findFirst).not.toHaveBeenCalled();
      expect(prisma.incidentAnalysis.updateMany).not.toHaveBeenCalled();
    });

    it('should receive admission 404 as a non-member', async () => {
      admitAs('ADMIN');

      const response = await send(
        'post',
        publishPath.replace(ORG_ID, OTHER_ORG_ID),
        publish,
      );

      expect(response.status).toBe(404);
      expect(response.body.code).toBe('ORGANIZATION_NOT_FOUND');
      expect(prisma.incidentAnalysis.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('validation', () => {
    beforeEach(() => {
      admitAs('ADMIN');
      prisma.incident.findFirst.mockResolvedValue(incidentRow(null));
    });

    it.each([
      { ownerMembershipId: 'dave' },
      { organizationId: OTHER_ORG_ID },
      { createdById: USER_ID },
      { incidentId: INCIDENT_ID },
      { summary: 'Written at the start' },
    ])('should refuse the start body %o with 400', async (body) => {
      const response = await send('post', base, body);

      expect(response.status).toBe(400);
      expect(prisma.incidentAnalysis.create).not.toHaveBeenCalled();
    });
  });

  describe('a non-member', () => {
    it.each(['get' as const, 'post' as const, 'patch' as const])(
      'should receive 404 from %s',
      async (method) => {
        admitAs('ADMIN');

        const response = await send(
          method,
          base.replace(ORG_ID, OTHER_ORG_ID),
          method === 'get' ? undefined : { version: 1, summary: 'Summary' },
        );

        expect(response.status).toBe(404);
        expect(response.body.code).toBe('ORGANIZATION_NOT_FOUND');
        expect(prisma.incident.findFirst).not.toHaveBeenCalled();
        expect(prisma.incidentAnalysis.create).not.toHaveBeenCalled();
        expect(prisma.incidentAnalysis.updateMany).not.toHaveBeenCalled();
      },
    );
  });
});
