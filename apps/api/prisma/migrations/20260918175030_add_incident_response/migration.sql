-- AlterTable
ALTER TABLE "incidents" ADD COLUMN     "lead_membership_id" UUID;

-- CreateTable
CREATE TABLE "incident_responders" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "incident_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_responders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "incident_responders_membership_id_idx" ON "incident_responders"("membership_id");

-- CreateIndex
CREATE UNIQUE INDEX "incident_responders_incident_id_membership_id_key" ON "incident_responders"("incident_id", "membership_id");

-- CreateIndex
CREATE INDEX "incidents_organization_id_lead_membership_id_idx" ON "incidents"("organization_id", "lead_membership_id");

-- AddForeignKey
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_organization_id_lead_membership_id_fkey" FOREIGN KEY ("organization_id", "lead_membership_id") REFERENCES "memberships"("organization_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "incident_responders" ADD CONSTRAINT "incident_responders_organization_id_incident_id_fkey" FOREIGN KEY ("organization_id", "incident_id") REFERENCES "incidents"("organization_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "incident_responders" ADD CONSTRAINT "incident_responders_organization_id_membership_id_fkey" FOREIGN KEY ("organization_id", "membership_id") REFERENCES "memberships"("organization_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
