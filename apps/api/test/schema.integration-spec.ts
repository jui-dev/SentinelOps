import { PrismaService } from './../src/database/prisma.service.js';
import { resolveTestDatabaseUrl } from './test-database.js';

/**
 * Constraints, cascades, and column types are properties of the database, not of
 * TypeScript. The unit and e2e suites mock PrismaService entirely, so this is the
 * only place the core model is actually exercised.
 *
 * PrismaService is constructed directly against TEST_DATABASE_URL rather than
 * resolved from the container, matching how the other units are tested — and
 * meaning the `database` config domain, and therefore DATABASE_URL, is never
 * consulted anywhere in this file.
 */
describe('core domain schema (integration)', () => {
  const prisma = new PrismaService({ url: resolveTestDatabaseUrl() });

  /** Postgres unique constraint violation, as surfaced by Prisma. */
  const UNIQUE_VIOLATION = 'P2002';

  const anOrganization = (slug: string) =>
    prisma.organization.create({ data: { name: slug, slug } });

  const aUser = (email: string) =>
    prisma.user.create({ data: { email, name: 'Ada Lovelace' } });

  const codeOf = (error: unknown): unknown =>
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code: unknown }).code
      : undefined;

  const isUniqueViolation = (error: unknown): boolean =>
    codeOf(error) === UNIQUE_VIOLATION;

  beforeAll(async () => {
    await prisma.$connect();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE incidents, services, team_memberships, teams, invitations, memberships, users, organizations RESTART IDENTITY CASCADE',
    );
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  describe('identity', () => {
    it('should generate a version 7 uuid for every table', async () => {
      const organization = await anOrganization('acme');
      const user = await aUser('ada@example.com');
      const membership = await prisma.membership.create({
        data: { organizationId: organization.id, userId: user.id },
      });

      // 8-4-4-4-12; the first character of the third group is the version.
      for (const id of [organization.id, user.id, membership.id]) {
        expect(id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
      }
    });

    it('should store ids in native uuid columns', async () => {
      const columns = await prisma.$queryRawUnsafe<
        { table_name: string; data_type: string }[]
      >(
        // Scoped to the domain tables: Prisma's own _prisma_migrations
        // bookkeeping table also has an `id`, and it is a varchar by design.
        `SELECT table_name, data_type FROM information_schema.columns
         WHERE table_schema = 'public'
           AND column_name = 'id'
           AND table_name IN (
             'organizations', 'users', 'memberships', 'teams', 'team_memberships',
             'services'
           )
         ORDER BY table_name`,
      );

      expect(columns).toHaveLength(6);
      for (const column of columns) {
        expect(column.data_type).toBe('uuid');
      }
    });
  });

  describe('uniqueness', () => {
    it('should reject a duplicate organization slug', async () => {
      await anOrganization('acme');

      await expect(anOrganization('acme')).rejects.toSatisfy(isUniqueViolation);
    });

    it('should reject a duplicate user email', async () => {
      await aUser('ada@example.com');

      await expect(aUser('ada@example.com')).rejects.toSatisfy(
        isUniqueViolation,
      );
    });

    it('should reject a second membership for the same user and organization', async () => {
      const organization = await anOrganization('acme');
      const user = await aUser('ada@example.com');
      const data = { organizationId: organization.id, userId: user.id };

      await prisma.membership.create({ data });

      await expect(prisma.membership.create({ data })).rejects.toSatisfy(
        isUniqueViolation,
      );
    });
  });

  describe('multi-organization membership', () => {
    it('should let one user hold different roles in two organizations', async () => {
      // The point of the global-user model: one identity, one login, a separate
      // capacity per organization.
      const acme = await anOrganization('acme');
      const globex = await anOrganization('globex');
      const user = await aUser('ada@example.com');

      await prisma.membership.create({
        data: { organizationId: acme.id, userId: user.id, role: 'OWNER' },
      });
      await prisma.membership.create({
        data: { organizationId: globex.id, userId: user.id, role: 'MEMBER' },
      });

      const memberships = await prisma.membership.findMany({
        where: { userId: user.id },
      });

      expect(memberships).toHaveLength(2);
      expect(memberships.map((membership) => membership.role).sort()).toEqual([
        'MEMBER',
        'OWNER',
      ]);
    });
  });

  describe('physical deletion cascades', () => {
    it('should remove memberships when an organization is deleted, keeping the user', async () => {
      const organization = await anOrganization('acme');
      const user = await aUser('ada@example.com');
      await prisma.membership.create({
        data: { organizationId: organization.id, userId: user.id },
      });

      await prisma.organization.delete({ where: { id: organization.id } });

      expect(await prisma.membership.count()).toBe(0);
      expect(await prisma.user.count()).toBe(1);
    });

    it('should remove memberships when a user is deleted, keeping the organization', async () => {
      const organization = await anOrganization('acme');
      const user = await aUser('ada@example.com');
      await prisma.membership.create({
        data: { organizationId: organization.id, userId: user.id },
      });

      await prisma.user.delete({ where: { id: user.id } });

      expect(await prisma.membership.count()).toBe(0);
      expect(await prisma.organization.count()).toBe(1);
    });
  });

  describe('soft deletion', () => {
    it('should default deletedAt to null', async () => {
      expect((await anOrganization('acme')).deletedAt).toBeNull();
      expect((await aUser('ada@example.com')).deletedAt).toBeNull();
    });

    it('should preserve memberships when an organization is soft deleted', async () => {
      // The distinction the whole deletion policy rests on: the ordinary
      // application delete is an UPDATE, touches no foreign key, and therefore
      // does not cascade. Only a physical DELETE does.
      const organization = await anOrganization('acme');
      const user = await aUser('ada@example.com');
      await prisma.membership.create({
        data: { organizationId: organization.id, userId: user.id },
      });

      await prisma.organization.update({
        where: { id: organization.id },
        data: { deletedAt: new Date() },
      });

      expect(await prisma.membership.count()).toBe(1);
    });

    it('should preserve memberships when a user is soft deleted', async () => {
      const organization = await anOrganization('acme');
      const user = await aUser('ada@example.com');
      await prisma.membership.create({
        data: { organizationId: organization.id, userId: user.id },
      });

      await prisma.user.update({
        where: { id: user.id },
        data: { deletedAt: new Date() },
      });

      expect(await prisma.membership.count()).toBe(1);
    });
  });

  describe('teams and tenant consistency', () => {
    /** Postgres foreign-key violation: Prisma's code, or the SQLSTATE on raw SQL. */
    const isForeignKeyViolation = (error: unknown): boolean =>
      codeOf(error) === 'P2003' ||
      (error instanceof Error && /23503|foreign key/i.test(error.message));

    /** Two organizations, each with one member and one team. */
    const twoTenants = async () => {
      const acme = await anOrganization('acme');
      const globex = await anOrganization('globex');
      const ada = await aUser('ada@example.com');
      const grace = await aUser('grace@example.com');
      const adaInAcme = await prisma.membership.create({
        data: { organizationId: acme.id, userId: ada.id },
      });
      const graceInGlobex = await prisma.membership.create({
        data: { organizationId: globex.id, userId: grace.id },
      });
      const acmeTeam = await prisma.team.create({
        data: { organizationId: acme.id, name: 'Platform', slug: 'platform' },
      });
      const globexTeam = await prisma.team.create({
        data: { organizationId: globex.id, name: 'Platform', slug: 'platform' },
      });

      return { acme, globex, adaInAcme, graceInGlobex, acmeTeam, globexTeam };
    };

    const place = (
      organizationId: string,
      teamId: string,
      membershipId: string,
    ) =>
      prisma.teamMembership.create({
        data: { organizationId, teamId, membershipId },
      });

    it('should allow the same team name and slug in two organizations', async () => {
      // Created by twoTenants without error.
      const { acmeTeam, globexTeam } = await twoTenants();

      expect(acmeTeam.slug).toBe(globexTeam.slug);
    });

    it('should reject a duplicate team slug or name within one organization', async () => {
      const { acme } = await twoTenants();

      await expect(
        prisma.team.create({
          data: { organizationId: acme.id, name: 'Other', slug: 'platform' },
        }),
      ).rejects.toSatisfy(isUniqueViolation);
      await expect(
        prisma.team.create({
          data: { organizationId: acme.id, name: 'Platform', slug: 'other' },
        }),
      ).rejects.toSatisfy(isUniqueViolation);
    });

    it('should reject placing the same member on a team twice', async () => {
      const { acme, acmeTeam, adaInAcme } = await twoTenants();

      await place(acme.id, acmeTeam.id, adaInAcme.id);

      await expect(place(acme.id, acmeTeam.id, adaInAcme.id)).rejects.toSatisfy(
        isUniqueViolation,
      );
    });

    it("should reject another organization's membership on a team, whichever organization the row claims", async () => {
      const { acme, globex, acmeTeam, graceInGlobex } = await twoTenants();

      // Claiming the team's organization: the membership key fails.
      await expect(
        place(acme.id, acmeTeam.id, graceInGlobex.id),
      ).rejects.toSatisfy(isForeignKeyViolation);
      // Claiming the membership's organization: the team key fails.
      await expect(
        place(globex.id, acmeTeam.id, graceInGlobex.id),
      ).rejects.toSatisfy(isForeignKeyViolation);

      expect(await prisma.teamMembership.count()).toBe(0);
    });

    it('should reject a cross-organization placement written in raw SQL, bypassing Prisma', async () => {
      const { acme, globex, acmeTeam, graceInGlobex } = await twoTenants();

      for (const organizationId of [acme.id, globex.id]) {
        await expect(
          prisma.$executeRawUnsafe(
            `INSERT INTO team_memberships (id, organization_id, team_id, membership_id)
             VALUES (gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid)`,
            organizationId,
            acmeTeam.id,
            graceInGlobex.id,
          ),
        ).rejects.toSatisfy(isForeignKeyViolation);
      }

      expect(await prisma.teamMembership.count()).toBe(0);
    });

    it('should refuse to move a membership to another organization while it is on a team', async () => {
      const { acme, globex, acmeTeam, adaInAcme } = await twoTenants();
      await place(acme.id, acmeTeam.id, adaInAcme.id);

      // ON UPDATE CASCADE carries the new organization into the placement,
      // where it no longer matches the team's.
      await expect(
        prisma.$executeRawUnsafe(
          'UPDATE memberships SET organization_id = $1::uuid WHERE id = $2::uuid',
          globex.id,
          adaInAcme.id,
        ),
      ).rejects.toSatisfy(isForeignKeyViolation);
    });

    it('should remove placements, and only placements, when a team is deleted', async () => {
      const { acme, acmeTeam, adaInAcme } = await twoTenants();
      await place(acme.id, acmeTeam.id, adaInAcme.id);

      await prisma.team.delete({ where: { id: acmeTeam.id } });

      expect(await prisma.teamMembership.count()).toBe(0);
      expect(
        await prisma.membership.count({ where: { id: adaInAcme.id } }),
      ).toBe(1);
    });

    it('should remove placements, keeping the team, when a membership is deleted', async () => {
      const { acme, acmeTeam, adaInAcme } = await twoTenants();
      await place(acme.id, acmeTeam.id, adaInAcme.id);

      await prisma.membership.delete({ where: { id: adaInAcme.id } });

      expect(await prisma.teamMembership.count()).toBe(0);
      expect(await prisma.team.count({ where: { id: acmeTeam.id } })).toBe(1);
    });

    it("should remove an organization's teams when it is physically deleted", async () => {
      const { acme, acmeTeam, adaInAcme } = await twoTenants();
      await place(acme.id, acmeTeam.id, adaInAcme.id);

      await prisma.organization.delete({ where: { id: acme.id } });

      expect(await prisma.team.count()).toBe(1);
      expect(await prisma.teamMembership.count()).toBe(0);
    });

    it('should preserve teams and placements when an organization is soft deleted', async () => {
      const { acme, acmeTeam, adaInAcme } = await twoTenants();
      await place(acme.id, acmeTeam.id, adaInAcme.id);

      await prisma.organization.update({
        where: { id: acme.id },
        data: { deletedAt: new Date() },
      });

      expect(await prisma.team.count()).toBe(2);
      expect(await prisma.teamMembership.count()).toBe(1);
    });
  });

  describe('services and tenant consistency', () => {
    /** Postgres foreign-key violation: Prisma's code, or the SQLSTATE on raw SQL. */
    const isForeignKeyViolation = (error: unknown): boolean =>
      codeOf(error) === 'P2003' ||
      (error instanceof Error && /23503|foreign key/i.test(error.message));

    /** Postgres: not_null_violation, invalid_text_representation. */
    const isRefusedBy = (sqlstate: string) => (error: unknown) =>
      error instanceof Error && error.message.includes(sqlstate);

    /** Two organizations, each with two teams. */
    const twoTenants = async () => {
      const acme = await anOrganization('acme');
      const globex = await anOrganization('globex');
      const team = (organizationId: string, name: string) =>
        prisma.team.create({
          data: { organizationId, name, slug: name.toLowerCase() },
        });

      return {
        acme,
        globex,
        acmePayments: await team(acme.id, 'Payments'),
        acmePlatform: await team(acme.id, 'Platform'),
        globexPayments: await team(globex.id, 'Payments'),
        globexPlatform: await team(globex.id, 'Platform'),
      };
    };

    const aService = (
      organizationId: string,
      ownerTeamId: string,
      name = 'Payment API',
    ) =>
      prisma.service.create({
        data: {
          organizationId,
          ownerTeamId,
          name,
          slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
        },
      });

    it('should allow the same service name and slug in two organizations', async () => {
      const { acme, globex, acmePayments, globexPayments } = await twoTenants();

      const a = await aService(acme.id, acmePayments.id);
      const b = await aService(globex.id, globexPayments.id);

      expect(a.slug).toBe(b.slug);
    });

    it('should reject a duplicate service slug or name within one organization', async () => {
      const { acme, acmePayments, acmePlatform } = await twoTenants();
      await aService(acme.id, acmePayments.id);

      await expect(
        prisma.service.create({
          data: {
            organizationId: acme.id,
            ownerTeamId: acmePlatform.id,
            name: 'Other',
            slug: 'payment-api',
          },
        }),
      ).rejects.toSatisfy(isUniqueViolation);
      await expect(
        prisma.service.create({
          data: {
            organizationId: acme.id,
            ownerTeamId: acmePlatform.id,
            name: 'Payment API',
            slug: 'other',
          },
        }),
      ).rejects.toSatisfy(isUniqueViolation);
    });

    it('should default criticality to NORMAL', async () => {
      const { acme, acmePayments } = await twoTenants();

      expect((await aService(acme.id, acmePayments.id)).criticality).toBe(
        'NORMAL',
      );
    });

    it('should reject another organization’s team as owner, whichever organization the row claims', async () => {
      const { acme, globex, globexPayments } = await twoTenants();

      // Claiming acme: the owner key finds no (acme, globex-team) team.
      await expect(aService(acme.id, globexPayments.id)).rejects.toSatisfy(
        isForeignKeyViolation,
      );
      // Claiming globex is consistent — and is globex's own service, which
      // is exactly what the key permits.
      await expect(aService(globex.id, globexPayments.id)).resolves.toEqual(
        expect.objectContaining({ organizationId: globex.id }),
      );

      expect(
        await prisma.service.count({ where: { organizationId: acme.id } }),
      ).toBe(0);
    });

    it('should reject a cross-organization owner written in raw SQL, bypassing Prisma', async () => {
      const { acme, globexPayments } = await twoTenants();

      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO services (id, organization_id, owner_team_id, name, slug, updated_at)
           VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'Payment API', 'payment-api', now())`,
          acme.id,
          globexPayments.id,
        ),
      ).rejects.toSatisfy(isForeignKeyViolation);

      expect(await prisma.service.count()).toBe(0);
    });

    it('should refuse reassigning a service to another organization’s team in raw SQL', async () => {
      const { acme, acmePayments, globexPayments } = await twoTenants();
      const service = await aService(acme.id, acmePayments.id);

      await expect(
        prisma.$executeRawUnsafe(
          'UPDATE services SET owner_team_id = $1::uuid WHERE id = $2::uuid',
          globexPayments.id,
          service.id,
        ),
      ).rejects.toSatisfy(isForeignKeyViolation);

      expect(
        (await prisma.service.findUniqueOrThrow({ where: { id: service.id } }))
          .ownerTeamId,
      ).toBe(acmePayments.id);
    });

    it('should refuse moving a service to another organization in raw SQL', async () => {
      const { acme, globex, acmePayments } = await twoTenants();
      const service = await aService(acme.id, acmePayments.id);

      // Its owner is still acme's, so (globex, acme-team) matches no team.
      await expect(
        prisma.$executeRawUnsafe(
          'UPDATE services SET organization_id = $1::uuid WHERE id = $2::uuid',
          globex.id,
          service.id,
        ),
      ).rejects.toSatisfy(isForeignKeyViolation);
    });

    it('should refuse a service with no owner', async () => {
      const { acme } = await twoTenants();

      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO services (id, organization_id, owner_team_id, name, slug, updated_at)
           VALUES (gen_random_uuid(), $1::uuid, NULL, 'Payment API', 'payment-api', now())`,
          acme.id,
        ),
      ).rejects.toSatisfy(isRefusedBy('23502'));
    });

    it('should refuse a criticality outside the enum at the database level', async () => {
      const { acme, acmePayments } = await twoTenants();

      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO services (id, organization_id, owner_team_id, name, slug, criticality, updated_at)
           VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'Payment API', 'payment-api', 'TIER_1', now())`,
          acme.id,
          acmePayments.id,
        ),
      ).rejects.toSatisfy(isRefusedBy('22P02'));
    });

    it('should declare the owner key RESTRICT on delete and on update', async () => {
      // The observed behaviour below is what matters; this pins the
      // declaration so a regenerated migration cannot quietly change it.
      const [key] = await prisma.$queryRawUnsafe<
        { confdeltype: string; confupdtype: string }[]
      >(
        `SELECT confdeltype::text AS confdeltype, confupdtype::text AS confupdtype
         FROM pg_constraint
         WHERE conname = 'services_organization_id_owner_team_id_fkey'`,
      );

      expect(key).toEqual({ confdeltype: 'r', confupdtype: 'r' });
    });

    it('should refuse deleting a team that owns a service, until the service is reassigned', async () => {
      const { acme, acmePayments, acmePlatform } = await twoTenants();
      const service = await aService(acme.id, acmePayments.id);

      await expect(
        prisma.team.delete({ where: { id: acmePayments.id } }),
      ).rejects.toSatisfy(isForeignKeyViolation);
      // Written as raw SQL too: the refusal is the database's.
      await expect(
        prisma.$executeRawUnsafe(
          'DELETE FROM teams WHERE id = $1::uuid',
          acmePayments.id,
        ),
      ).rejects.toSatisfy(isForeignKeyViolation);
      expect(await prisma.service.count({ where: { id: service.id } })).toBe(1);

      await prisma.service.update({
        where: { id: service.id },
        data: { ownerTeamId: acmePlatform.id },
      });
      await prisma.team.delete({ where: { id: acmePayments.id } });

      expect(
        (await prisma.service.findUniqueOrThrow({ where: { id: service.id } }))
          .ownerTeamId,
      ).toBe(acmePlatform.id);
    });

    it('should refuse moving a team that owns services to another organization', async () => {
      const { acme, globex } = await twoTenants();
      // A name globex does not have, so only the owner key can refuse it.
      const checkout = await prisma.team.create({
        data: { organizationId: acme.id, name: 'Checkout', slug: 'checkout' },
      });
      await aService(acme.id, checkout.id);

      await expect(
        prisma.$executeRawUnsafe(
          'UPDATE teams SET organization_id = $1::uuid WHERE id = $2::uuid',
          globex.id,
          checkout.id,
        ),
      ).rejects.toSatisfy(isForeignKeyViolation);
      expect(
        (await prisma.team.findUniqueOrThrow({ where: { id: checkout.id } }))
          .organizationId,
      ).toBe(acme.id);
    });

    it("should remove an organization's teams and services when it is physically deleted", async () => {
      // The cascade from organizations reaches teams and services in the same
      // statement; the Restrict on the owner key must not stop it.
      const { acme, globex, acmePayments, acmePlatform, globexPayments } =
        await twoTenants();
      await aService(acme.id, acmePayments.id, 'Payment API');
      await aService(acme.id, acmePlatform.id, 'Storefront');
      await aService(globex.id, globexPayments.id, 'Payment API');

      await prisma.organization.delete({ where: { id: acme.id } });

      expect(await prisma.service.count()).toBe(1);
      expect(await prisma.team.count()).toBe(2);
      expect(
        await prisma.service.count({ where: { organizationId: globex.id } }),
      ).toBe(1);
    });

    it('should preserve teams and services when an organization is soft deleted', async () => {
      const { acme, acmePayments } = await twoTenants();
      await aService(acme.id, acmePayments.id);

      await prisma.organization.update({
        where: { id: acme.id },
        data: { deletedAt: new Date() },
      });

      expect(await prisma.service.count()).toBe(1);
      expect(await prisma.team.count()).toBe(4);
    });
  });

  describe('incidents and tenant consistency', () => {
    /** Postgres foreign-key violation: Prisma's code, or the SQLSTATE on raw SQL. */
    const isForeignKeyViolation = (error: unknown): boolean =>
      codeOf(error) === 'P2003' ||
      (error instanceof Error && /23503|foreign key/i.test(error.message));

    /** Postgres: check_violation, invalid_text_representation. */
    const isRefusedBy = (sqlstate: string) => (error: unknown) =>
      error instanceof Error && error.message.includes(sqlstate);

    /**
     * Two organizations, each with a Payments and a Platform team, a Payment
     * API owned by Payments, and a declaring user who is a member of both.
     */
    const twoTenants = async () => {
      const acme = await anOrganization('acme');
      const globex = await anOrganization('globex');
      const user = await aUser('ada@example.com');
      const team = (organizationId: string, name: string) =>
        prisma.team.create({
          data: { organizationId, name, slug: name.toLowerCase() },
        });
      const service = (organizationId: string, ownerTeamId: string) =>
        prisma.service.create({
          data: {
            organizationId,
            ownerTeamId,
            name: 'Payment API',
            slug: 'payment-api',
          },
        });

      const acmePayments = await team(acme.id, 'Payments');
      const acmePlatform = await team(acme.id, 'Platform');
      const globexPayments = await team(globex.id, 'Payments');

      return {
        acme,
        globex,
        user,
        acmePayments,
        acmePlatform,
        globexPayments,
        acmeService: await service(acme.id, acmePayments.id),
        globexService: await service(globex.id, globexPayments.id),
      };
    };

    const anIncident = (data: {
      organizationId: string;
      serviceId: string;
      teamId: string;
      createdById: string;
      number?: number;
    }) =>
      prisma.incident.create({
        data: {
          number: 1,
          title: 'Card payments failing',
          severity: 'SEV1',
          ...data,
        },
      });

    const insertIncidentSql = `INSERT INTO incidents
      (id, organization_id, number, title, service_id, team_id, severity, created_by_id, updated_at)
      VALUES (gen_random_uuid(), $1::uuid, $2, 'Card payments failing', $3::uuid, $4::uuid, 'SEV1', $5::uuid, now())`;

    // The highest-risk invariant of the stage, proven first: incidents hold
    // Restrict keys into services and teams, and the cascade from
    // organizations deletes all three in one statement. Postgres must still
    // complete it.
    it("should remove an organization's incidents, services, and teams when it is physically deleted", async () => {
      const {
        acme,
        globex,
        user,
        acmePayments,
        acmePlatform,
        acmeService,
        globexService,
        globexPayments,
      } = await twoTenants();
      await anIncident({
        organizationId: acme.id,
        serviceId: acmeService.id,
        teamId: acmePayments.id,
        createdById: user.id,
      });
      // Responsible team differs from the owner, so both team rows are
      // referenced by an incident.
      await anIncident({
        organizationId: acme.id,
        serviceId: acmeService.id,
        teamId: acmePlatform.id,
        createdById: user.id,
        number: 2,
      });
      await anIncident({
        organizationId: globex.id,
        serviceId: globexService.id,
        teamId: globexPayments.id,
        createdById: user.id,
      });

      await prisma.$executeRawUnsafe(
        'DELETE FROM organizations WHERE id = $1::uuid',
        acme.id,
      );

      expect(
        await prisma.incident.count({ where: { organizationId: acme.id } }),
      ).toBe(0);
      expect(
        await prisma.service.count({ where: { organizationId: acme.id } }),
      ).toBe(0);
      expect(
        await prisma.team.count({ where: { organizationId: acme.id } }),
      ).toBe(0);
      // The other tenant, and the global user, are untouched.
      expect(
        await prisma.incident.count({ where: { organizationId: globex.id } }),
      ).toBe(1);
      expect(await prisma.user.count({ where: { id: user.id } })).toBe(1);
    });

    it('should preserve incidents when an organization is soft deleted', async () => {
      const { acme, user, acmePayments, acmeService } = await twoTenants();
      await anIncident({
        organizationId: acme.id,
        serviceId: acmeService.id,
        teamId: acmePayments.id,
        createdById: user.id,
      });

      await prisma.organization.update({
        where: { id: acme.id },
        data: { deletedAt: new Date() },
      });

      expect(await prisma.incident.count()).toBe(1);
    });

    it('should default status to INVESTIGATING and start the organization counter at 0', async () => {
      const { acme, user, acmePayments, acmeService } = await twoTenants();

      const incident = await anIncident({
        organizationId: acme.id,
        serviceId: acmeService.id,
        teamId: acmePayments.id,
        createdById: user.id,
      });

      expect(incident.status).toBe('INVESTIGATING');
      expect(incident.resolvedAt).toBeNull();
      expect(acme.lastIncidentNumber).toBe(0);
    });

    it("should reject another organization's service, whichever organization the row claims", async () => {
      const { acme, user, acmePayments, globexService } = await twoTenants();

      await expect(
        anIncident({
          organizationId: acme.id,
          serviceId: globexService.id,
          teamId: acmePayments.id,
          createdById: user.id,
        }),
      ).rejects.toSatisfy(isForeignKeyViolation);
      await expect(
        prisma.$executeRawUnsafe(
          insertIncidentSql,
          acme.id,
          1,
          globexService.id,
          acmePayments.id,
          user.id,
        ),
      ).rejects.toSatisfy(isForeignKeyViolation);

      expect(await prisma.incident.count()).toBe(0);
    });

    it("should reject another organization's team, whichever organization the row claims", async () => {
      const { acme, globex, user, acmeService, globexPayments } =
        await twoTenants();

      // Claiming acme: no (acme, globex-team) team.
      await expect(
        prisma.$executeRawUnsafe(
          insertIncidentSql,
          acme.id,
          1,
          acmeService.id,
          globexPayments.id,
          user.id,
        ),
      ).rejects.toSatisfy(isForeignKeyViolation);
      // Claiming globex: no (globex, acme-service) service.
      await expect(
        prisma.$executeRawUnsafe(
          insertIncidentSql,
          globex.id,
          1,
          acmeService.id,
          globexPayments.id,
          user.id,
        ),
      ).rejects.toSatisfy(isForeignKeyViolation);

      expect(await prisma.incident.count()).toBe(0);
    });

    it('should refuse re-pointing an incident across organizations in raw SQL', async () => {
      const {
        acme,
        globex,
        user,
        acmePayments,
        acmeService,
        globexService,
        globexPayments,
      } = await twoTenants();
      const incident = await anIncident({
        organizationId: acme.id,
        serviceId: acmeService.id,
        teamId: acmePayments.id,
        createdById: user.id,
      });

      for (const [sql, value] of [
        [
          'UPDATE incidents SET service_id = $1::uuid WHERE id = $2::uuid',
          globexService.id,
        ],
        [
          'UPDATE incidents SET team_id = $1::uuid WHERE id = $2::uuid',
          globexPayments.id,
        ],
        [
          'UPDATE incidents SET organization_id = $1::uuid WHERE id = $2::uuid',
          globex.id,
        ],
      ] as const) {
        await expect(
          prisma.$executeRawUnsafe(sql, value, incident.id),
        ).rejects.toSatisfy(isForeignKeyViolation);
      }

      expect(
        await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } }),
      ).toEqual(
        expect.objectContaining({
          organizationId: acme.id,
          serviceId: acmeService.id,
          teamId: acmePayments.id,
        }),
      );
    });

    it('should refuse moving a team an incident names to another organization', async () => {
      const { acme, globex, user, acmeService } = await twoTenants();
      // A team that owns nothing and whose name globex lacks, so only the
      // incident's team key can refuse the move. (A service cannot be moved
      // either, but its owner key already refuses that — see services.)
      const oncall = await prisma.team.create({
        data: { organizationId: acme.id, name: 'On-call', slug: 'on-call' },
      });
      await anIncident({
        organizationId: acme.id,
        serviceId: acmeService.id,
        teamId: oncall.id,
        createdById: user.id,
      });

      await expect(
        prisma.$executeRawUnsafe(
          'UPDATE teams SET organization_id = $1::uuid WHERE id = $2::uuid',
          globex.id,
          oncall.id,
        ),
      ).rejects.toSatisfy(isForeignKeyViolation);
    });

    it('should refuse deleting a service or team an incident references, keeping the incident', async () => {
      const { acme, user, acmePayments, acmePlatform, acmeService } =
        await twoTenants();
      // The service is later moved to Platform, so Payments is referenced by
      // the incident alone.
      const incident = await anIncident({
        organizationId: acme.id,
        serviceId: acmeService.id,
        teamId: acmePayments.id,
        createdById: user.id,
      });
      await prisma.service.update({
        where: { id: acmeService.id },
        data: { ownerTeamId: acmePlatform.id },
      });

      await expect(
        prisma.$executeRawUnsafe(
          'DELETE FROM services WHERE id = $1::uuid',
          acmeService.id,
        ),
      ).rejects.toSatisfy(isForeignKeyViolation);
      await expect(
        prisma.$executeRawUnsafe(
          'DELETE FROM teams WHERE id = $1::uuid',
          acmePayments.id,
        ),
      ).rejects.toSatisfy(isForeignKeyViolation);

      expect(
        await prisma.incident.findUniqueOrThrow({ where: { id: incident.id } }),
      ).toEqual(expect.objectContaining({ teamId: acmePayments.id }));
    });

    it('should declare the service and team keys RESTRICT on delete and on update', async () => {
      const keys = await prisma.$queryRawUnsafe<
        { conname: string; confdeltype: string; confupdtype: string }[]
      >(
        `SELECT conname, confdeltype::text AS confdeltype, confupdtype::text AS confupdtype
         FROM pg_constraint
         WHERE conname IN (
           'incidents_organization_id_service_id_fkey',
           'incidents_organization_id_team_id_fkey',
           'incidents_created_by_id_fkey'
         )
         ORDER BY conname`,
      );

      expect(keys).toEqual([
        {
          conname: 'incidents_created_by_id_fkey',
          confdeltype: 'r',
          confupdtype: 'c',
        },
        {
          conname: 'incidents_organization_id_service_id_fkey',
          confdeltype: 'r',
          confupdtype: 'r',
        },
        {
          conname: 'incidents_organization_id_team_id_fkey',
          confdeltype: 'r',
          confupdtype: 'r',
        },
      ]);
    });

    it('should keep incidents when their creator is soft deleted, and refuse physically deleting the creator', async () => {
      const { acme, user, acmePayments, acmeService } = await twoTenants();
      await anIncident({
        organizationId: acme.id,
        serviceId: acmeService.id,
        teamId: acmePayments.id,
        createdById: user.id,
      });

      await prisma.user.update({
        where: { id: user.id },
        data: { deletedAt: new Date() },
      });
      await expect(
        prisma.$executeRawUnsafe(
          'DELETE FROM users WHERE id = $1::uuid',
          user.id,
        ),
      ).rejects.toSatisfy(isForeignKeyViolation);

      expect(await prisma.incident.count()).toBe(1);
    });

    it("should keep incidents when their creator's membership is removed", async () => {
      const { acme, user, acmePayments, acmeService } = await twoTenants();
      const membership = await prisma.membership.create({
        data: { organizationId: acme.id, userId: user.id },
      });
      await anIncident({
        organizationId: acme.id,
        serviceId: acmeService.id,
        teamId: acmePayments.id,
        createdById: user.id,
      });

      await prisma.membership.delete({ where: { id: membership.id } });

      expect((await prisma.incident.findFirstOrThrow()).createdById).toBe(
        user.id,
      );
    });

    it('should allow the same number in two organizations but not twice in one', async () => {
      const {
        acme,
        globex,
        user,
        acmePayments,
        acmeService,
        globexService,
        globexPayments,
      } = await twoTenants();
      await anIncident({
        organizationId: acme.id,
        serviceId: acmeService.id,
        teamId: acmePayments.id,
        createdById: user.id,
      });
      await anIncident({
        organizationId: globex.id,
        serviceId: globexService.id,
        teamId: globexPayments.id,
        createdById: user.id,
      });

      await expect(
        anIncident({
          organizationId: acme.id,
          serviceId: acmeService.id,
          teamId: acmePayments.id,
          createdById: user.id,
        }),
      ).rejects.toSatisfy(isUniqueViolation);
    });

    it('should refuse a non-positive number', async () => {
      const { acme, user, acmePayments, acmeService } = await twoTenants();

      await expect(
        prisma.$executeRawUnsafe(
          insertIncidentSql,
          acme.id,
          0,
          acmeService.id,
          acmePayments.id,
          user.id,
        ),
      ).rejects.toSatisfy(isRefusedBy('23514'));
    });

    it('should refuse RESOLVED without a resolution time, and a resolution time without RESOLVED', async () => {
      const { acme, user, acmePayments, acmeService } = await twoTenants();
      const incident = await anIncident({
        organizationId: acme.id,
        serviceId: acmeService.id,
        teamId: acmePayments.id,
        createdById: user.id,
      });

      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE incidents SET status = 'RESOLVED' WHERE id = $1::uuid`,
          incident.id,
        ),
      ).rejects.toSatisfy(isRefusedBy('23514'));
      await expect(
        prisma.$executeRawUnsafe(
          'UPDATE incidents SET resolved_at = now() WHERE id = $1::uuid',
          incident.id,
        ),
      ).rejects.toSatisfy(isRefusedBy('23514'));

      // Both together are what the check permits.
      await prisma.$executeRawUnsafe(
        `UPDATE incidents SET status = 'RESOLVED', resolved_at = now() WHERE id = $1::uuid`,
        incident.id,
      );
      expect(
        (
          await prisma.incident.findUniqueOrThrow({
            where: { id: incident.id },
          })
        ).status,
      ).toBe('RESOLVED');
    });

    it('should refuse a severity or status outside the enums at the database level', async () => {
      const { acme, user, acmePayments, acmeService } = await twoTenants();

      await expect(
        prisma.$executeRawUnsafe(
          insertIncidentSql.replace("'SEV1'", "'SEV0'"),
          acme.id,
          1,
          acmeService.id,
          acmePayments.id,
          user.id,
        ),
      ).rejects.toSatisfy(isRefusedBy('22P02'));

      const incident = await anIncident({
        organizationId: acme.id,
        serviceId: acmeService.id,
        teamId: acmePayments.id,
        createdById: user.id,
      });

      await expect(
        prisma.$executeRawUnsafe(
          `UPDATE incidents SET status = 'OPEN' WHERE id = $1::uuid`,
          incident.id,
        ),
      ).rejects.toSatisfy(isRefusedBy('22P02'));
    });

    describe('lead and responders', () => {
      /** An incident in each tenant, and the user's membership in each. */
      const assigned = async () => {
        const tenants = await twoTenants();
        const { acme, globex, user, acmePayments, acmeService } = tenants;
        const grant = (organizationId: string) =>
          prisma.membership.create({
            data: { organizationId, userId: user.id },
          });

        return {
          ...tenants,
          acmeMember: await grant(acme.id),
          globexMember: await grant(globex.id),
          incident: await anIncident({
            organizationId: acme.id,
            serviceId: acmeService.id,
            teamId: acmePayments.id,
            createdById: user.id,
          }),
        };
      };

      // Restrict keys into memberships, and the organization cascade deletes
      // memberships, incidents, and responders in one statement. Postgres
      // must still complete it.
      it("should remove an organization's incidents with their lead and responders when it is physically deleted", async () => {
        const { acme, globex, acmeMember, incident } = await assigned();
        await prisma.incident.update({
          where: { id: incident.id },
          data: { leadMembershipId: acmeMember.id },
        });
        await prisma.incidentResponder.create({
          data: {
            organizationId: acme.id,
            incidentId: incident.id,
            membershipId: acmeMember.id,
          },
        });

        await prisma.$executeRawUnsafe(
          'DELETE FROM organizations WHERE id = $1::uuid',
          acme.id,
        );

        expect(await prisma.incident.count()).toBe(0);
        expect(await prisma.incidentResponder.count()).toBe(0);
        expect(
          await prisma.membership.count({
            where: { organizationId: globex.id },
          }),
        ).toBe(1);
      });

      it("should reject another organization's membership as lead", async () => {
        const { globexMember, incident } = await assigned();

        await expect(
          prisma.incident.update({
            where: { id: incident.id },
            data: { leadMembershipId: globexMember.id },
          }),
        ).rejects.toSatisfy(isForeignKeyViolation);
      });

      it("should reject another organization's membership as responder, whichever organization the row claims", async () => {
        const { acme, globex, globexMember, incident } = await assigned();

        for (const organizationId of [acme.id, globex.id]) {
          await expect(
            prisma.incidentResponder.create({
              data: {
                organizationId,
                incidentId: incident.id,
                membershipId: globexMember.id,
              },
            }),
          ).rejects.toSatisfy(isForeignKeyViolation);
        }
      });

      it('should reject the same responder twice on one incident', async () => {
        const { acme, acmeMember, incident } = await assigned();
        const respond = () =>
          prisma.incidentResponder.create({
            data: {
              organizationId: acme.id,
              incidentId: incident.id,
              membershipId: acmeMember.id,
            },
          });

        await respond();

        await expect(respond()).rejects.toSatisfy(
          (error) => codeOf(error) === 'P2002',
        );
      });

      it('should refuse deleting a membership that leads or responds to an incident', async () => {
        const { acme, acmeMember, incident } = await assigned();
        await prisma.incident.update({
          where: { id: incident.id },
          data: { leadMembershipId: acmeMember.id },
        });

        await expect(
          prisma.membership.delete({ where: { id: acmeMember.id } }),
        ).rejects.toSatisfy(isForeignKeyViolation);

        await prisma.incident.update({
          where: { id: incident.id },
          data: { leadMembershipId: null },
        });
        await prisma.incidentResponder.create({
          data: {
            organizationId: acme.id,
            incidentId: incident.id,
            membershipId: acmeMember.id,
          },
        });

        await expect(
          prisma.membership.delete({ where: { id: acmeMember.id } }),
        ).rejects.toSatisfy(isForeignKeyViolation);
      });
    });
  });

  describe('the role enum', () => {
    it('should default a membership to MEMBER', async () => {
      const organization = await anOrganization('acme');
      const user = await aUser('ada@example.com');

      const membership = await prisma.membership.create({
        data: { organizationId: organization.id, userId: user.id },
      });

      expect(membership.role).toBe('MEMBER');
    });

    it.each([['OWNER'], ['ADMIN'], ['MEMBER']] as const)(
      'should round-trip %s',
      async (role) => {
        const organization = await anOrganization(`acme-${role.toLowerCase()}`);
        const user = await aUser(`${role.toLowerCase()}@example.com`);

        const membership = await prisma.membership.create({
          data: { organizationId: organization.id, userId: user.id, role },
        });

        expect(membership.role).toBe(role);
      },
    );

    it('should reject a value outside the enum at the database level', async () => {
      const organization = await anOrganization('acme');
      const user = await aUser('ada@example.com');

      // Raw SQL, because the generated client makes this unrepresentable in
      // TypeScript — which is the point: the constraint is enforced by Postgres,
      // not only by the type system.
      await expect(
        prisma.$executeRawUnsafe(
          `INSERT INTO memberships (id, organization_id, user_id, role, created_at, updated_at)
           VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'SUPERUSER', now(), now())`,
          organization.id,
          user.id,
        ),
      ).rejects.toThrow();
    });
  });

  describe('timestamps', () => {
    it('should store every timestamp as timestamptz', async () => {
      const columns = await prisma.$queryRawUnsafe<
        { column_name: string; data_type: string }[]
      >(
        `SELECT column_name, data_type FROM information_schema.columns
         WHERE table_schema = 'public'
           AND column_name IN (
             'created_at', 'updated_at', 'deleted_at', 'expires_at',
             'revoked_at', 'accepted_at', 'archived_at', 'resolved_at'
           )`,
      );

      // organizations, users, memberships: created_at/updated_at each (6),
      // plus deleted_at on organizations and users (2). refresh_tokens adds
      // created_at, expires_at, and revoked_at (3) and has no updated_at,
      // because a credential is issued and revoked rather than edited.
      // invitations adds created_at, updated_at, expires_at, accepted_at, and
      // revoked_at (5). teams adds created_at and updated_at (2), and
      // team_memberships only created_at (1): a placement is made or removed,
      // never edited. services adds created_at, updated_at, and archived_at
      // (3); incidents adds created_at, updated_at, and resolved_at (3), and
      // incident_responders only created_at (1), like team_memberships.
      expect(columns).toHaveLength(26);
      for (const column of columns) {
        expect(column.data_type).toBe('timestamp with time zone');
      }
    });

    it('should populate createdAt and updatedAt on insert', async () => {
      const organization = await anOrganization('acme');

      expect(organization.createdAt).toBeInstanceOf(Date);
      expect(organization.updatedAt).toBeInstanceOf(Date);
    });

    it('should advance updatedAt on update but leave createdAt alone', async () => {
      const organization = await anOrganization('acme');

      await new Promise((resolve) => setTimeout(resolve, 5));

      const updated = await prisma.organization.update({
        where: { id: organization.id },
        data: { name: 'Acme Corporation' },
      });

      expect(updated.updatedAt.getTime()).toBeGreaterThan(
        organization.updatedAt.getTime(),
      );
      expect(updated.createdAt.getTime()).toBe(
        organization.createdAt.getTime(),
      );
    });
  });
});
