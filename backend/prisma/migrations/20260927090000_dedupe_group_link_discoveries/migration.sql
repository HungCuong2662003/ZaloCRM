WITH ranked AS (
    SELECT
        "id",
        ROW_NUMBER() OVER (
            PARTITION BY "zalo_account_id", "normalized_url"
            ORDER BY "updated_at" DESC, "detected_at" DESC, "id" DESC
        ) AS row_number
    FROM "group_link_discoveries"
)
DELETE FROM "group_link_discoveries" AS duplicate
USING ranked
WHERE ranked."id" = duplicate."id"
  AND ranked.row_number > 1;

DROP INDEX "group_link_discoveries_message_id_normalized_url_key";

CREATE UNIQUE INDEX "group_link_discoveries_zalo_account_id_normalized_url_key"
    ON "group_link_discoveries"("zalo_account_id", "normalized_url");
