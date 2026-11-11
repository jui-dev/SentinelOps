-- Which of an incident analysis's sections its writer has said are finished.
--
--   * Text alone never made a section finished: a draft holds work in
--     progress, so being done is said, and recorded, apart from the words.
--   * Empty for every existing analysis: nobody has said any section of them
--     is done, so what they hold reads as in progress.
--   * Whether a done section holds text is the service's to judge, on the
--     write that marks it; the CHECK keeps the list to the four section names.

-- AlterTable
ALTER TABLE "incident_analyses" ADD COLUMN "done_sections" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Hand-written: Prisma cannot declare CHECK constraints.
ALTER TABLE "incident_analyses" ADD CONSTRAINT "incident_analyses_done_sections_known" CHECK (
  "done_sections" <@ ARRAY['summary', 'impact', 'cause', 'lessons']::TEXT[]
);
