-- In-app notifications: one recipient's record that something relevant
-- happened, behind the notification bell.
--
--   * notifications is addressed to a membership, so a row belongs to one
--     organization by construction. Its keys into memberships, timeline
--     entries, and teams are composite on the shared organization_id, so none
--     of them can come from another organization however the row is written.
--     Each cascades on delete — revoking a membership removes its inbox,
--     deleting a team removes notifications about being placed on it — and is
--     Restrict on update, so nothing a notification names can move to another
--     organization carrying it along.
--   * incident_activities gains a unique (organization_id, id), redundant with
--     its primary key: the target the notifications' composite key needs.
--   * The unread index is partial: it holds only unread rows, which is what
--     the count and "mark read up to here" read.

-- CreateEnum
CREATE TYPE "notification_type" AS ENUM ('INCIDENT_DECLARED', 'INCIDENT_REASSIGNED', 'INCIDENT_SEVERITY_CHANGED', 'INCIDENT_RESOLVED', 'INCIDENT_READY_TO_RESOLVE', 'TEAM_MEMBERSHIP_ADDED', 'TEAM_MEMBERSHIP_REMOVED');

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "recipient_membership_id" UUID NOT NULL,
    "type" "notification_type" NOT NULL,
    "actor_id" UUID NOT NULL,
    "activity_id" UUID,
    "team_id" UUID,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_recipient_membership_id_created_at_id_idx" ON "notifications"("recipient_membership_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "notifications_unread_recipient_membership_id_created_at_idx" ON "notifications"("recipient_membership_id", "created_at") WHERE ("read_at" IS NULL);

-- CreateIndex
CREATE INDEX "notifications_organization_id_activity_id_idx" ON "notifications"("organization_id", "activity_id");

-- CreateIndex
CREATE INDEX "notifications_organization_id_team_id_idx" ON "notifications"("organization_id", "team_id");

-- CreateIndex
CREATE INDEX "notifications_actor_id_idx" ON "notifications"("actor_id");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_recipient_membership_id_activity_id_key" ON "notifications"("recipient_membership_id", "activity_id");

-- CreateIndex
CREATE UNIQUE INDEX "incident_activities_organization_id_id_key" ON "incident_activities"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_recipient_membership_id_fkey" FOREIGN KEY ("organization_id", "recipient_membership_id") REFERENCES "memberships"("organization_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_activity_id_fkey" FOREIGN KEY ("organization_id", "activity_id") REFERENCES "incident_activities"("organization_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_team_id_fkey" FOREIGN KEY ("organization_id", "team_id") REFERENCES "teams"("organization_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;


-- Hand-written below this line. Prisma cannot declare CHECK constraints, and
-- does not treat them as drift, so it lives here. schema.integration-spec.ts
-- pins it.

-- Each type names exactly its subject: an incident type the timeline entry
-- of the change it reports, a team type the team. Every type is listed, so a
-- value added to the enum is refused here until it is given a subject.
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_subject_matches_type" CHECK (
    ("type" IN ('INCIDENT_DECLARED', 'INCIDENT_REASSIGNED', 'INCIDENT_SEVERITY_CHANGED', 'INCIDENT_RESOLVED', 'INCIDENT_READY_TO_RESOLVE')
        AND "activity_id" IS NOT NULL AND "team_id" IS NULL)
    OR ("type" IN ('TEAM_MEMBERSHIP_ADDED', 'TEAM_MEMBERSHIP_REMOVED')
        AND "team_id" IS NOT NULL AND "activity_id" IS NULL)
);
