-- Roles named for the job each does in an incident: ADMIN, INCIDENT_MANAGER,
-- REPORTER and RESPONDER.
--
-- MEMBER is renamed in place rather than replaced, so every existing member
-- becomes a responder — the work they could already do — and no row is
-- rewritten. The two new values are added before it, keeping the enum in the
-- order an incident needs them after the admin. Neither new value is used in
-- this migration, which Postgres requires of a value added in a transaction.

-- AlterEnum
ALTER TYPE "role" RENAME VALUE 'MEMBER' TO 'RESPONDER';
ALTER TYPE "role" ADD VALUE 'INCIDENT_MANAGER' BEFORE 'RESPONDER';
ALTER TYPE "role" ADD VALUE 'REPORTER' BEFORE 'RESPONDER';

-- AlterTable
ALTER TABLE "memberships" ALTER COLUMN "role" SET DEFAULT 'RESPONDER';
