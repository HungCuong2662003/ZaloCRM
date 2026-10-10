CREATE TABLE "group_link_crawl_states" (
    "id" TEXT NOT NULL,
    "org_id" TEXT NOT NULL,
    "zalo_account_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "source_thread_id" TEXT,
    "source_thread_name" TEXT,
    "last_crawled_at" TIMESTAMP(3),
    "last_message_sent_at" TIMESTAMP(3),
    "scanned_messages" INTEGER NOT NULL DEFAULT 0,
    "found_links" INTEGER NOT NULL DEFAULT 0,
    "saved_zalo_links" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_link_crawl_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "group_link_crawl_states_zalo_account_id_conversation_id_key"
    ON "group_link_crawl_states"("zalo_account_id", "conversation_id");

CREATE INDEX "group_link_crawl_states_org_id_zalo_account_id_last_crawled_at_idx"
    ON "group_link_crawl_states"("org_id", "zalo_account_id", "last_crawled_at" DESC);

ALTER TABLE "group_link_crawl_states"
    ADD CONSTRAINT "group_link_crawl_states_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "group_link_crawl_states"
    ADD CONSTRAINT "group_link_crawl_states_zalo_account_id_fkey"
    FOREIGN KEY ("zalo_account_id") REFERENCES "zalo_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
