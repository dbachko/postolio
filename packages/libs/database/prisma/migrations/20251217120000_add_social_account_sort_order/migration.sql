-- Add a stable per-brand ordering for connected social accounts.
ALTER TABLE "public"."social_accounts" ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- Backfill existing accounts so the earliest connected account becomes primary (top).
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (PARTITION BY "brandId" ORDER BY "createdAt" ASC, "id" ASC) - 1 AS rn
  FROM "public"."social_accounts"
)
UPDATE "public"."social_accounts" sa
SET "sortOrder" = ranked.rn
FROM ranked
WHERE sa."id" = ranked."id";

CREATE INDEX "social_accounts_brandId_sortOrder_idx"
  ON "public"."social_accounts"("brandId", "sortOrder");

