-- OWNER held exactly what ADMIN held, so it is merged into ADMIN.
--
-- Postgres cannot remove a value from an enum, so the type is replaced: every
-- OWNER becomes ADMIN first, then both columns are moved to a new two-value
-- type and the old one is dropped. The cast would fail on any row still
-- holding OWNER, so the UPDATEs are what make it safe, not a formality.

-- Data
UPDATE "memberships" SET "role" = 'ADMIN' WHERE "role" = 'OWNER';

-- Invitations refuse OWNER at the request boundary, so none should exist.
-- Updated anyway: the cast below would otherwise abort the migration.
UPDATE "invitations" SET "role" = 'ADMIN' WHERE "role" = 'OWNER';

-- Type
CREATE TYPE "role_new" AS ENUM ('ADMIN', 'MEMBER');

ALTER TABLE "memberships" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "memberships" ALTER COLUMN "role" TYPE "role_new" USING ("role"::text::"role_new");
ALTER TABLE "invitations" ALTER COLUMN "role" TYPE "role_new" USING ("role"::text::"role_new");

DROP TYPE "role";
ALTER TYPE "role_new" RENAME TO "role";

ALTER TABLE "memberships" ALTER COLUMN "role" SET DEFAULT 'MEMBER';
