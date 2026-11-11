-- A Reporter declares with a suggested severity, which whoever decides on
-- incidents confirms. Every incident until now was declared by someone who
-- decides, so its severity is confirmed: the column defaults to true.
--
-- Only the enums here: Postgres refuses a new enum value inside the
-- transaction that adds it, so the CHECK constraint that names the new
-- notification type is rewritten in the next migration.

-- AlterTable
ALTER TABLE "incidents" ADD COLUMN "severity_confirmed" BOOLEAN NOT NULL DEFAULT true;

-- AlterEnum
ALTER TYPE "incident_activity_type" ADD VALUE 'SEVERITY_CONFIRMED';

-- AlterEnum
ALTER TYPE "notification_type" ADD VALUE 'INCIDENT_SEVERITY_CONFIRMED' BEFORE 'TEAM_MEMBERSHIP_ADDED';
