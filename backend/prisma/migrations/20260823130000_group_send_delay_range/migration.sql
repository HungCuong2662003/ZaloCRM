ALTER TABLE "group_send_jobs"
  ADD COLUMN "delay_min_ms" INTEGER,
  ADD COLUMN "delay_max_ms" INTEGER;

UPDATE "group_send_jobs"
SET
  "delay_min_ms" = COALESCE("delay_min_ms", "delay_ms"),
  "delay_max_ms" = COALESCE("delay_max_ms", "delay_ms");

ALTER TABLE "group_send_jobs"
  ALTER COLUMN "delay_min_ms" SET DEFAULT 30000,
  ALTER COLUMN "delay_max_ms" SET DEFAULT 30000,
  ALTER COLUMN "delay_min_ms" SET NOT NULL,
  ALTER COLUMN "delay_max_ms" SET NOT NULL;
