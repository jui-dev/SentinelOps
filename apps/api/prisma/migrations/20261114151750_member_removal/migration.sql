-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "activity_action" ADD VALUE 'MEMBER_REMOVED';
ALTER TYPE "activity_action" ADD VALUE 'MEMBER_RESTORED';

-- AlterTable
ALTER TABLE "memberships" ADD COLUMN     "removed_at" TIMESTAMPTZ(3),
ADD COLUMN     "removed_by_id" UUID;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_removed_by_id_fkey" FOREIGN KEY ("removed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-written. Prisma cannot declare it: who removed someone is recorded only
-- for a removal. schema.integration-spec.ts pins it.
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_removed_by_requires_removed_at"
    CHECK ("removed_by_id" IS NULL OR "removed_at" IS NOT NULL);
