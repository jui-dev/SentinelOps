-- Two notifications for who may respond to an incident: its team told the
-- Admin opened it to them, and a member told they were assigned to it.
--
-- Only the enum here: Postgres refuses a new enum value inside the
-- transaction that adds it, so the CHECK constraint that names these values
-- is rewritten in the next migration.

-- AlterEnum
ALTER TYPE "notification_type" ADD VALUE 'INCIDENT_OPENED_TO_TEAM' BEFORE 'TEAM_MEMBERSHIP_ADDED';
ALTER TYPE "notification_type" ADD VALUE 'INCIDENT_ASSIGNED' BEFORE 'TEAM_MEMBERSHIP_ADDED';
