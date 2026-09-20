-- One member's response activity: what a single actor wrote in this
-- organization over a period of days.
--
-- Neither existing index serves it. incident_activities_organization_id_
-- created_at_idx, added for the organization's activity, takes the date as
-- its second column rather than the actor. incident_activities_actor_id_idx
-- knows the actor but neither the organization nor the date, and it stays
-- where it is: the Restrict check when a user row is physically deleted
-- needs exactly that leading column.

-- CreateIndex
CREATE INDEX "incident_activities_organization_id_actor_id_created_at_idx" ON "incident_activities"("organization_id", "actor_id", "created_at");
