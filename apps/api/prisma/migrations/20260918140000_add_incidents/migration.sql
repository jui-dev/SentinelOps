-- CreateEnum
CREATE TYPE "incident_severity" AS ENUM ('SEV1', 'SEV2', 'SEV3', 'SEV4');

-- CreateEnum
CREATE TYPE "incident_status" AS ENUM ('INVESTIGATING', 'IDENTIFIED', 'MONITORING', 'RESOLVED');

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "last_incident_number" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "services" ADD COLUMN     "archived_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "incidents" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "service_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "severity" "incident_severity" NOT NULL,
    "status" "incident_status" NOT NULL DEFAULT 'INVESTIGATING',
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "resolved_at" TIMESTAMPTZ(3),

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "incidents_organization_id_service_id_idx" ON "incidents"("organization_id", "service_id");

-- CreateIndex
CREATE INDEX "incidents_organization_id_team_id_idx" ON "incidents"("organization_id", "team_id");

-- CreateIndex
CREATE INDEX "incidents_created_by_id_idx" ON "incidents"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "incidents_organization_id_number_key" ON "incidents"("organization_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "incidents_organization_id_id_key" ON "incidents"("organization_id", "id");

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_organization_id_service_id_fkey" FOREIGN KEY ("organization_id", "service_id") REFERENCES "services"("organization_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_organization_id_team_id_fkey" FOREIGN KEY ("organization_id", "team_id") REFERENCES "teams"("organization_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hand-written below this line. Prisma cannot declare CHECK constraints, and
-- does not treat them as drift, so they live here. schema.integration-spec.ts
-- pins both.

-- An incident is RESOLVED exactly when it has a resolution time. The API sets
-- both in one write; this refuses any other writer that sets only one.
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_resolution_consistent" CHECK (("status" = 'RESOLVED') = ("resolved_at" IS NOT NULL));

-- Numbers are allocated from organizations.last_incident_number, which starts
-- at 0 and is incremented before use.
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_number_positive" CHECK ("number" > 0);
