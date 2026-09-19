-- Incident response becomes team-based.
--
-- The members of an incident's responsible team respond to it: each starts
-- investigating, posts updates, and marks their own response complete. The
-- Admin resolves the incident once no responder is still investigating.
--
--   * incidents.lead_membership_id goes. A lead was named by the Admin from
--     any team, carried no authority, and could conflict with the responsible
--     team.
--   * incident_responders stays, and changes meaning: a row is no longer an
--     Admin's assignment of someone from any team, but a member's own
--     response, created when they start investigating. Existing rows are
--     assignments, which say nothing about who investigated, so they are
--     deleted rather than converted. None was ever on the timeline, so no
--     history is lost from it.
--   * A response has a status, INVESTIGATING or COMPLETED, and the time it was
--     completed. The row's creation time is when it started, so created_at is
--     renamed started_at. A member who has not started has no row.
--   * The timeline records a reassignment of the responsible team, which
--     changes who may start investigating, and each response starting and
--     completing.
--
-- ADD VALUE commits with this migration and is not used within it.

-- AlterEnum
ALTER TYPE "incident_activity_type" ADD VALUE 'TEAM_CHANGED';
ALTER TYPE "incident_activity_type" ADD VALUE 'RESPONSE_STARTED';
ALTER TYPE "incident_activity_type" ADD VALUE 'RESPONSE_COMPLETED';

-- CreateEnum
CREATE TYPE "incident_responder_status" AS ENUM ('INVESTIGATING', 'COMPLETED');

-- DropForeignKey
ALTER TABLE "incidents" DROP CONSTRAINT "incidents_organization_id_lead_membership_id_fkey";

-- DropIndex
DROP INDEX "incidents_organization_id_lead_membership_id_idx";

-- AlterTable
ALTER TABLE "incidents" DROP COLUMN "lead_membership_id";

-- Data: assignments are not responses.
DELETE FROM "incident_responders";

-- AlterTable. Its composite keys, unique index, and membership index are
-- unchanged.
ALTER TABLE "incident_responders" RENAME COLUMN "created_at" TO "started_at";
ALTER TABLE "incident_responders"
    ADD COLUMN "status" "incident_responder_status" NOT NULL DEFAULT 'INVESTIGATING',
    ADD COLUMN "completed_at" TIMESTAMPTZ(3);

-- A plain key to the organization, which cascades, as incidents have. A
-- physical deletion of the organization otherwise reaches responders only
-- through incidents, one cascade after memberships, whose Restrict check then
-- finds them still there and refuses the deletion.

-- CreateIndex
CREATE INDEX "incident_responders_organization_id_idx" ON "incident_responders"("organization_id");

-- AddForeignKey
ALTER TABLE "incident_responders" ADD CONSTRAINT "incident_responders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written below this line. Prisma cannot declare CHECK constraints, and
-- does not treat them as drift, so it lives here. schema.integration-spec.ts
-- pins it.

-- A response is COMPLETED exactly when it has a completion time. The API sets
-- both in one write; this refuses any other writer that sets only one.
ALTER TABLE "incident_responders" ADD CONSTRAINT "incident_responders_completion_consistent" CHECK (("status" = 'COMPLETED') = ("completed_at" IS NOT NULL));
