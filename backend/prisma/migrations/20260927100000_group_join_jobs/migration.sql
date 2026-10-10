CREATE TABLE "group_join_jobs" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "zalo_account_id" TEXT NOT NULL,
  "link_ids" JSONB NOT NULL,
  "max_per_day" INTEGER NOT NULL DEFAULT 20,
  "delay_min_ms" INTEGER NOT NULL DEFAULT 30000,
  "delay_max_ms" INTEGER NOT NULL DEFAULT 60000,
  "next_run_at" TIMESTAMP(3),
  "stop_at" TIMESTAMP(3),
  "state" TEXT NOT NULL DEFAULT 'draft',
  "joined" INTEGER NOT NULL DEFAULT 0,
  "skipped" INTEGER NOT NULL DEFAULT 0,
  "failed" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "group_join_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "group_join_job_logs" (
  "id" TEXT NOT NULL,
  "job_id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "link_id" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "group_join_job_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "group_join_jobs_org_id_zalo_account_id_created_at_idx"
  ON "group_join_jobs"("org_id", "zalo_account_id", "created_at" DESC);
CREATE INDEX "group_join_jobs_org_id_state_next_run_at_idx"
  ON "group_join_jobs"("org_id", "state", "next_run_at");
CREATE INDEX "group_join_job_logs_job_id_created_at_idx"
  ON "group_join_job_logs"("job_id", "created_at");
CREATE INDEX "group_join_job_logs_org_id_created_at_idx"
  ON "group_join_job_logs"("org_id", "created_at" DESC);

ALTER TABLE "group_join_jobs"
  ADD CONSTRAINT "group_join_jobs_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_join_jobs"
  ADD CONSTRAINT "group_join_jobs_zalo_account_id_fkey"
  FOREIGN KEY ("zalo_account_id") REFERENCES "zalo_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_join_job_logs"
  ADD CONSTRAINT "group_join_job_logs_job_id_fkey"
  FOREIGN KEY ("job_id") REFERENCES "group_join_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_join_job_logs"
  ADD CONSTRAINT "group_join_job_logs_org_id_fkey"
  FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
