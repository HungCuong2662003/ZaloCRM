CREATE TABLE "group_link_discoveries" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "zalo_account_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "link_kind" TEXT NOT NULL,
    "raw_url" TEXT NOT NULL,
    "normalized_url" TEXT NOT NULL,
    "external_key" TEXT,
    "source_thread_type" TEXT,
    "source_thread_id" TEXT,
    "source_thread_name" TEXT,
    "source_sender_name" TEXT,
    "source_snippet" TEXT,
    "message_sent_at" TIMESTAMP(3) NOT NULL,
    "check_status" TEXT NOT NULL DEFAULT 'unchecked',
    "title" TEXT,
    "member_count" INTEGER,
    "can_send_message" BOOLEAN,
    "can_view_members" BOOLEAN,
    "saved_zalo_group_link_id" TEXT,
    "last_checked_at" TIMESTAMP(3),
    "last_error" TEXT,
    "detected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_link_discoveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "group_link_discoveries_message_id_normalized_url_key"
    ON "group_link_discoveries"("message_id", "normalized_url");

CREATE INDEX "group_link_discoveries_org_id_zalo_account_id_detected_at_idx"
    ON "group_link_discoveries"("org_id", "zalo_account_id", "detected_at" DESC);

CREATE INDEX "group_link_discoveries_org_id_platform_check_status_idx"
    ON "group_link_discoveries"("org_id", "platform", "check_status");

CREATE INDEX "group_link_discoveries_saved_zalo_group_link_id_idx"
    ON "group_link_discoveries"("saved_zalo_group_link_id");

ALTER TABLE "group_link_discoveries"
    ADD CONSTRAINT "group_link_discoveries_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "group_link_discoveries"
    ADD CONSTRAINT "group_link_discoveries_zalo_account_id_fkey"
    FOREIGN KEY ("zalo_account_id") REFERENCES "zalo_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
