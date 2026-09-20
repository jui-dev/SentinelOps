-- The organization's operational activity: what was recorded across every
-- incident in a period of days.
--
-- The existing indexes serve one incident's timeline and the Restrict check
-- on a user, and neither answers "everything this organization recorded
-- between two dates" — that read would scan the table. This one serves it as
-- a single range scan, the same shape as the incidents_organization_id_
-- created_at_idx that already serves the overview's declared-in-a-period
-- count.

-- CreateIndex
CREATE INDEX "incident_activities_organization_id_created_at_idx" ON "incident_activities"("organization_id", "created_at");
