ALTER TABLE "group_send_jobs"
ADD COLUMN "image_attachments" JSONB NOT NULL DEFAULT '[]';
