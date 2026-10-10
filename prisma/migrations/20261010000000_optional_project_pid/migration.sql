-- Preserve existing IDs, records and the unique constraint for non-null IDs.
-- PostgreSQL permits multiple NULL values in the existing unique index.
ALTER TABLE "Project" ALTER COLUMN "pid" DROP NOT NULL;
