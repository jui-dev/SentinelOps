-- A member's responses are read most recently started first.
--
-- The membership index gains started_at, so a page of one member's
-- responses is one range read. Its leading column still serves the Restrict
-- check when a membership is deleted, so it replaces the old index rather
-- than joining it.

-- DropIndex
DROP INDEX "incident_responders_membership_id_idx";

-- CreateIndex
CREATE INDEX "incident_responders_membership_id_started_at_idx" ON "incident_responders"("membership_id", "started_at");
