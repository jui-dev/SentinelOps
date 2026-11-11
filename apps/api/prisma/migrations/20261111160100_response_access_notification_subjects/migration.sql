-- Hand-written. The two incident types added in the previous migration name
-- the timeline entry of the choice they report, like every incident type, so
-- the subject constraint lists them with the others. schema.integration-spec.ts
-- pins it.
ALTER TABLE "notifications" DROP CONSTRAINT "notifications_subject_matches_type";

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_subject_matches_type" CHECK (
    ("type" IN ('INCIDENT_DECLARED', 'INCIDENT_REASSIGNED', 'INCIDENT_SEVERITY_CHANGED', 'INCIDENT_RESOLVED', 'INCIDENT_READY_TO_RESOLVE', 'INCIDENT_OPENED_TO_TEAM', 'INCIDENT_ASSIGNED')
        AND "activity_id" IS NOT NULL AND "team_id" IS NULL)
    OR ("type" IN ('TEAM_MEMBERSHIP_ADDED', 'TEAM_MEMBERSHIP_REMOVED')
        AND "team_id" IS NOT NULL AND "activity_id" IS NULL)
);
