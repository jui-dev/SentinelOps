-- Incident analysis: what the organization learned from one resolved
-- incident, written by one owner, drafted and then published.
--
--   * incident_analyses holds only what people write — summary, impact,
--     cause, lessons — and who owns, started, and published it. Everything
--     the incident already records is read from the incident, which is final
--     once resolved; nothing is copied.
--   * One analysis per incident, by the unique (organization_id, incident_id).
--     The key into incidents is composite on that same organization_id, so an
--     incident has exactly one organization and this is uniqueness per
--     incident. Only a resolved incident may have one: that rule spans two
--     tables and is the service's, and RESOLVED being terminal keeps it true.
--   * The owner is a membership, through a composite key on the shared
--     organization_id, Restrict like the responder key. Who started and who
--     published it are users, Restrict like every attribution key.
--   * A plain key to organizations cascades, so a physical deletion of the
--     organization removes analyses in the same statement as memberships,
--     before the owner key's Restrict check could refuse it.
--   * version identifies one state of the row: every write names the version
--     it read and increments it.

-- CreateEnum
CREATE TYPE "incident_analysis_status" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateTable
CREATE TABLE "incident_analyses" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "incident_id" UUID NOT NULL,
    "status" "incident_analysis_status" NOT NULL DEFAULT 'DRAFT',
    "owner_membership_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "summary" TEXT,
    "impact" TEXT,
    "cause" TEXT,
    "lessons" TEXT,
    "created_by_id" UUID NOT NULL,
    "published_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "published_at" TIMESTAMPTZ(3),

    CONSTRAINT "incident_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "incident_analyses_organization_id_owner_membership_id_idx" ON "incident_analyses"("organization_id", "owner_membership_id");

-- CreateIndex
CREATE INDEX "incident_analyses_created_by_id_idx" ON "incident_analyses"("created_by_id");

-- CreateIndex
CREATE INDEX "incident_analyses_published_by_id_idx" ON "incident_analyses"("published_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "incident_analyses_organization_id_incident_id_key" ON "incident_analyses"("organization_id", "incident_id");

-- AddForeignKey
ALTER TABLE "incident_analyses" ADD CONSTRAINT "incident_analyses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_analyses" ADD CONSTRAINT "incident_analyses_organization_id_incident_id_fkey" FOREIGN KEY ("organization_id", "incident_id") REFERENCES "incidents"("organization_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "incident_analyses" ADD CONSTRAINT "incident_analyses_organization_id_owner_membership_id_fkey" FOREIGN KEY ("organization_id", "owner_membership_id") REFERENCES "memberships"("organization_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "incident_analyses" ADD CONSTRAINT "incident_analyses_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incident_analyses" ADD CONSTRAINT "incident_analyses_published_by_id_fkey" FOREIGN KEY ("published_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Hand-written below this line. Prisma cannot declare CHECK constraints, and
-- does not treat them as drift, so they live here. schema.integration-spec.ts
-- pins them.

-- Published exactly when it records who published it and when; a draft
-- records neither.
ALTER TABLE "incident_analyses" ADD CONSTRAINT "incident_analyses_publication" CHECK (
    ("status" = 'PUBLISHED' AND "published_at" IS NOT NULL AND "published_by_id" IS NOT NULL)
    OR ("status" = 'DRAFT' AND "published_at" IS NULL AND "published_by_id" IS NULL)
);

-- A published analysis has a summary, and needs nothing else: impact, cause,
-- and lessons may honestly be unknown, and none is demanded, so none is
-- invented to satisfy a constraint.
ALTER TABLE "incident_analyses" ADD CONSTRAINT "incident_analyses_published_summary" CHECK ("status" = 'DRAFT' OR "summary" IS NOT NULL);

-- Every write increments version from where it was read, starting at 1.
ALTER TABLE "incident_analyses" ADD CONSTRAINT "incident_analyses_version_positive" CHECK ("version" >= 1);
