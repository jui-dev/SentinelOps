-- The activity log: the Admin's record of every change to the organization's
-- setup and every sign-in to a member's account.
--
--   * Entries are permanent. The application only inserts them, and the
--     trigger below refuses any UPDATE, so an entry cannot be rewritten even
--     by a mistake in the code. Removing the organization still takes its log
--     with it (DELETE, by the cascade).
--   * Names are snapshots taken when it happened, so subject_id is not a
--     foreign key: the subject may be deleted and its entries must stay.
--   * The actor is kept with ON DELETE RESTRICT, as incident activity is.

-- CreateEnum
CREATE TYPE "activity_area" AS ENUM ('PEOPLE', 'TEAMS', 'SERVICES', 'KNOWN_ISSUES', 'ORGANIZATION', 'SECURITY');

-- CreateEnum
CREATE TYPE "activity_action" AS ENUM ('MEMBER_ADDED', 'ROLE_CHANGED', 'PASSWORD_RESET', 'INVITATION_SENT', 'INVITATION_REVOKED', 'INVITATION_ACCEPTED', 'TEAM_CREATED', 'TEAM_UPDATED', 'TEAM_DELETED', 'TEAM_MEMBER_ADDED', 'TEAM_MEMBER_REMOVED', 'SERVICE_CREATED', 'SERVICE_UPDATED', 'SERVICE_DELETED', 'KNOWN_ISSUE_CREATED', 'KNOWN_ISSUE_UPDATED', 'KNOWN_ISSUE_MERGED', 'ORGANIZATION_UPDATED', 'SIGNED_IN', 'SIGN_IN_FAILED', 'SIGN_IN_BLOCKED', 'PASSWORD_CHANGED');

-- CreateEnum
CREATE TYPE "activity_subject_type" AS ENUM ('MEMBERSHIP', 'INVITATION', 'TEAM', 'SERVICE', 'KNOWN_ISSUE', 'ORGANIZATION');

-- CreateTable
CREATE TABLE "activity_entries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "action" "activity_action" NOT NULL,
    "area" "activity_area" NOT NULL,
    "actor_id" UUID NOT NULL,
    "actor_name" TEXT NOT NULL,
    "subject_type" "activity_subject_type",
    "subject_id" UUID,
    "subject_name" TEXT,
    "changes" JSONB NOT NULL DEFAULT '[]',
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activity_entries_organization_id_created_at_idx" ON "activity_entries"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "activity_entries_organization_id_area_created_at_idx" ON "activity_entries"("organization_id", "area", "created_at");

-- CreateIndex
CREATE INDEX "activity_entries_organization_id_actor_id_created_at_idx" ON "activity_entries"("organization_id", "actor_id", "created_at");

-- CreateIndex
CREATE INDEX "activity_entries_organization_id_subject_id_created_at_idx" ON "activity_entries"("organization_id", "subject_id", "created_at");

-- CreateIndex
CREATE INDEX "activity_entries_actor_id_idx" ON "activity_entries"("actor_id");

-- AddForeignKey
ALTER TABLE "activity_entries" ADD CONSTRAINT "activity_entries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_entries" ADD CONSTRAINT "activity_entries_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- An entry, once written, is never changed.
CREATE FUNCTION "activity_entries_refuse_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'activity_entries are permanent and cannot be updated'
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE TRIGGER "activity_entries_no_update"
BEFORE UPDATE ON "activity_entries"
FOR EACH ROW EXECUTE FUNCTION "activity_entries_refuse_update"();
