CREATE TABLE "group_send_jobs" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "zalo_account_id" TEXT NOT NULL,
  "group_ids" JSONB NOT NULL,
  "message" TEXT NOT NULL,
  "delay_ms" INTEGER NOT NULL DEFAULT 30000,
  "stop_at" TIMESTAMP(3),
  "repeat" BOOLEAN NOT NULL DEFAULT false,
  "repeat_pause_ms" INTEGER NOT NULL DEFAULT 3600000,
  "cycles" INTEGER NOT NULL DEFAULT 0,
  "state" TEXT NOT NULL DEFAULT 'draft',
  "sent" INTEGER NOT NULL DEFAULT 0,
  "failed" INTEGER NOT NULL DEFAULT 0,
  "last_error" TEXT,
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),
  "created_by_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "group_send_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "group_send_job_logs" (
  "id" TEXT NOT NULL,
  "job_id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "group_id" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "group_send_job_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "group_send_jobs_org_id_zalo_account_id_created_at_idx" ON "group_send_jobs"("org_id", "zalo_account_id", "created_at" DESC);
CREATE INDEX "group_send_jobs_org_id_state_idx" ON "group_send_jobs"("org_id", "state");
CREATE INDEX "group_send_job_logs_job_id_created_at_idx" ON "group_send_job_logs"("job_id", "created_at");
CREATE INDEX "group_send_job_logs_org_id_created_at_idx" ON "group_send_job_logs"("org_id", "created_at" DESC);

ALTER TABLE "group_send_jobs" ADD CONSTRAINT "group_send_jobs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_send_jobs" ADD CONSTRAINT "group_send_jobs_zalo_account_id_fkey" FOREIGN KEY ("zalo_account_id") REFERENCES "zalo_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_send_job_logs" ADD CONSTRAINT "group_send_job_logs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "group_send_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "group_send_job_logs" ADD CONSTRAINT "group_send_job_logs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
