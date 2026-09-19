-- CreateIndex
CREATE INDEX "incidents_organization_id_created_at_idx" ON "incidents"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "incidents_organization_id_resolved_at_idx" ON "incidents"("organization_id", "resolved_at");
