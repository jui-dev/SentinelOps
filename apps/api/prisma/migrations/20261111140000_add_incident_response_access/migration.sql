-- Who may respond to an incident: nobody until the Admin chooses, its whole
-- responsible team, or only the people assigned.
CREATE TYPE "incident_response_access" AS ENUM ('PENDING', 'OPEN', 'ASSIGNED');

-- The choice, as a timeline entry.
ALTER TYPE "incident_activity_type" ADD VALUE 'RESPONSE_ACCESS_CHANGED';

-- Every incident that exists already was open to its team, and stays so.
ALTER TABLE "incidents" ADD COLUMN "response_access" "incident_response_access" NOT NULL DEFAULT 'OPEN';

CREATE TABLE "incident_assignees" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "incident_id" UUID NOT NULL,
    "membership_id" UUID NOT NULL,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_assignees_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "incident_assignees_organization_id_idx" ON "incident_assignees"("organization_id");
CREATE INDEX "incident_assignees_membership_id_idx" ON "incident_assignees"("membership_id");
CREATE UNIQUE INDEX "incident_assignees_incident_id_membership_id_key" ON "incident_assignees"("incident_id", "membership_id");

ALTER TABLE "incident_assignees" ADD CONSTRAINT "incident_assignees_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "incident_assignees" ADD CONSTRAINT "incident_assignees_organization_id_incident_id_fkey" FOREIGN KEY ("organization_id", "incident_id") REFERENCES "incidents"("organization_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;
ALTER TABLE "incident_assignees" ADD CONSTRAINT "incident_assignees_organization_id_membership_id_fkey" FOREIGN KEY ("organization_id", "membership_id") REFERENCES "memberships"("organization_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;
