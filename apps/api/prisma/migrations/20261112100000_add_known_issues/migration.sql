-- Known issues: the problems a service has had before, so the next time one
-- happens it can be declared by choosing it, and its repeats are counted.
--
--   * known_issues belong to one service, by a composite key on the shared
--     organization_id. A service with no incidents may be deleted and takes
--     its known issues along (Cascade); one with incidents cannot be.
--   * incidents.known_issue_id is optional. Its key is (organization_id,
--     service_id, known_issue_id), so an incident can only ever link to a
--     known issue of its own service. A NULL link is a one-off, and passes
--     the key as a composite key with a NULL column does. Restrict: a known
--     issue is removed only by a merge, which first moves its incidents.
--   * Every existing incident starts as a one-off.

-- AlterTable
ALTER TABLE "incidents" ADD COLUMN     "known_issue_id" UUID;

-- CreateTable
CREATE TABLE "known_issues" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "service_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "usual_severity" "incident_severity" NOT NULL,
    "pending_review" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "known_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "known_issues_organization_id_service_id_idx" ON "known_issues"("organization_id", "service_id");

-- CreateIndex
CREATE UNIQUE INDEX "known_issues_service_id_name_key" ON "known_issues"("service_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "known_issues_organization_id_id_key" ON "known_issues"("organization_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "known_issues_organization_id_service_id_id_key" ON "known_issues"("organization_id", "service_id", "id");

-- CreateIndex
CREATE INDEX "incidents_organization_id_known_issue_id_idx" ON "incidents"("organization_id", "known_issue_id");

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_organization_id_service_id_known_issue_id_fkey" FOREIGN KEY ("organization_id", "service_id", "known_issue_id") REFERENCES "known_issues"("organization_id", "service_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "known_issues" ADD CONSTRAINT "known_issues_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "known_issues" ADD CONSTRAINT "known_issues_organization_id_service_id_fkey" FOREIGN KEY ("organization_id", "service_id") REFERENCES "services"("organization_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;

