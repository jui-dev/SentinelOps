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
      'TRUNCATE TABLE memberships, users, organizations RESTART IDENTITY CASCADE',
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
           AND table_name IN ('organizations', 'users', 'memberships')
         ORDER BY table_name`,
      );

      expect(columns).toHaveLength(3);
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
             'created_at', 'updated_at', 'deleted_at', 'expires_at', 'revoked_at'
           )`,
      );

      // organizations, users, memberships: created_at/updated_at each (6),
      // plus deleted_at on organizations and users (2). refresh_tokens adds
      // created_at, expires_at, and revoked_at (3) and has no updated_at,
      // because a credential is issued and revoked rather than edited.
      expect(columns).toHaveLength(11);
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
