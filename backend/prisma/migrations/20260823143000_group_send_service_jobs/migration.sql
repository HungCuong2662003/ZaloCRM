ALTER TABLE "group_send_jobs"
  ADD COLUMN "source_type" TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN "service_next_index" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "service_last_category" TEXT,
  ADD COLUMN "service_last_posted_at" TIMESTAMP(3);

ALTER TABLE "group_send_job_logs"
  ADD COLUMN "category" TEXT;

CREATE INDEX "group_send_jobs_org_id_source_type_idx" ON "group_send_jobs"("org_id", "source_type");
