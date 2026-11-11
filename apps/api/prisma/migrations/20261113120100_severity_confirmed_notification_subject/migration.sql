-- Hand-written. The type added in the previous migration names the timeline
-- entry of the confirmation it reports, like every incident type, so the
-- subject constraint lists it with the others. schema.integration-spec.ts
-- pins it.
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_subject_matches_type";

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_subject_matches_type" CHECK (
    ("type" IN ('INCIDENT_DECLARED', 'INCIDENT_REASSIGNED', 'INCIDENT_SEVERITY_CHANGED', 'INCIDENT_RESOLVED', 'INCIDENT_READY_TO_RESOLVE', 'INCIDENT_OPENED_TO_TEAM', 'INCIDENT_ASSIGNED', 'INCIDENT_SEVERITY_CONFIRMED')
        AND "activity_id" IS NOT NULL AND "team_id" IS NULL)
    OR ("type" IN ('TEAM_MEMBERSHIP_ADDED', 'TEAM_MEMBERSHIP_REMOVED')
        AND "team_id" IS NOT NULL AND "activity_id" IS NULL)
);
