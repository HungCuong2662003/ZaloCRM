ALTER TABLE "group_members"
ADD COLUMN "private_message_status" TEXT,
ADD COLUMN "private_message_last_at" TIMESTAMP(3),
ADD COLUMN "friend_invite_status" TEXT,
ADD COLUMN "friend_invite_last_at" TIMESTAMP(3),
ADD COLUMN "last_failure_reason" TEXT,
ADD COLUMN "note" TEXT,
ADD COLUMN "suppressed_at" TIMESTAMP(3);

CREATE TABLE "zalo_group_links" (
  "id" TEXT NOT NULL,
  "org_id" TEXT NOT NULL,
  "zalo_account_id" TEXT NOT NULL,
  "raw_link" TEXT NOT NULL,
  "normalized_link" TEXT NOT NULL,
  "link_id" TEXT NOT NULL,
  "group_id" TEXT,
  "group_name" TEXT,
  "link_status" TEXT NOT NULL DEFAULT 'valid',
  "join_status" TEXT NOT NULL DEFAULT 'not_joined',
  "can_send_message" BOOLEAN,
  "can_view_members" BOOLEAN,
  "last_checked_at" TIMESTAMP(3),
  "joined_at" TIMESTAMP(3),
  "last_error" TEXT,
  "note" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "zalo_group_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "zalo_group_links_zalo_account_id_normalized_link_key"
ON "zalo_group_links"("zalo_account_id", "normalized_link");

CREATE INDEX "zalo_group_links_org_id_zalo_account_id_join_status_idx"
ON "zalo_group_links"("org_id", "zalo_account_id", "join_status");

CREATE INDEX "zalo_group_links_org_id_link_status_idx"
ON "zalo_group_links"("org_id", "link_status");

ALTER TABLE "zalo_group_links"
ADD CONSTRAINT "zalo_group_links_org_id_fkey"
FOREIGN KEY ("org_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "zalo_group_links"
ADD CONSTRAINT "zalo_group_links_zalo_account_id_fkey"
FOREIGN KEY ("zalo_account_id") REFERENCES "zalo_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
