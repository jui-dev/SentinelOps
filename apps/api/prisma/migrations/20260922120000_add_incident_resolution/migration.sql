-- Resolving an incident records how it ended.
--
--   * incidents.resolution holds the Admin's note, required by every
--     resolution from now on. The same note is the message of the
--     resolution's timeline entry (STATUS_CHANGED to RESOLVED), written in the
--     same transaction.
--   * Incidents resolved before this migration keep a null resolution. Nobody
--     wrote a note for them, and none is invented.

-- AlterTable
ALTER TABLE "incidents" ADD COLUMN "resolution" TEXT;

-- Hand-written below this line. Prisma cannot declare CHECK constraints, and
-- does not treat them as drift.

-- Only a resolved incident carries a resolution. The converse cannot be a
-- constraint: incidents resolved before notes were required have none.
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_resolution_only_when_resolved" CHECK ("resolution" IS NULL OR "status" = 'RESOLVED');
