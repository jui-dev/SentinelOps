-- The incident lifecycle becomes DECLARED → INVESTIGATING → RESOLVED.
--
-- DECLARED is new: a declared incident is reported and visible, with no
-- investigation implied yet. IDENTIFIED and MONITORING are retired: a cause
-- found, or a fix being watched, is still investigation, and is said in an
-- operational update rather than a status.
--
-- Postgres cannot remove a value from an enum, so the type is replaced, as
-- 20260919120000_merge_owner_into_admin did for roles: every retired status
-- becomes INVESTIGATING first, then the column moves to a new three-value
-- type and the old one is dropped. The cast would fail on any row still
-- holding a retired status, so the UPDATE is what makes it safe.
--
-- Existing INVESTIGATING incidents stay INVESTIGATING — work was under way —
-- and are never moved back to DECLARED. RESOLVED incidents and their
-- resolved_at are untouched.
--
-- No timeline entry is written for the remap: every entry names the user who
-- acted, and none did. Timeline history is not rewritten either: from_value
-- and to_value are text, and an entry that says an incident moved to
-- MONITORING stays true of what happened then.

-- Data
UPDATE "incidents"
SET "status" = 'INVESTIGATING'
WHERE "status" IN ('IDENTIFIED', 'MONITORING');

-- Type. The resolution CHECK compares status with a literal of the old type,
-- so it is dropped around the change and added back unchanged.
CREATE TYPE "incident_status_new" AS ENUM ('DECLARED', 'INVESTIGATING', 'RESOLVED');

ALTER TABLE "incidents" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "incidents" DROP CONSTRAINT "incidents_resolution_consistent";
ALTER TABLE "incidents" ALTER COLUMN "status" TYPE "incident_status_new" USING ("status"::text::"incident_status_new");

DROP TYPE "incident_status";
ALTER TYPE "incident_status_new" RENAME TO "incident_status";

-- A newly declared incident starts DECLARED.
ALTER TABLE "incidents" ALTER COLUMN "status" SET DEFAULT 'DECLARED';

-- An incident is RESOLVED exactly when it has a resolution time.
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_resolution_consistent" CHECK (("status" = 'RESOLVED') = ("resolved_at" IS NOT NULL));
