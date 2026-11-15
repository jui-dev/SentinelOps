-- CreateTable
CREATE TABLE "demo_workspaces" (
    "organization_id" UUID NOT NULL,
    "last_reset_at" TIMESTAMPTZ(3),
    "last_reset_by_id" UUID,
    "history_ends_at" TIMESTAMPTZ(3),

    CONSTRAINT "demo_workspaces_pkey" PRIMARY KEY ("organization_id")
);

-- AddForeignKey
ALTER TABLE "demo_workspaces" ADD CONSTRAINT "demo_workspaces_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demo_workspaces" ADD CONSTRAINT "demo_workspaces_last_reset_by_id_fkey" FOREIGN KEY ("last_reset_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
