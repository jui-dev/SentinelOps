-- The overview counts who is investigating now: the organization's
-- INVESTIGATING responder rows and nothing else. Status joins the existing
-- organization index as its second column rather than becoming a second
-- index, so the cascade from organizations is still served by the leading
-- column.

-- DropIndex
DROP INDEX "incident_responders_organization_id_idx";

-- CreateIndex
CREATE INDEX "incident_responders_organization_id_status_idx" ON "incident_responders"("organization_id", "status");
