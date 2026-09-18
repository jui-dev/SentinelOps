-- CreateEnum
CREATE TYPE "incident_activity_type" AS ENUM ('DECLARED', 'UPDATE', 'SEVERITY_CHANGED', 'STATUS_CHANGED');

-- CreateTable
CREATE TABLE "incident_activities" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "incident_id" UUID NOT NULL,
    "type" "incident_activity_type" NOT NULL,
    "actor_id" UUID NOT NULL,
    "message" TEXT,
    "from_value" TEXT,
    "to_value" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_activities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "incident_activities_incident_id_created_at_idx" ON "incident_activities"("incident_id", "created_at");

-- CreateIndex
CREATE INDEX "incident_activities_actor_id_idx" ON "incident_activities"("actor_id");

-- AddForeignKey
ALTER TABLE "incident_activities" ADD CONSTRAINT "incident_activities_organization_id_incident_id_fkey" FOREIGN KEY ("organization_id", "incident_id") REFERENCES "incidents"("organization_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "incident_activities" ADD CONSTRAINT "incident_activities_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
