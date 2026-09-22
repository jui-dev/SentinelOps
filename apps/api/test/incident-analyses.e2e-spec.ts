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
 * Proves the wiring: both routes are admitted and authorized; every role may
 * read an incident's analysis; only an ADMIN may start one, and a MEMBER is
 * refused with 403 before anything is read or written; the organization and
 * the one who started it come from admission, never a body; bodies are
 * validated strictly, and may be absent; a malformed incident number is a
 * 404 before any query; and a non-member receives admission's 404. Behaviour
 * against real rows, tenant isolation, and concurrent starts are proven in
 * incident-analyses.integration-spec.ts.
 */
const USER_ID = '0199a1b2-c3d4-7000-8000-000000000001';
const ORG_ID = '0199a1b2-c3d4-7000-8000-00000000000a';
const OTHER_ORG_ID = '0199a1b2-c3d4-7000-8000-00000000000b';
const MEMBERSHIP_ID = '0199a1b2-c3d4-7000-8000-0000000000aa';
/** Another member of ORG_ID. */
const OWNER_MEMBERSHIP_ID = '0199a1b2-c3d4-7000-8000-0000000000ab';
const INCIDENT_ID = '0199a1b2-c3d4-7000-8000-0000000000e1';
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
    membership: { findFirst: vi.fn() },
    incident: { findFirst: vi.fn() },
    incidentAnalysis: { create: vi.fn() },
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

  const send = async (method: 'get' | 'post', path: string, body?: object) => {
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

    prisma.membership.findFirst.mockResolvedValue(null);
    prisma.incident.findFirst.mockResolvedValue(incidentRow());
    prisma.incidentAnalysis.create.mockResolvedValue(analysisRow);
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
    it.each(['get' as const, 'post' as const])(
      'should receive 404 from %s',
      async (method) => {
        admitAs('ADMIN');

        const response = await send(
          method,
          base.replace(ORG_ID, OTHER_ORG_ID),
          method === 'get' ? undefined : {},
        );

        expect(response.status).toBe(404);
        expect(response.body.code).toBe('ORGANIZATION_NOT_FOUND');
        expect(prisma.incident.findFirst).not.toHaveBeenCalled();
        expect(prisma.incidentAnalysis.create).not.toHaveBeenCalled();
      },
    );
  });
});
